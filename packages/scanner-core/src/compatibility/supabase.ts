import ts from "typescript";
import type { DatabaseObject } from "../contracts";
import type { DependencyEvidence, GapKind } from "./contracts";
import { resolvedDeclaration } from "./source-program";
import { filterColumns } from "./supabase-filters";

const identifier = /^[a-zA-Z_][a-zA-Z_0-9]*$/;
const factories = new Map([
  ["@supabase/supabase-js", new Set(["createClient"])],
  ["@supabase/ssr", new Set(["createServerClient", "createBrowserClient"])],
]);
const operations = new Map<string, DependencyEvidence["statement"]>([
  ["select", "select"],
  ["insert", "insert"],
  ["upsert", "insert"],
  ["update", "update"],
  ["delete", "delete"],
]);
const columnFilters = new Set([
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "like",
  "ilike",
  "is",
  "in",
  "contains",
  "containedBy",
  "overlaps",
  "order",
  "filter",
]);
const modifiers = new Set([
  "single",
  "maybeSingle",
  "limit",
  "range",
  "abortSignal",
  "throwOnError",
  "returns",
  "overrideTypes",
]);

function stringValue(node?: ts.Node) {
  return node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    ? node.text
    : undefined;
}

function constant(node: ts.Expression | undefined, checker: ts.TypeChecker) {
  if (!node || !ts.isIdentifier(node)) return node;
  const declaration = checker.getSymbolAtLocation(node)?.valueDeclaration;
  return declaration &&
    ts.isVariableDeclaration(declaration) &&
    ts.isVariableDeclarationList(declaration.parent) &&
    declaration.parent.flags & ts.NodeFlags.Const
    ? declaration.initializer
    : undefined;
}

function unwrapped(expression: ts.Expression): ts.Expression {
  while (
    ts.isAwaitExpression(expression) ||
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isNonNullExpression(expression) ||
    ts.isTypeAssertionExpression(expression) ||
    ts.isSatisfiesExpression(expression)
  )
    expression = expression.expression;
  return expression;
}

function helperReturn(
  declaration: ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression,
) {
  if (declaration.parameters.length || !declaration.body) return;
  if (!ts.isBlock(declaration.body)) return declaration.body;
  const returns: ts.ReturnStatement[] = [];
  function visit(node: ts.Node) {
    if (ts.isFunctionLike(node)) return;
    if (ts.isReturnStatement(node)) returns.push(node);
    ts.forEachChild(node, visit);
  }
  declaration.body.statements.forEach(visit);
  const onlyReturn = returns[0];
  return returns.length === 1 &&
    onlyReturn?.parent === declaration.body &&
    declaration.body.statements.at(-1) === onlyReturn
    ? onlyReturn.expression
    : undefined;
}

function clientSchema(
  receiver: ts.Expression,
  checker: ts.TypeChecker,
  seen = new Set<ts.Node>(),
  program?: ts.Program,
): string | null | undefined {
  receiver = unwrapped(receiver);
  if (seen.has(receiver) || seen.size >= 32) return null;
  seen.add(receiver);
  if (ts.isIdentifier(receiver)) {
    const declaration = resolvedDeclaration(receiver, checker);
    if (
      declaration &&
      ts.isVariableDeclaration(declaration) &&
      ts.isVariableDeclarationList(declaration.parent) &&
      declaration.parent.flags & ts.NodeFlags.Const &&
      declaration.initializer
    )
      return clientSchema(declaration.initializer, checker, seen, program);
    return;
  }
  if (
    ts.isCallExpression(receiver) &&
    ts.isPropertyAccessExpression(receiver.expression) &&
    receiver.expression.name.text === "schema"
  ) {
    if (clientSchema(receiver.expression.expression, checker, seen, program) === undefined)
      return undefined;
    return stringValue(receiver.arguments[0]) ?? null;
  }
  const creation = receiver;
  if (!creation || !ts.isCallExpression(creation) || !ts.isIdentifier(creation.expression)) return;
  const specifier = checker.getSymbolAtLocation(creation.expression)?.declarations?.[0];
  const source =
    specifier && ts.isImportSpecifier(specifier)
      ? specifier.parent.parent.parent.moduleSpecifier
      : undefined;
  const factory =
    specifier &&
    ts.isImportSpecifier(specifier) &&
    factories.get(stringValue(source) ?? "")?.has((specifier.propertyName ?? specifier.name).text);
  if (!factory) {
    const declaration = resolvedDeclaration(creation.expression, checker);
    if (declaration && ts.isParameter(declaration) && program) {
      const owner = declaration.parent;
      if (!ts.isFunctionDeclaration(owner) || !owner.name) return null;
      const symbol = checker.getSymbolAtLocation(owner.name);
      const position = owner.parameters.indexOf(declaration);
      const schemas: (string | null | undefined)[] = [];
      function visit(node: ts.Node) {
        if (
          ts.isCallExpression(node) &&
          ts.isIdentifier(node.expression) &&
          resolvedDeclaration(node.expression, checker) === owner
        ) {
          const argument = node.arguments[position];
          schemas.push(
            argument && ts.isIdentifier(argument)
              ? clientSchema(
                  ts.factory.createCallExpression(argument, undefined, []),
                  checker,
                  new Set(seen),
                  program,
                )
              : null,
          );
        }
        ts.forEachChild(node, visit);
      }
      if (symbol) program.getSourceFiles().forEach(visit);
      const schema = schemas[0];
      return typeof schema === "string" && schemas.every((value) => value === schema)
        ? schema
        : null;
    }
    const initializer =
      declaration && ts.isVariableDeclaration(declaration) ? declaration.initializer : declaration;
    if (
      !initializer ||
      !(
        ts.isFunctionDeclaration(initializer) ||
        ts.isArrowFunction(initializer) ||
        ts.isFunctionExpression(initializer)
      )
    )
      return;
    const returned = helperReturn(initializer);
    return returned ? clientSchema(returned, checker, seen, program) : null;
  }
  const options = creation.arguments[2];
  if (!options) return "public";
  if (!ts.isObjectLiteralExpression(options)) return null;
  const properties = objectFields(options);
  if (!properties) return null;
  const database = properties.get("db");
  if (!database) return "public";
  if (!ts.isObjectLiteralExpression(database)) return null;
  const settings = objectFields(database);
  if (!settings) return null;
  return settings.has("schema") ? (stringValue(settings.get("schema")) ?? null) : "public";
}

export function supabaseQuery(
  call: ts.CallExpression,
  checker: ts.TypeChecker,
  program?: ts.Program,
) {
  const method = call.expression;
  if (!ts.isPropertyAccessExpression(method) || !["from", "rpc"].includes(method.name.text)) return;
  const schema = clientSchema(method.expression, checker, new Set(), program);
  if (schema !== undefined) return { schema, rpc: method.name.text === "rpc" };
  const parent = call.parent;
  const queryLike =
    ts.isPropertyAccessExpression(parent) &&
    ts.isCallExpression(parent.parent) &&
    operations.has(parent.name.text);
  return queryLike || method.name.text === "rpc"
    ? { schema: null, rpc: method.name.text === "rpc" }
    : undefined;
}

function objectFields(payload: ts.Expression | undefined) {
  if (!payload || !ts.isObjectLiteralExpression(payload)) return;
  const fields = new Map<string, ts.Expression>();
  for (const property of payload.properties) {
    const name = ts.isShorthandPropertyAssignment(property)
      ? property.name.text
      : ts.isPropertyAssignment(property) &&
          (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))
        ? property.name.text
        : undefined;
    if (!name || !identifier.test(name) || fields.has(name)) return;
    fields.set(
      name,
      ts.isShorthandPropertyAssignment(property)
        ? property.name
        : (property as ts.PropertyAssignment).initializer,
    );
  }
  return fields;
}

type QueryMethod = { name: string; call: ts.CallExpression };

function queryChain(root: ts.Expression) {
  const methods: QueryMethod[] = [];
  let tip = root;
  while (
    ts.isPropertyAccessExpression(tip.parent) &&
    ts.isCallExpression(tip.parent.parent) &&
    tip.parent.parent.expression === tip.parent
  ) {
    methods.push({ name: tip.parent.name.text, call: tip.parent.parent });
    tip = tip.parent.parent;
  }
  return { methods, tip };
}

function functionScope(node: ts.Node) {
  let scope = node.parent;
  while (scope && !ts.isFunctionLike(scope) && !ts.isSourceFile(scope)) scope = scope.parent;
  return scope;
}

function exportedBinding(name: ts.Identifier) {
  const statement = name.parent.parent.parent;
  return (
    ts.isVariableStatement(statement) &&
    statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
  );
}

// Follow bounded constant aliases and self-derived assignments in one scope.
// Mutable aliases, overwritten builders and callbacks remain coverage gaps.
function builderExtensions(expression: ts.Expression, checker: ts.TypeChecker) {
  const declaration = expression.parent;
  const methods: QueryMethod[] = [];
  if (!ts.isVariableDeclaration(declaration) || !ts.isIdentifier(declaration.name))
    return {
      methods,
      incomplete: !ts.isAwaitExpression(declaration) && !ts.isExpressionStatement(declaration),
    };
  const scope = functionScope(declaration);
  const pending = [declaration.name];
  const seen = new Set<ts.Symbol>();
  let incomplete = !!exportedBinding(declaration.name);
  while (pending.length) {
    const name = pending.shift();
    const binding = name && checker.getSymbolAtLocation(name);
    if (!binding || seen.size >= 32) {
      incomplete = true;
      break;
    }
    if (seen.has(binding)) continue;
    seen.add(binding);
    const sameBinding = (node: ts.Node) =>
      ts.isIdentifier(node) && checker.getSymbolAtLocation(node) === binding;
    function selfAssignment(node: ts.Node) {
      if (
        !ts.isBinaryExpression(node) ||
        node.operatorToken.kind !== ts.SyntaxKind.EqualsToken ||
        !sameBinding(node.left)
      )
        return false;
      let root = node.right;
      while (ts.isCallExpression(root) && ts.isPropertyAccessExpression(root.expression))
        root = root.expression.expression;
      return sameBinding(root);
    }
    function visit(node: ts.Node) {
      if (node !== name && sameBinding(node)) {
        if (functionScope(node) !== scope) incomplete = true;
        else if (ts.isAwaitExpression(node.parent)) {
          /* execution of the stored query */
        } else if (
          ts.isBinaryExpression(node.parent) &&
          node.parent.left === node &&
          selfAssignment(node.parent)
        ) {
          /* handled at its right-hand root */
        } else if (ts.isIdentifier(node)) {
          const extension = queryChain(node);
          const parent = extension.tip.parent;
          const alias =
            ts.isVariableDeclaration(parent) &&
            parent.initializer === extension.tip &&
            ts.isIdentifier(parent.name) &&
            ts.isVariableDeclarationList(parent.parent) &&
            parent.parent.flags & ts.NodeFlags.Const
              ? parent.name
              : undefined;
          const allowedEnd =
            ts.isAwaitExpression(parent) ||
            ts.isExpressionStatement(parent) ||
            (ts.isBinaryExpression(parent) &&
              parent.right === extension.tip &&
              selfAssignment(parent));
          if (alias) {
            pending.push(alias);
            if (exportedBinding(alias)) incomplete = true;
          } else if (!extension.methods.length || !allowedEnd) incomplete = true;
          methods.push(...extension.methods);
          if (extension.methods.some(({ name }) => operations.has(name))) incomplete = true;
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(expression.getSourceFile());
  }
  return { methods, incomplete };
}

export function inspectSupabase(
  from: ts.CallExpression,
  schema: string | null,
  rpc: boolean,
  checker: ts.TypeChecker,
  emit: (
    statement: DependencyEvidence["statement"],
    access: DependencyEvidence["access"],
    target: DatabaseObject,
    confidence: DependencyEvidence["confidence"],
    writeTarget?: boolean,
  ) => void,
  gap: (kind: GapKind, message: string) => void,
  program: ts.Program,
) {
  if (rpc) return gap("source", "A Supabase RPC hides database dependencies inside a function.");
  const table = stringValue(from.arguments[0]);
  if (!schema || !identifier.test(schema) || !table || !identifier.test(table))
    return gap(
      "unresolved-reference",
      "The table-query client, schema or table could not be resolved. Verify shared client helpers, module paths and runtime configuration.",
    );

  const { methods: chain, tip: expression } = queryChain(from);
  const first = chain[0];
  const statement = first && operations.get(first.name);
  if (!statement)
    return gap("source", "The Supabase table call uses an unsupported operation or query builder.");
  const extensions = builderExtensions(expression, checker);
  const references: Parameters<typeof emit>[] = [];
  let incomplete = false;
  const record: typeof emit = (...reference) => references.push(reference);
  const reportGap: typeof gap = (kind, message) => {
    incomplete = true;
    gap(kind, message);
  };
  if (extensions.incomplete)
    reportGap(
      "source",
      "The Supabase query builder is reused outside its original chain. Additional filters and operations require review.",
    );

  const target = { schema, table };
  const finalProjection = [...chain].reverse().find(({ name }) => name === "select")?.call;
  const writeTarget = statement !== "select";
  record(statement, "table", target, "high", writeTarget);
  if (statement === "insert" || statement === "update") {
    const payload = constant(first.call.arguments[0], checker);
    const fields = objectFields(payload);
    if (fields) {
      for (const column of fields.keys())
        record(statement, "column", { ...target, column }, "high", true);
    } else {
      record(statement, "wildcard", target, "low", true);
      reportGap(
        "unresolved-reference",
        "The Supabase write column list could not be resolved from a literal object.",
      );
    }
  }

  for (const { name, call } of [
    ...(statement === "select" ? chain : chain.slice(1)),
    ...extensions.methods,
  ]) {
    if (name === "select") {
      if (chain.some((method) => method.call === call) && call !== finalProjection) continue;
      const projection = call.arguments.length ? stringValue(call.arguments[0]) : "*";
      const fields = projection?.split(",").map((field) => field.trim());
      if (!fields?.every((field) => field === "*" || identifier.test(field))) {
        reportGap(
          "unresolved-reference",
          "A dynamic or nested Supabase projection requires review.",
        );
        continue;
      }
      for (const column of fields)
        if (column === "*") record(statement, "wildcard", target, "medium");
        else record(statement, "column", { ...target, column }, "high");
    } else if (columnFilters.has(name)) {
      const column = stringValue(call.arguments[0]);
      if (!column || !identifier.test(column)) {
        reportGap("unresolved-reference", "A dynamic or nested Supabase filter requires review.");
        continue;
      }
      record(statement, "column", { ...target, column }, "high");
      // A referenced table changes which relation owns the column.
      if (name === "order" && call.arguments[1])
        if (
          !ts.isObjectLiteralExpression(call.arguments[1]) ||
          call.arguments[1].properties.some(
            (property) =>
              !ts.isPropertyAssignment(property) ||
              !ts.isIdentifier(property.name) ||
              !["ascending", "nullsFirst"].includes(property.name.text),
          )
        )
          reportGap("source", "Supabase ordering on a referenced table requires review.");
    } else if (name === "or") {
      const columns = filterColumns(call.arguments[0], checker, program);
      if (!columns || call.arguments.length !== 1)
        reportGap(
          "source",
          "A Supabase logical filter has dynamic or unsupported structure. Its column dependencies require review.",
        );
      else for (const column of columns) record(statement, "column", { ...target, column }, "high");
    } else if (!modifiers.has(name)) {
      reportGap("source", "A Supabase query modifier is outside static dependency coverage.");
    }
  }
  for (const [operation, access, object, confidence, writes] of references)
    emit(operation, access, object, incomplete ? "low" : confidence, writes);
}

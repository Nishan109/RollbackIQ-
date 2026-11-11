import ts from "typescript";
import type { DatabaseObject } from "../contracts";
import type { DependencyEvidence, GapKind } from "./contracts";
import { literalObject } from "./prisma";

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

function clientSchema(receiver: ts.Expression, checker: ts.TypeChecker): string | null | undefined {
  if (
    ts.isCallExpression(receiver) &&
    ts.isPropertyAccessExpression(receiver.expression) &&
    receiver.expression.name.text === "schema"
  ) {
    if (clientSchema(receiver.expression.expression, checker) === undefined) return undefined;
    return stringValue(receiver.arguments[0]) ?? null;
  }
  const creation = constant(receiver, checker);
  if (!creation || !ts.isCallExpression(creation) || !ts.isIdentifier(creation.expression)) return;
  const specifier = checker.getSymbolAtLocation(creation.expression)?.declarations?.[0];
  if (!specifier || !ts.isImportSpecifier(specifier)) return;
  const source = specifier.parent.parent.parent.moduleSpecifier;
  if (
    !factories.get(stringValue(source) ?? "")?.has((specifier.propertyName ?? specifier.name).text)
  )
    return;
  const options = creation.arguments[2];
  if (!options) return "public";
  if (!ts.isObjectLiteralExpression(options)) return null;
  const properties = literalObject(options);
  if (!properties) return null;
  const database = properties.get("db");
  if (!database) return "public";
  if (!ts.isObjectLiteralExpression(database)) return null;
  const settings = literalObject(database);
  if (!settings) return null;
  return settings.has("schema") ? (stringValue(settings.get("schema")) ?? null) : "public";
}

export function supabaseQuery(call: ts.CallExpression, checker: ts.TypeChecker) {
  const method = call.expression;
  if (!ts.isPropertyAccessExpression(method) || !["from", "rpc"].includes(method.name.text)) return;
  const schema = clientSchema(method.expression, checker);
  return schema === undefined ? undefined : { schema, rpc: method.name.text === "rpc" };
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
) {
  if (rpc) return gap("source", "A Supabase RPC hides database dependencies inside a function.");
  const table = stringValue(from.arguments[0]);
  if (!schema || !identifier.test(schema) || !table || !identifier.test(table))
    return gap(
      "unresolved-reference",
      "The Supabase schema or table is not a supported literal name.",
    );

  const chain: { name: string; call: ts.CallExpression }[] = [];
  let expression = from;
  while (
    ts.isPropertyAccessExpression(expression.parent) &&
    ts.isCallExpression(expression.parent.parent) &&
    expression.parent.parent.expression === expression.parent
  ) {
    chain.push({ name: expression.parent.name.text, call: expression.parent.parent });
    expression = expression.parent.parent;
  }
  const first = chain[0];
  const statement = first && operations.get(first.name);
  if (!statement)
    return gap("source", "The Supabase table call uses an unsupported operation or query builder.");

  const target = { schema, table };
  const writeTarget = statement !== "select";
  emit(statement, "table", target, "high", writeTarget);
  if (statement === "insert" || statement === "update") {
    const payload = constant(first.call.arguments[0], checker);
    const fields = payload && ts.isObjectLiteralExpression(payload) && literalObject(payload);
    if (fields && [...fields.keys()].every((column) => identifier.test(column))) {
      for (const column of fields.keys())
        emit(statement, "column", { ...target, column }, "high", true);
    } else {
      emit(statement, "wildcard", target, "low", true);
    }
  }

  for (const { name, call } of statement === "select" ? chain : chain.slice(1)) {
    if (name === "select") {
      const projection = call.arguments.length ? stringValue(call.arguments[0]) : "*";
      const fields = projection?.split(",").map((field) => field.trim());
      if (!fields?.every((field) => field === "*" || identifier.test(field))) {
        gap("unresolved-reference", "A dynamic or nested Supabase projection requires review.");
        continue;
      }
      for (const column of fields)
        if (column === "*") emit(statement, "wildcard", target, "medium");
        else emit(statement, "column", { ...target, column }, "high");
    } else if (columnFilters.has(name)) {
      const column = stringValue(call.arguments[0]);
      if (!column || !identifier.test(column)) {
        gap("unresolved-reference", "A dynamic or nested Supabase filter requires review.");
        continue;
      }
      emit(statement, "column", { ...target, column }, "high");
    } else if (!modifiers.has(name)) {
      gap("source", "A Supabase query modifier is outside static dependency coverage.");
    }
  }
}

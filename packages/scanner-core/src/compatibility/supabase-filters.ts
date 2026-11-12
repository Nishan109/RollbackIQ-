import ts from "typescript";
import { resolvedDeclaration } from "./source-program";

const scalarFilter =
  /^([A-Za-z_][A-Za-z_0-9]*)\.(?:not\.)?(?:eq|neq|gt|gte|lt|lte|like|ilike|is|isdistinct)\.(.+)$/s;

function zodCall(node: ts.Expression, methods: string[], checker: ts.TypeChecker) {
  if (!ts.isCallExpression(node)) return false;
  let callee = node.expression;
  for (const method of [...methods].reverse()) {
    if (!ts.isPropertyAccessExpression(callee) || callee.name.text !== method) return false;
    callee = callee.expression;
  }
  if (!ts.isIdentifier(callee)) return false;
  const declaration = checker.getSymbolAtLocation(callee)?.declarations?.[0];
  return (
    declaration &&
    ts.isImportSpecifier(declaration) &&
    (declaration.propertyName ?? declaration.name).text === "z" &&
    ts.isStringLiteral(declaration.parent.parent.parent.moduleSpecifier) &&
    declaration.parent.parent.parent.moduleSpecifier.text === "zod"
  );
}

function validatedValue(
  expression: ts.Expression,
  argument: ts.Expression,
  checker: ts.TypeChecker,
  program: ts.Program,
) {
  if (
    !ts.isPropertyAccessExpression(expression) ||
    !ts.isPropertyAccessExpression(expression.expression) ||
    expression.expression.name.text !== "data" ||
    !ts.isIdentifier(expression.expression.expression)
  )
    return false;
  const result = expression.expression.expression;
  const declaration = resolvedDeclaration(result, checker);
  if (
    !declaration ||
    !ts.isVariableDeclaration(declaration) ||
    !ts.isVariableDeclarationList(declaration.parent) ||
    !(declaration.parent.flags & ts.NodeFlags.Const)
  )
    return false;

  const parse = declaration.initializer;
  if (
    !parse ||
    !ts.isCallExpression(parse) ||
    !ts.isPropertyAccessExpression(parse.expression) ||
    parse.expression.name.text !== "safeParse" ||
    !ts.isIdentifier(parse.expression.expression)
  )
    return false;
  const schema = resolvedDeclaration(parse.expression.expression, checker);
  if (
    !schema ||
    !ts.isVariableDeclaration(schema) ||
    !ts.isVariableDeclarationList(schema.parent) ||
    !(schema.parent.flags & ts.NodeFlags.Const) ||
    !schema.initializer ||
    !zodCall(schema.initializer, ["object"], checker) ||
    !ts.isCallExpression(schema.initializer)
  )
    return false;
  const shape = schema.initializer.arguments[0];
  if (
    !shape ||
    !ts.isObjectLiteralExpression(shape) ||
    shape.properties.some((property) => !ts.isPropertyAssignment(property))
  )
    return false;
  const property = shape.properties.find(
    (item) =>
      ts.isPropertyAssignment(item) &&
      (ts.isIdentifier(item.name) || ts.isStringLiteral(item.name)) &&
      item.name.text === expression.name.text,
  );
  if (
    !property ||
    !ts.isPropertyAssignment(property) ||
    !(
      zodCall(property.initializer, ["uuid"], checker) ||
      zodCall(property.initializer, ["iso", "datetime"], checker)
    )
  )
    return false;

  const names = new Set<string>();
  for (const field of shape.properties) {
    if (
      !ts.isPropertyAssignment(field) ||
      !(ts.isIdentifier(field.name) || ts.isStringLiteral(field.name)) ||
      names.has(field.name.text)
    )
      return false;
    names.add(field.name.text);
  }
  // A recognized validator is insufficient if its exported schema was replaced,
  // mutated or passed to unknown code anywhere in the supplied source snapshot.
  const schemaName = schema.name;
  let schemaIsolated = true;
  function inspectSchema(node: ts.Node) {
    if (!schemaIsolated) return;
    if (
      ts.isIdentifier(node) &&
      node !== schemaName &&
      resolvedDeclaration(node, checker) === schema
    ) {
      const parent = node.parent;
      const imported =
        ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent) || ts.isTypeQueryNode(parent);
      const parsed =
        ts.isPropertyAccessExpression(parent) &&
        ["parse", "safeParse"].includes(parent.name.text) &&
        ts.isCallExpression(parent.parent) &&
        parent.parent.expression === parent;
      if (!imported && !parsed) schemaIsolated = false;
    }
    ts.forEachChild(node, inspectSchema);
  }
  program.getSourceFiles().forEach(inspectSchema);
  if (!schemaIsolated) return false;

  const binding = checker.getSymbolAtLocation(result);
  const declarationName = declaration.name;
  let guarded = false;
  for (let node: ts.Node = argument; node.parent; node = node.parent) {
    const parent = node.parent;
    if (ts.isFunctionLike(parent)) break;
    if (
      ts.isIfStatement(parent) &&
      parent.thenStatement === node &&
      ts.isPropertyAccessExpression(parent.expression) &&
      parent.expression.name.text === "success" &&
      ts.isIdentifier(parent.expression.expression) &&
      checker.getSymbolAtLocation(parent.expression.expression) === binding
    )
      guarded = true;
  }
  if (!guarded) return false;
  let isolated = true;
  function visit(node: ts.Node) {
    if (!isolated) return;
    if (
      ts.isIdentifier(node) &&
      node !== declarationName &&
      checker.getSymbolAtLocation(node) === binding
    ) {
      const parent = node.parent;
      const success =
        ts.isPropertyAccessExpression(parent) &&
        parent.name.text === "success" &&
        ts.isIfStatement(parent.parent) &&
        parent.parent.expression === parent;
      const data =
        ts.isPropertyAccessExpression(parent) &&
        parent.name.text === "data" &&
        ts.isPropertyAccessExpression(parent.parent) &&
        ts.isTemplateSpan(parent.parent.parent) &&
        parent.parent.parent.expression === parent.parent &&
        node.getStart() >= argument.getStart() &&
        node.getEnd() <= argument.getEnd();
      if (!success && !data) isolated = false;
    }
    ts.forEachChild(node, visit);
  }
  visit(argument.getSourceFile());
  return isolated;
}

function rawFilter(argument: ts.Expression, checker: ts.TypeChecker, program: ts.Program) {
  if (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument))
    return argument.text;
  if (
    !ts.isTemplateExpression(argument) ||
    argument.templateSpans.some(
      (span) => !validatedValue(span.expression, argument, checker, program),
    )
  )
    return;
  return (
    argument.head.text + argument.templateSpans.map((span) => `\0${span.literal.text}`).join("")
  );
}

export function filterColumns(
  argument: ts.Expression | undefined,
  checker: ts.TypeChecker,
  program: ts.Program,
) {
  if (!argument) return;
  const filter = rawFilter(argument, checker, program);
  if (!filter || filter.length > 32768) return;
  const columns = new Set<string>();
  let conditions = 0;
  function list(text: string, depth: number): boolean {
    if (depth > 16 || ++conditions > 128) return false;
    let quoted = false,
      escaped = false,
      nesting = 0,
      start = 0;
    const parts: string[] = [];
    for (let index = 0; index < text.length; index++) {
      const char = text[index];
      if (quoted) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') quoted = false;
      } else if (char === '"') quoted = true;
      else if (char === "(") nesting++;
      else if (char === ")") {
        if (--nesting < 0) return false;
      } else if (char === "," && nesting === 0) {
        parts.push(text.slice(start, index));
        start = index + 1;
      }
    }
    if (quoted || nesting !== 0) return false;
    parts.push(text.slice(start));
    for (const raw of parts) {
      const item = raw.trim();
      const group = /^(?:not\.)?(?:and|or)\((.*)\)$/s.exec(item);
      if (group) {
        if (!list(group[1] ?? "", depth + 1)) return false;
        continue;
      }
      const scalar = scalarFilter.exec(item);
      if (
        !scalar?.[1] ||
        !scalar[2] ||
        !(/^[^,\s()[\]{}"]+$/.test(scalar[2]) || /^"(?:[^"\\]|\\.)*"$/.test(scalar[2]))
      )
        return false;
      columns.add(scalar[1]);
      if (++conditions > 128) return false;
    }
    return true;
  }
  return list(filter, 0) ? [...columns] : undefined;
}

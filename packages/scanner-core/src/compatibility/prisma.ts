import { type Attribute, type BlockAttribute, getSchema } from "@mrleebo/prisma-ast";
import ts from "typescript";
import type { DatabaseObject } from "../contracts";
import type { DependencyEvidence, GapKind, SourceFile } from "./contracts";

export interface PrismaModel {
  target: DatabaseObject;
  fields: Map<string, string>;
}

type Gap = (kind: GapKind, message: string) => void;
type Emit = (
  statement: DependencyEvidence["statement"],
  access: DependencyEvidence["access"],
  target: DatabaseObject,
  confidence: DependencyEvidence["confidence"],
  writeTarget?: boolean,
) => void;

function attributeString(attributes: (Attribute | BlockAttribute)[], name: string) {
  const value = attributes.find((attribute) => attribute.name === name)?.args?.[0]?.value;
  if (typeof value !== "string") return undefined;
  return value.startsWith('"') ? (JSON.parse(value) as string) : value;
}

export function prismaModels(
  file: SourceFile | undefined,
  defaultSchema: string,
  gap: Gap,
): Map<string, PrismaModel> {
  const result = new Map<string, PrismaModel>();
  if (!file) return result;
  try {
    // Reject unrecognized characters before the library's recovering lexer can discard them.
    const tokens =
      /\s+|\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|[A-Za-z_][A-Za-z0-9_]*|-?\d+(?:\.\d+)?|[@{}()[\],.:=?]/gy;
    let end = 0;
    for (const token of file.text.matchAll(tokens)) end = token.index + token[0].length;
    if (end !== file.text.length) throw new Error("Unsupported Prisma tokens");
    const schema = getSchema(file.text);
    const enums = new Set(
      schema.list.filter((block) => block.type === "enum").map((block) => block.name),
    );
    const scalar = new Set([
      "String",
      "Int",
      "BigInt",
      "Float",
      "Decimal",
      "Boolean",
      "DateTime",
      "Json",
      "Bytes",
      ...enums,
    ]);
    for (const block of schema.list) {
      if (block.type !== "model") continue;
      const attributes = block.properties.filter(
        (property): property is BlockAttribute => property.type === "attribute",
      );
      if (attributes.some(({ name }) => name === "ignore")) continue;
      const fields = new Map<string, string>();
      for (const field of block.properties) {
        if (
          field.type !== "field" ||
          typeof field.fieldType !== "string" ||
          !scalar.has(field.fieldType) ||
          field.attributes?.some(({ name }) => name === "ignore")
        )
          continue;
        fields.set(field.name, attributeString(field.attributes ?? [], "map") ?? field.name);
      }
      result.set(`${block.name.charAt(0).toLowerCase()}${block.name.slice(1)}`, {
        target: {
          schema: attributeString(attributes, "schema") ?? defaultSchema,
          table: attributeString(attributes, "map") ?? block.name,
        },
        fields,
      });
    }
  } catch {
    gap("schema", "The Prisma schema could not be parsed within the supported mapping grammar.");
  }
  return result;
}

export function propertyName(name: ts.PropertyName) {
  return ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : undefined;
}

export function literalObject(node: ts.Node | undefined): Map<string, ts.Expression> | undefined {
  if (!node || !ts.isObjectLiteralExpression(node)) return undefined;
  const fields = new Map<string, ts.Expression>();
  for (const property of node.properties) {
    if (!ts.isPropertyAssignment(property)) return undefined;
    const name = propertyName(property.name);
    if (!name || fields.has(name)) return undefined;
    fields.set(name, property.initializer);
  }
  return fields;
}

const reads = new Set([
  "findMany",
  "findFirst",
  "findFirstOrThrow",
  "findUnique",
  "findUniqueOrThrow",
]);
const writes = new Map<string, "insert" | "update" | "delete">([
  ["create", "insert"],
  ["update", "update"],
  ["delete", "delete"],
]);

export function inspectPrisma(
  call: ts.CallExpression,
  models: Map<string, PrismaModel>,
  emit: Emit,
  gap: Gap,
) {
  const method = call.expression;
  if (!ts.isPropertyAccessExpression(method) || !ts.isPropertyAccessExpression(method.expression))
    return false;
  const delegate = method.expression;
  const root = delegate.expression;
  if (!(ts.isIdentifier(root) && root.text === "prisma")) return false;
  const model = models.get(delegate.name.text);
  if (!model) {
    gap("schema", "A Prisma delegate has no supported model mapping in this release.");
    return true;
  }
  const operation = method.name.text;
  const statement = reads.has(operation) ? "select" : writes.get(operation);
  if (!statement) {
    gap("source", "The Prisma operation is outside supported find/create/update/delete patterns.");
    return true;
  }
  emit(statement, "table", model.target, "high", statement !== "select");
  const options = call.arguments.length
    ? literalObject(call.arguments[0])
    : new Map<string, ts.Expression>();
  if (!options || call.arguments.length > 1) {
    gap(
      "unresolved-reference",
      "Prisma arguments require static object properties without spreads.",
    );
    return true;
  }
  const recordField = (name: string, confidence: "high" | "medium" = "high") => {
    const column = model.fields.get(name);
    if (!column)
      return gap(
        "unresolved-reference",
        "A Prisma field is unmapped or is a relation outside scalar-field coverage.",
      );
    emit(statement, "column", { ...model.target, column }, confidence);
  };
  const select = options.get("select");
  if (select) {
    const selected = literalObject(select);
    if (!selected) gap("unresolved-reference", "Prisma select uses dynamic properties.");
    for (const [name, value] of selected ?? []) {
      if (value.kind === ts.SyntaxKind.TrueKeyword) recordField(name);
      else if (value.kind !== ts.SyntaxKind.FalseKeyword)
        gap("unresolved-reference", "Nested or computed Prisma selections require manual review.");
    }
  } else {
    for (const field of model.fields.keys()) recordField(field, "medium");
  }
  function fieldsIn(node: ts.Expression, depth = 0) {
    if (depth > 5) return gap("limit", "Prisma filter nesting exceeds the analysis limit.");
    if (ts.isArrayLiteralExpression(node)) {
      for (const value of node.elements) fieldsIn(value, depth + 1);
      return;
    }
    const fields = literalObject(node);
    if (!fields)
      return gap(
        "unresolved-reference",
        "Prisma filters or writes use nonliteral object properties.",
      );
    for (const [name, value] of fields) {
      if (["AND", "OR", "NOT"].includes(name)) fieldsIn(value, depth + 1);
      else recordField(name);
    }
  }
  for (const [name, value] of options) {
    if (["where", "data", "orderBy", "cursor"].includes(name)) fieldsIn(value);
    else if (!["select", "take", "skip"].includes(name))
      gap("source", "A Prisma option is outside supported scalar query coverage.");
  }
  return true;
}

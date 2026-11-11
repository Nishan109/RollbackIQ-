import { hasSqlDetails, parse } from "libpg-query";
import type { DatabaseObject, MigrationFile, SchemaChange } from "../contracts";
import { relationTarget } from "../identifiers";
import type { CoverageGap } from "./contracts";

export type Catalog = Map<string, Set<string>>;

export function tableKey(target: DatabaseObject, defaultSchema: string) {
  return JSON.stringify([target.schema ?? defaultSchema, target.table]);
}

export function sameTable(first: DatabaseObject, second: DatabaseObject, defaultSchema: string) {
  return tableKey(first, defaultSchema) === tableKey(second, defaultSchema);
}

export function obscuresNames(change: SchemaChange) {
  return (
    change.operation === "parse-error" ||
    (change.operation === "unsupported" && change.unsupportedNode !== "AlterSeqStmt")
  );
}

export async function readCatalog(
  baseline: MigrationFile | undefined,
  defaultSchema: string,
  gaps: CoverageGap[],
) {
  if (!baseline) return undefined;
  const incomplete = () => {
    gaps.push({
      kind: "schema",
      scope: "schema",
      message:
        "The baseline is outside simple CREATE TABLE catalog coverage. Column binding uses supported query syntax only.",
      location: { path: baseline.path, line: 1, column: 1 },
    });
    return undefined;
  };
  const catalog: Catalog = new Map();
  try {
    const ast = await parse(baseline.sql);
    for (const { stmt } of ast.stmts ?? []) {
      if (!stmt) return incomplete();
      if ("IndexStmt" in stmt || "CommentStmt" in stmt) continue;
      if ("CreateSchemaStmt" in stmt && !stmt.CreateSchemaStmt.schemaElts?.length) continue;
      if (!("CreateStmt" in stmt)) return incomplete();
      const table = stmt.CreateStmt;
      const target = relationTarget(table.relation);
      if (!target || table.inhRelations?.length || table.partbound || table.ofTypename)
        return incomplete();
      const columns = new Set<string>();
      for (const item of table.tableElts ?? []) {
        if ("Constraint" in item) continue;
        if (!("ColumnDef" in item) || !item.ColumnDef.colname) return incomplete();
        columns.add(item.ColumnDef.colname);
      }
      const key = tableKey(target, defaultSchema);
      if (catalog.has(key)) return incomplete();
      catalog.set(key, columns);
    }
  } catch (error) {
    if (!hasSqlDetails(error)) throw error;
    return incomplete();
  }
  return catalog;
}

export function proposedCatalog(
  previous: Catalog | undefined,
  changes: SchemaChange[],
  defaultSchema: string,
) {
  if (!previous || changes.some(obscuresNames)) return undefined;
  const result: Catalog = new Map([...previous].map(([key, columns]) => [key, new Set(columns)]));
  for (const change of changes) {
    if (!change.target) continue;
    const key = tableKey(change.target, defaultSchema);
    if (change.operation === "drop-table") result.delete(key);
    if (change.operation === "create-table" && (!change.conditional || !result.has(key)))
      result.set(key, new Set(change.columns));
    const column = change.target.column;
    const columns = result.get(key);
    if (!column || !columns) continue;
    if (change.operation === "add-column") columns.add(column);
    if (change.operation === "drop-column" || change.operation === "rename-column")
      columns.delete(column);
    if (change.operation === "rename-column" && change.newColumn) columns.add(change.newColumn);
  }
  return result;
}

import type { RangeVar } from "libpg-query";
import type { DatabaseObject } from "./contracts";

export function identifier(name: string) {
  return /^[a-z_][a-z0-9_$]*$/.test(name) ? name : `"${name.replaceAll('"', '""')}"`;
}

export function qualified(parts: (string | undefined)[]) {
  return parts
    .filter((part): part is string => part !== undefined)
    .map(identifier)
    .join(".");
}

export function relationTarget(relation?: RangeVar): DatabaseObject | undefined {
  if (!relation?.relname || relation.catalogname) return undefined;
  return { schema: relation.schemaname, table: relation.relname };
}

export function objectName(object: DatabaseObject) {
  return qualified([object.schema, object.table, object.column]);
}

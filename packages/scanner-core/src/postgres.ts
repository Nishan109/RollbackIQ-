import { createHash } from "node:crypto";
import {
  type AlterTableCmd,
  type CreateStmt,
  hasSqlDetails,
  type Node,
  parse,
  type RangeVar,
} from "libpg-query";
import type { FileResult, MigrationFile, SchemaChange, SourceLocation } from "./contracts";
import { identifier, qualified, relationTarget } from "./identifiers";

type Change = Omit<SchemaChange, "id" | "location">;
const POSTGRES_AST_VERSION = 180004;
const MAX_STATEMENTS = 1000;
const MAX_CHANGES = 2000;
const builtinTypes = new Set([
  "text",
  "varchar",
  "bpchar",
  "bool",
  "int2",
  "int4",
  "int8",
  "numeric",
  "float4",
  "float8",
  "uuid",
  "json",
  "jsonb",
  "date",
  "time",
  "timetz",
  "timestamp",
  "timestamptz",
  "interval",
  "bytea",
]);

export function isBuiltinType(type: string) {
  return builtinTypes.has(type.replace(/^pg_catalog\./, ""));
}

function relationName(relation?: RangeVar) {
  return qualified([relation?.catalogname, relation?.schemaname, relation?.relname]);
}

function names(nodes?: Node[]) {
  return qualified(nameParts(nodes));
}

function nameParts(nodes?: Node[]) {
  return nodes?.map((node) => ("String" in node ? node.String.sval : undefined)) ?? [];
}

function columnDefinition(node?: Node) {
  return node && "ColumnDef" in node ? node.ColumnDef : undefined;
}

function unsupported(detail: string, object: string | null = null): Change {
  return { operation: "unsupported", object, detail };
}

function alterCommand(
  relation: RangeVar | undefined,
  command: AlterTableCmd,
  conditional: boolean,
): Change {
  const table = relationName(relation);
  const target = relationTarget(relation);
  const columnTarget = target && command.name ? { ...target, column: command.name } : undefined;
  const object = command.name ? `${table}.${identifier(command.name)}` : table;
  const condition = command.missing_ok ? " IF EXISTS" : "";
  const cascade = command.behavior === "DROP_CASCADE" ? " CASCADE" : "";

  switch (command.subtype) {
    case "AT_EnableRowSecurity":
      if (!target) return unsupported("ENABLE ROW LEVEL SECURITY has an unresolved target.");
      return {
        operation: "enable-row-security",
        object: table,
        target,
        conditional,
        detail: `ENABLE ROW LEVEL SECURITY ON ${table}`,
      };
    case "AT_DropColumn":
      return {
        operation: "drop-column",
        object,
        target: columnTarget,
        conditional: conditional || !!command.missing_ok,
        detail: `DROP COLUMN${condition} ${object}${cascade}`,
      };
    case "AT_AlterColumnType": {
      const type = names(columnDefinition(command.def)?.typeName?.names);
      return {
        operation: "alter-type",
        object,
        target: columnTarget,
        detail: `ALTER COLUMN ${object} TYPE ${type || "(see migration)"}`,
      };
    }
    case "AT_SetNotNull":
      return {
        operation: "set-not-null",
        object,
        target: columnTarget,
        detail: `ALTER COLUMN ${object} SET NOT NULL`,
      };
    case "AT_AddConstraint": {
      const constraint =
        command.def && "Constraint" in command.def ? command.def.Constraint : undefined;
      const name = constraint?.conname ? ` ${identifier(constraint.conname)}` : "";
      return {
        operation: "add-constraint",
        object: table,
        target,
        detail: `ADD CONSTRAINT${name} (${constraint?.contype?.replace("CONSTR_", "") ?? "see migration"}) ON ${table}`,
      };
    }
    case "AT_DropConstraint":
      return {
        operation: "drop-constraint",
        object,
        target,
        detail: `DROP CONSTRAINT${condition} ${object}${cascade}`,
      };
    case "AT_AddColumn": {
      const column = columnDefinition(command.def);
      const type = names(column?.typeName?.names);
      const columnName = column?.colname ? `${table}.${identifier(column.colname)}` : table;
      const serialTypes = ["serial", "smallserial", "bigserial", "serial2", "serial4", "serial8"];
      if (
        !column?.colname ||
        column.constraints?.length ||
        column.raw_default ||
        column.generated ||
        column.identity ||
        column.is_not_null ||
        serialTypes.includes(type)
      ) {
        return unsupported(
          `ADD COLUMN ${columnName} uses a definition outside nullable-column coverage.`,
          columnName,
        );
      }
      return {
        operation: "add-column",
        object: columnName,
        dataType: type,
        target: target ? { ...target, column: column.colname } : undefined,
        detail: `ADD COLUMN ${columnName} ${type}`.trimEnd(),
      };
    }
    default:
      return unsupported(
        `ALTER TABLE clause ${command.subtype ?? "unknown"} requires review.`,
        table,
      );
  }
}

function createTable(statement: CreateStmt): Change {
  const target = relationTarget(statement.relation);
  const object = relationName(statement.relation);
  const outsideCoverage = () => ({
    ...unsupported("CREATE TABLE uses a definition outside simple table coverage.", object),
    unsupportedNode: "CreateStmt",
  });
  if (
    !target ||
    statement.relation?.relpersistence !== "p" ||
    statement.inhRelations?.length ||
    statement.partbound ||
    statement.partspec ||
    statement.ofTypename ||
    statement.constraints?.length ||
    statement.options?.length
  )
    return outsideCoverage();

  const columns: string[] = [];
  for (const element of statement.tableElts ?? []) {
    if (
      "Constraint" in element &&
      ["CONSTR_PRIMARY", "CONSTR_UNIQUE"].includes(element.Constraint.contype ?? "")
    )
      continue;
    const column = columnDefinition(element);
    if (
      !column?.colname ||
      !isBuiltinType(names(column.typeName?.names)) ||
      column.raw_default ||
      column.generated ||
      column.identity ||
      column.constraints?.some(
        (node) =>
          !("Constraint" in node) ||
          !["CONSTR_PRIMARY", "CONSTR_UNIQUE", "CONSTR_NOTNULL", "CONSTR_NULL"].includes(
            node.Constraint.contype ?? "",
          ),
      )
    )
      return outsideCoverage();
    columns.push(column.colname);
  }
  return {
    operation: "create-table",
    object,
    target,
    columns,
    conditional: !!statement.if_not_exists,
    detail: `CREATE TABLE${statement.if_not_exists ? " IF NOT EXISTS" : ""} ${object}`,
  };
}

function changesFor(node: Node): Change[] {
  if ("CreateStmt" in node) return [createTable(node.CreateStmt)];
  const drop = "DropStmt" in node ? node.DropStmt : undefined;
  if (drop?.removeType === "OBJECT_TABLE" || drop?.removeType === "OBJECT_INDEX") {
    const table = drop.removeType === "OBJECT_TABLE";
    const keyword = table ? "TABLE" : "INDEX";
    const concurrent = drop.concurrent ? " CONCURRENTLY" : "";
    const condition = drop.missing_ok ? " IF EXISTS" : "";
    const cascade = drop.behavior === "DROP_CASCADE" ? " CASCADE" : "";
    return (drop.objects ?? []).map((item) => {
      const parts = nameParts("List" in item ? item.List.items : undefined);
      const object = qualified(parts);
      const name = parts.at(-1);
      return {
        operation: table ? "drop-table" : "drop-index",
        object,
        target:
          table && name && parts.length <= 2
            ? { schema: parts.length === 2 ? parts[0] : undefined, table: name }
            : undefined,
        conditional: !!drop.missing_ok,
        detail: `DROP ${keyword}${concurrent}${condition} ${object}${cascade}`,
        concurrent: !!drop.concurrent,
      };
    });
  }

  const alter = "AlterTableStmt" in node ? node.AlterTableStmt : undefined;
  if (alter?.objtype === "OBJECT_TABLE") {
    const table = relationName(alter.relation);
    return (alter.cmds ?? []).map((item) =>
      "AlterTableCmd" in item
        ? alterCommand(alter.relation, item.AlterTableCmd, !!alter.missing_ok)
        : unsupported("Unrecognized ALTER TABLE clause.", table),
    );
  }

  const rename = "RenameStmt" in node ? node.RenameStmt : undefined;
  if (
    rename?.renameType === "OBJECT_COLUMN" &&
    rename.relationType === "OBJECT_TABLE" &&
    rename.subname &&
    rename.newname
  ) {
    const table = relationName(rename.relation);
    const target = relationTarget(rename.relation);
    const object = `${table}.${identifier(rename.subname)}`;
    return [
      {
        operation: "rename-column",
        object,
        target: target ? { ...target, column: rename.subname } : undefined,
        newColumn: rename.newname,
        conditional: !!rename.missing_ok,
        detail: `RENAME COLUMN ${object} TO ${identifier(rename.newname)}`,
      },
    ];
  }

  const index = "IndexStmt" in node ? node.IndexStmt : undefined;
  if (index) {
    const table = relationName(index.relation);
    const unique = index.unique ? " UNIQUE" : "";
    const concurrent = index.concurrent ? " CONCURRENTLY" : "";
    const name = index.idxname ? ` ${identifier(index.idxname)}` : "";
    return [
      {
        operation: "create-index",
        object: table,
        target: relationTarget(index.relation),
        detail: `CREATE${unique} INDEX${concurrent}${name} ON ${table}`,
        concurrent: !!index.concurrent,
        unique: !!index.unique,
      },
    ];
  }

  const unsupportedNode = Object.keys(node)[0] ?? "unknown";
  return [
    { ...unsupported(`PostgreSQL AST node ${unsupportedNode} requires review.`), unsupportedNode },
  ];
}

function atOffset(path: string, bytes: Buffer, byteOffset: number): SourceLocation {
  const prefix = bytes.subarray(0, byteOffset).toString("utf8").split("\n");
  return { path, line: prefix.length, column: Array.from(prefix.at(-1) ?? "").length + 1 };
}

function withLocation(change: Change, location: SourceLocation, ordinal: number): SchemaChange {
  const id = createHash("sha256")
    .update(JSON.stringify([location, change.operation, change.object, ordinal]))
    .digest("hex")
    .slice(0, 24);
  return { ...change, location, id };
}

export async function readPostgres(
  file: MigrationFile,
): Promise<FileResult & { parserVersion: number }> {
  const { path, sql } = file;
  const bytes = Buffer.from(sql);
  let ast: Awaited<ReturnType<typeof parse>>;
  try {
    ast = await parse(sql);
  } catch (error) {
    if (!hasSqlDetails(error)) throw error;
    const cursor = Math.max(0, error.sqlDetails?.cursorPosition ?? 0);
    const offset = Buffer.byteLength(Array.from(sql).slice(0, cursor).join(""));
    const change = {
      operation: "parse-error",
      object: null,
      detail: "PostgreSQL rejected the migration syntax.",
    } as const;
    return {
      path,
      parserVersion: POSTGRES_AST_VERSION,
      coverage: "parse-error",
      statements: 0,
      changes: [withLocation(change, atOffset(path, bytes, offset), 0)],
    };
  }

  const changes: SchemaChange[] = [];
  const statements = ast.stmts ?? [];
  for (const [index, statement] of statements.entries()) {
    const location = atOffset(path, bytes, statement.stmt_location ?? 0);
    if (index >= MAX_STATEMENTS || changes.length >= MAX_CHANGES) {
      changes.push(
        withLocation(
          unsupported("File exceeds the statement or operation analysis limit."),
          location,
          0,
        ),
      );
      break;
    }
    const normalized = statement.stmt
      ? changesFor(statement.stmt)
      : [unsupported("Empty AST node.")];
    if (normalized.length + changes.length > MAX_CHANGES) {
      changes.push(
        withLocation(unsupported("Statement exceeds the operation analysis limit."), location, 0),
      );
      break;
    }
    changes.push(...normalized.map((change, ordinal) => withLocation(change, location, ordinal)));
  }

  return {
    path,
    statements: statements.length,
    changes,
    parserVersion: ast.version ?? POSTGRES_AST_VERSION,
    coverage: changes.some((change) => change.operation === "unsupported") ? "partial" : "covered",
  };
}

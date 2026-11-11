import { hasSqlDetails, type Node, parse, type RangeVar, type ReturningClause } from "libpg-query";
import type { DatabaseObject } from "../contracts";
import { relationTarget } from "../identifiers";
import { type Catalog, tableKey } from "./catalog";
import type { DependencyEvidence, EvidenceConfidence, GapKind } from "./contracts";

type Statement = DependencyEvidence["statement"];
type Access = DependencyEvidence["access"];
type Emit = (
  statement: Statement,
  access: Access,
  target: DatabaseObject,
  confidence: EvidenceConfidence,
  writeTarget?: boolean,
) => void;
type Gap = (kind: GapKind, message: string) => void;
type Binding = { target: DatabaseObject; alias?: string; renamedColumns: boolean };
type Scope = { bindings: Binding[]; complete: boolean };

const nodeName = (node: Node) => ("String" in node ? node.String.sval : undefined);

export function queryParser() {
  const parsed = new Map<string, Promise<Node[] | null>>();
  return (sql: string) => {
    let cached = parsed.get(sql);
    if (!cached) {
      cached = parse(sql).then(
        (ast) => (ast.stmts ?? []).flatMap(({ stmt }) => (stmt ? [stmt] : [])),
        (error: unknown) => {
          if (hasSqlDetails(error)) return null;
          throw error;
        },
      );
      if (parsed.size < 256) parsed.set(sql, cached);
    }
    return cached;
  };
}

export function inspectSql(
  nodes: Node[],
  defaultSchema: string,
  catalog: Catalog | undefined,
  emit: Emit,
  gap: Gap,
) {
  function relation(value: RangeVar | undefined, statement: Statement, writeTarget = false): Scope {
    const target = relationTarget(value);
    if (!target) {
      gap("unresolved-reference", "A table reference could not be bound to this database.");
      return { bindings: [], complete: false };
    }
    target.schema ??= defaultSchema;
    emit(statement, "table", target, "high", writeTarget);
    const renamedColumns = !!value?.alias?.colnames?.length;
    if (renamedColumns)
      gap("unresolved-reference", "Positional table-column aliases require manual binding.");
    return {
      bindings: [{ target, alias: value?.alias?.aliasname, renamedColumns }],
      complete: !renamedColumns,
    };
  }

  function column(fields: Node[], scope: Scope, statement: Statement) {
    const parts = fields.map(nodeName);
    const star = fields.at(-1);
    const wildcard = !!star && "A_Star" in star;
    const name = parts.at(-1);
    const qualifiers = parts.slice(0, -1);
    if ((!wildcard && name === undefined) || qualifiers.some((part) => part === undefined)) return;
    let candidates = scope.bindings;
    if (qualifiers.length === 1) {
      candidates = candidates.filter(
        ({ alias, target }) => (alias ?? target.table) === qualifiers[0],
      );
    } else if (qualifiers.length === 2) {
      candidates = candidates.filter(
        ({ alias, target }) =>
          !alias && target.schema === qualifiers[0] && target.table === qualifiers[1],
      );
    } else if (qualifiers.length) {
      candidates = [];
    }
    if (
      !qualifiers.length &&
      !wildcard &&
      candidates.length > 1 &&
      scope.complete &&
      catalog &&
      candidates.every(({ target }) => catalog.has(tableKey(target, defaultSchema)))
    ) {
      candidates = candidates.filter(
        ({ target }) =>
          name !== undefined && catalog.get(tableKey(target, defaultSchema))?.has(name),
      );
    }
    if (wildcard) {
      for (const { target } of candidates) emit(statement, "wildcard", target, "medium");
      if (candidates.length) return;
    }
    const bound =
      candidates.length === 1 &&
      (scope.complete || qualifiers.length > 0) &&
      !candidates[0]?.renamedColumns;
    if (!bound)
      gap(
        "unresolved-reference",
        "A column could not be attributed to a single table in its SQL scope.",
      );
    for (const { target, renamedColumns } of candidates) {
      if (!renamedColumns && name !== undefined)
        emit(statement, "column", { ...target, column: name }, bound ? "high" : "low");
    }
  }

  function expression(value: unknown, scope: Scope, statement: Statement) {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value) expression(item, scope, statement);
      return;
    }
    const node = value as Node;
    if ("FuncCall" in node && node.FuncCall.funcname?.map(nodeName).at(-1) === "set_config")
      gap("runtime-schema", "A SQL configuration function may change runtime schema resolution.");
    if ("ColumnRef" in node) return column(node.ColumnRef.fields ?? [], scope, statement);
    if ("SubLink" in node || "SelectStmt" in node) {
      gap("unsupported-sql", "Nested or correlated SQL queries require separate scope analysis.");
      return;
    }
    for (const child of Object.values(value)) expression(child, scope, statement);
  }

  function combine(scopes: Scope[]): Scope {
    return {
      bindings: scopes.flatMap(({ bindings }) => bindings),
      complete: scopes.every(({ complete }) => complete),
    };
  }

  function from(node: Node, statement: Statement): Scope {
    if ("RangeVar" in node) return relation(node.RangeVar, statement);
    if (!("JoinExpr" in node)) {
      gap(
        "unsupported-sql",
        "Derived tables, functions, and other FROM sources need manual review.",
      );
      return { bindings: [], complete: false };
    }
    const join = node.JoinExpr;
    const left = combine(join.larg ? [from(join.larg, statement)] : []);
    const right = combine(join.rarg ? [from(join.rarg, statement)] : []);
    const scope = combine([left, right]);
    expression(join.quals, scope, statement);
    if (join.usingClause?.length) {
      for (const field of join.usingClause) {
        column([field], left, statement);
        column([field], right, statement);
      }
    }
    if (join.alias || join.join_using_alias || join.isNatural) {
      gap(
        "unresolved-reference",
        "Natural joins and aliased join outputs require manual column binding.",
      );
    }
    if (join.alias) return { bindings: [], complete: false };
    if (join.join_using_alias || join.isNatural || join.usingClause?.length)
      return { ...scope, complete: false };
    return scope;
  }

  function returning(clause: ReturningClause | undefined, scope: Scope, statement: Statement) {
    if (clause?.options?.length) {
      gap("unsupported-sql", "RETURNING aliases for old and new records require manual binding.");
      return;
    }
    expression(clause?.exprs, scope, statement);
  }

  function targetColumns(items: Node[] | undefined, target: Scope, statement: Statement) {
    const table = target.bindings[0]?.target;
    if (!table) return;
    for (const item of items ?? []) {
      if ("ResTarget" in item && item.ResTarget.name) {
        emit(statement, "column", { ...table, column: item.ResTarget.name }, "high");
      }
    }
  }

  function inspect(node: Node) {
    if (
      "VariableSetStmt" in node ||
      ("CreateStmt" in node && node.CreateStmt.relation?.relpersistence === "t")
    ) {
      gap(
        "runtime-schema",
        "Session SQL settings require verification of runtime schema resolution.",
      );
      return;
    }
    if ("SelectStmt" in node) {
      const select = node.SelectStmt;
      if (select.withClause || select.intoClause || (select.op && select.op !== "SETOP_NONE")) {
        gap(
          "unsupported-sql",
          "CTEs, set operations, and SELECT INTO are outside SQL scope coverage.",
        );
        return;
      }
      const scope = combine((select.fromClause ?? []).map((entry) => from(entry, "select")));
      expression(
        [
          select.targetList,
          select.whereClause,
          select.havingClause,
          select.valuesLists,
          select.limitCount,
          select.limitOffset,
        ],
        scope,
        "select",
      );
      if (
        select.sortClause?.length ||
        select.groupClause?.length ||
        select.distinctClause?.some((entry) => !!entry) ||
        select.windowClause?.length
      ) {
        gap(
          "unsupported-sql",
          "Ordering, grouping, distinct expressions, or named windows can reference output aliases and need manual review.",
        );
      }
      return;
    }
    if ("InsertStmt" in node) {
      const insert = node.InsertStmt;
      if (insert.withClause)
        return gap("unsupported-sql", "CTE-based INSERT requires manual scope analysis.");
      const target = relation(insert.relation, "insert", true);
      if (!insert.cols?.length && target.bindings[0])
        emit("insert", "wildcard", target.bindings[0].target, "medium");
      targetColumns(insert.cols, target, "insert");
      returning(insert.returningClause, target, "insert");
      if (insert.selectStmt) inspect(insert.selectStmt);
      if (insert.onConflictClause)
        gap("unsupported-sql", "ON CONFLICT expressions require manual review.");
      return;
    }
    if ("UpdateStmt" in node) {
      const update = node.UpdateStmt;
      if (update.withClause)
        return gap("unsupported-sql", "CTE-based UPDATE requires manual scope analysis.");
      const target = relation(update.relation, "update", true);
      const scope = combine([
        target,
        ...(update.fromClause ?? []).map((entry) => from(entry, "update")),
      ]);
      targetColumns(update.targetList, target, "update");
      expression([update.targetList, update.whereClause], scope, "update");
      returning(update.returningClause, scope, "update");
      return;
    }
    if ("DeleteStmt" in node) {
      const deletion = node.DeleteStmt;
      if (deletion.withClause)
        return gap("unsupported-sql", "CTE-based DELETE requires manual scope analysis.");
      const scope = combine([
        relation(deletion.relation, "delete"),
        ...(deletion.usingClause ?? []).map((entry) => from(entry, "delete")),
      ]);
      expression(deletion.whereClause, scope, "delete");
      returning(deletion.returningClause, scope, "delete");
      return;
    }
    gap(
      "unsupported-sql",
      "The PostgreSQL statement is outside SELECT, INSERT, UPDATE, and DELETE coverage.",
    );
  }

  for (const node of nodes) inspect(node);
}

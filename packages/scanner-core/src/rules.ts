import type { RuleDefinition } from "./contracts";

export const rules: readonly RuleDefinition[] = [
  {
    id: "PG001",
    title: "Table removal",
    severity: "critical",
    confidence: "potential",
    description: "Dropping a table can remove data and break queries from an earlier release.",
    mitigation:
      "Remove usage in a prior release and verify recovery from a backup before dropping the table.",
    matches: ({ operation }) => operation === "drop-table",
  },
  {
    id: "PG002",
    title: "Column removal",
    severity: "high",
    confidence: "potential",
    description:
      "An earlier release may still issue queries that read or write the removed column.",
    mitigation:
      "Remove column dependencies in a prior release and test the rollback build against the migrated schema.",
    matches: ({ operation }) => operation === "drop-column",
  },
  {
    id: "PG003",
    title: "Column rename",
    severity: "high",
    confidence: "potential",
    description: "Earlier releases may still refer to the old column name.",
    mitigation:
      "Add the new column, backfill it, switch readers and writers, then remove the old column after the rollback window.",
    matches: ({ operation }) => operation === "rename-column",
  },
  {
    id: "PG004",
    title: "Column type change",
    severity: "high",
    confidence: "potential",
    description:
      "A new type can reject old writes, change returned values, or require a table rewrite.",
    mitigation:
      "Test representative casts and old-version reads and writes against a migrated copy.",
    matches: ({ operation }) => operation === "alter-type",
  },
  {
    id: "PG005",
    title: "New NOT NULL requirement",
    severity: "medium",
    confidence: "potential",
    description:
      "Existing null values or writes from an earlier release can violate this requirement.",
    mitigation:
      "Backfill null values, verify earlier writers, and plan constraint validation separately.",
    matches: ({ operation }) => operation === "set-not-null",
  },
  {
    id: "PG006",
    title: "Constraint compatibility",
    severity: "medium",
    confidence: "potential",
    description:
      "Adding or removing a constraint can change which writes succeed or which guarantees the application relies on.",
    mitigation:
      "Check representative writes and dependent queries against the new constraint behavior.",
    matches: ({ operation }) => operation === "add-constraint" || operation === "drop-constraint",
  },
  {
    id: "PG007",
    title: "Potential lock impact",
    severity: "medium",
    confidence: "potential",
    description:
      "This DDL can acquire locks that contend with application traffic. Impact depends on the database and workload.",
    mitigation:
      "Review PostgreSQL lock modes and rehearse the migration under representative load with a lock timeout.",
    matches: ({ operation, concurrent }) =>
      operation === "alter-type" ||
      operation === "set-not-null" ||
      ((operation === "create-index" || operation === "drop-index") && !concurrent),
  },
  {
    id: "PG008",
    title: "Index behavior change",
    severity: "medium",
    confidence: "potential",
    description:
      "A new unique index can reject writes. Removing an index can change query plans or remove a uniqueness guarantee.",
    mitigation:
      "Check catalog metadata and representative writes and query plans before changing the index.",
    matches: ({ operation, unique }) =>
      operation === "drop-index" || (operation === "create-index" && !!unique),
  },
  {
    id: "PG900",
    title: "Manual review required",
    severity: "info",
    confidence: "unknown",
    description:
      "The parser recognized this statement or clause. The active rules do not analyze its effects.",
    mitigation:
      "Review the statement with the database catalog and run a migration rehearsal before deciding whether to deploy.",
    matches: ({ operation }) => operation === "unsupported",
  },
  {
    id: "PG901",
    title: "SQL could not be parsed",
    severity: "high",
    confidence: "unknown",
    description: "The parser rejected this migration file, leaving its operations unanalyzed.",
    mitigation: "Check the file against the target PostgreSQL syntax and rerun the scan.",
    matches: ({ operation }) => operation === "parse-error",
  },
];

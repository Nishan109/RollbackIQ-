import type { SchemaChange, Severity } from "../contracts";
import { sameTable } from "./catalog";
import type { CompatibilityFinding, DependencyEvidence } from "./contracts";

export const compatibilityRules = [
  {
    id: "COMPAT001",
    title: "Removed column referenced by previous release",
    description: "A previous-release query depends on a removed column.",
  },
  {
    id: "COMPAT002",
    title: "Removed table referenced by previous release",
    description: "A previous-release query depends on a removed table.",
  },
  {
    id: "COMPAT003",
    title: "Renamed column referenced by previous release",
    description: "A previous-release query uses the previous column name.",
  },
  {
    id: "COMPAT004",
    title: "Column type compatibility risk",
    description: "A type change can change the behavior of a previous-release query.",
  },
  {
    id: "COMPAT005",
    title: "New NOT NULL write compatibility risk",
    description: "A previous-release writer targets a table with a new NOT NULL requirement.",
  },
  {
    id: "COMPAT006",
    title: "Constraint modification compatibility risk",
    description: "A previous-release query can depend on the prior constraint behavior.",
  },
  {
    id: "COMPAT007",
    title: "Dynamic SQL coverage gap",
    description: "Dynamic SQL prevents reliable object resolution.",
  },
  {
    id: "COMPAT008",
    title: "Unsupported database operation",
    description: "A migration operation requires manual analysis.",
  },
  {
    id: "COMPAT009",
    title: "Previous release is unavailable",
    description: "The requested previous Git revision could not be resolved.",
  },
  {
    id: "COMPAT010",
    title: "Incomplete compatibility coverage",
    description: "A parsing, schema, source or history limitation affects coverage.",
  },
] as const;

export function dependenciesFor(
  change: SchemaChange,
  references: DependencyEvidence[],
  defaultSchema: string,
) {
  const target = change.target;
  if (!target) return [];
  return references.filter((reference) => {
    if (!sameTable(target, reference.target, defaultSchema)) return false;
    if (change.operation === "set-not-null") return reference.writeTarget;
    if (change.operation === "add-column") return reference.access === "wildcard";
    if (change.operation === "add-constraint" || change.operation === "drop-constraint")
      return true;
    if (!target.column) return true;
    return reference.access === "wildcard" || reference.target.column === target.column;
  });
}

export function changeRule(
  change: SchemaChange,
):
  | { ruleId: CompatibilityFinding["ruleId"]; severity: Severity; recommendation: string }
  | undefined {
  switch (change.operation) {
    case "drop-column":
      return {
        ruleId: "COMPAT001",
        severity: "critical",
        recommendation:
          "Retain the column through a compatibility transition. Deploy readers and writers that support the replacement, backfill when needed, and remove the column after dependent releases are retired.",
      };
    case "drop-table":
      return {
        ruleId: "COMPAT002",
        severity: "critical",
        recommendation:
          "Retain the table during the rollback window, retire dependent application releases, and verify a recovery path before removing it.",
      };
    case "rename-column":
      return {
        ruleId: "COMPAT003",
        severity: "critical",
        recommendation:
          "Introduce the replacement column alongside the old name, migrate readers and writers, and retire the old name after its dependent releases leave the rollback window.",
      };
    case "alter-type":
      return {
        ruleId: "COMPAT004",
        severity: "high",
        recommendation:
          "Test previous-release parameter types, returned values and representative casts against the proposed schema. Check whether this change rewrites the table.",
      };
    case "set-not-null":
      return {
        ruleId: "COMPAT005",
        severity: "high",
        recommendation:
          "Inspect previous-release inserts and updates, defaults and triggers. Backfill nulls and run the previous application against the new requirement before enforcement.",
      };
    case "add-constraint":
    case "drop-constraint":
      return {
        ruleId: "COMPAT006",
        severity: "medium",
        recommendation:
          "Rehearse previous-release writes, conflict handling and dependent queries against the changed uniqueness, foreign-key or check behavior.",
      };
    case "add-column":
      return {
        ruleId: "COMPAT010",
        severity: "high",
        recommendation:
          "Use explicit INSERT column lists and SELECT projections. Verify clients that depend on column order or returned record shape against the added column.",
      };
    default:
      return undefined;
  }
}

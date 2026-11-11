import type { ScanReport } from "@rollbackiq/scanner-core";
import type { CompatibilityReport } from "@rollbackiq/scanner-core/compatibility/contracts";
import { z } from "zod";

const text = z.string().max(4096);
const shortText = z.string().max(512);
const severity = z.enum(["critical", "high", "medium", "low", "info"]);
const confidence = z.enum(["high", "medium", "low"]);
const location = z.object({
  path: shortText,
  line: z.number().int().min(1),
  column: z.number().int().min(1),
});
const target = z.object({
  schema: shortText.optional(),
  table: shortText,
  column: shortText.optional(),
});
const evidence = z.object({
  queryId: shortText,
  kind: z.enum(["static-sql-reference", "prisma-reference"]),
  statement: z.enum(["select", "insert", "update", "delete"]),
  access: z.enum(["table", "column", "wildcard"]),
  target,
  confidence,
  location,
  writeTarget: z.boolean().optional(),
});
const gap = z.object({
  kind: z.enum([
    "dynamic-sql",
    "unsupported-sql",
    "runtime-schema",
    "unresolved-reference",
    "source",
    "schema",
    "migration",
    "history",
    "limit",
  ]),
  scope: z.enum(["previous", "proposed", "migrations", "schema"]),
  message: text,
  location: location.optional(),
});
const graph = z.object({
  files: z.number().int().min(0).max(400),
  queries: z.number().int().min(0),
  references: z.array(evidence).max(12000),
  gaps: z.array(gap).max(4000),
  nodes: z
    .array(
      z.object({
        id: shortText,
        type: z.enum(["release", "file", "query", "table", "column"]),
        label: text,
      }),
    )
    .max(26000),
  edges: z
    .array(
      z.object({
        from: shortText,
        to: shortText,
        kind: z.enum([
          "RELEASE_CONTAINS_FILE",
          "FILE_CONTAINS_QUERY",
          "QUERY_REFERENCES_TABLE",
          "QUERY_REFERENCES_COLUMN",
        ]),
        location: location.optional(),
      }),
    )
    .max(40000),
});
const change = z.object({
  id: shortText,
  operation: z.enum([
    "create-table",
    "enable-row-security",
    "add-column",
    "drop-table",
    "drop-column",
    "rename-column",
    "alter-type",
    "set-not-null",
    "add-constraint",
    "drop-constraint",
    "create-index",
    "drop-index",
    "unsupported",
    "parse-error",
  ]),
  object: text.nullable(),
  detail: text,
  location,
  concurrent: z.boolean().optional(),
  unique: z.boolean().optional(),
  target: target.optional(),
  newColumn: shortText.optional(),
  columns: z.array(shortText).max(1600).optional(),
  conditional: z.boolean().optional(),
  unsupportedNode: shortText.optional(),
  dataType: shortText.optional(),
});
const migrationReport = z.object({
  schemaVersion: z.literal(1),
  analyzerVersion: shortText,
  parserVersion: z.number().int(),
  compatibility: z.literal("unknown"),
  files: z
    .array(
      z.object({
        path: shortText,
        coverage: z.enum(["covered", "partial", "parse-error"]),
        statements: z.number().int().min(0),
        changes: z.array(change).max(2001),
      }),
    )
    .max(50),
  findings: z
    .array(
      z.object({
        id: shortText,
        ruleId: shortText,
        severity,
        confidence: z.enum(["confirmed", "potential", "unknown"]),
        title: text,
        description: text,
        mitigation: text,
        changeId: shortText,
        object: text.nullable(),
        evidence: text,
        location,
      }),
    )
    .max(12000),
  summary: z.object({
    files: z.number().int().min(0),
    statements: z.number().int().min(0),
    changes: z.number().int().min(0),
    incompleteFiles: z.number().int().min(0),
    bySeverity: z.object({
      critical: z.number().int().min(0),
      high: z.number().int().min(0),
      medium: z.number().int().min(0),
      low: z.number().int().min(0),
      info: z.number().int().min(0),
    }),
  }),
});
const release = z.object({
  ref: shortText,
  commit: z
    .string()
    .regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/)
    .optional(),
});
const changedFile = z.object({
  status: z.enum(["added", "modified", "renamed", "deleted"]),
  path: shortText,
  previousPath: shortText.optional(),
});

export const compatibilityReportSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("release-compatibility"),
  previous: release,
  proposed: release,
  defaultSchema: shortText,
  postgresMajor: z.literal(18),
  status: z.enum([
    "incompatible",
    "potentially_incompatible",
    "compatible_within_analyzed_scope",
    "unknown",
  ]),
  migrationReport: migrationReport.nullable(),
  migrationChanges: z.array(changedFile).max(2000),
  sourceChanges: z.array(changedFile).max(2000),
  dependencies: z.object({ previous: graph, proposed: graph }),
  findings: z
    .array(
      z.object({
        id: shortText,
        ruleId: z.enum([
          "COMPAT001",
          "COMPAT002",
          "COMPAT003",
          "COMPAT004",
          "COMPAT005",
          "COMPAT006",
          "COMPAT007",
          "COMPAT008",
          "COMPAT009",
          "COMPAT010",
        ]),
        title: text,
        severity,
        status: z.enum(["incompatible", "potentially_incompatible", "unknown"]),
        confidence,
        object: text.nullable(),
        message: text,
        recommendation: text,
        limitations: z.array(text).max(100),
        location: location.optional(),
        previousEvidence: z.array(evidence).max(12000),
        proposedEvidence: z.array(evidence).max(12000),
      }),
    )
    .max(12000),
  coverage: z.object({
    gaps: z.array(gap).max(8000),
    limitations: z.array(text).max(100),
    baseline: z.enum(["supplied", "absent"]),
  }),
});

export function parseCompatibilityReport(value: unknown): CompatibilityReport {
  const result = compatibilityReportSchema.safeParse(value);
  if (!result.success)
    throw new Error("This file does not match the RollbackIQ compatibility report format.");
  return result.data;
}

export function migrationSummary(report: CompatibilityReport): ScanReport {
  return (
    report.migrationReport ?? {
      schemaVersion: 1,
      analyzerVersion: "0.1.0",
      parserVersion: 180004,
      compatibility: "unknown",
      files: [],
      findings: [],
      summary: {
        files: 0,
        statements: 0,
        changes: 0,
        incompleteFiles: 0,
        bySeverity: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
      },
    }
  );
}

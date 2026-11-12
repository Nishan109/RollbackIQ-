import type {
  DatabaseObject,
  MigrationFile,
  ScanReport,
  Severity,
  SourceLocation,
} from "../contracts";

export type ReleaseSide = "previous" | "proposed";
export type CompatibilityStatus =
  | "incompatible"
  | "potentially_incompatible"
  | "compatible_within_analyzed_scope"
  | "unknown";
export type EvidenceConfidence = "high" | "medium" | "low";

export interface ReleaseReference {
  ref: string;
  commit?: string;
}

export interface SourceFile {
  path: string;
  text: string;
}

export type GapKind =
  | "dynamic-sql"
  | "unsupported-sql"
  | "runtime-schema"
  | "unresolved-reference"
  | "source"
  | "schema"
  | "migration"
  | "history"
  | "limit";

export interface CoverageGap {
  kind: GapKind;
  scope: ReleaseSide | "migrations" | "schema";
  message: string;
  location?: SourceLocation;
}

export interface Snapshot {
  release: ReleaseReference;
  sources: readonly SourceFile[];
  prisma?: SourceFile;
  typescriptConfigs?: readonly SourceFile[];
}

export interface ChangedFile {
  status: "added" | "modified" | "renamed" | "deleted";
  path: string;
  previousPath?: string;
}

export interface CompatibilityInput {
  previous: Snapshot;
  proposed: Snapshot;
  migrations: readonly MigrationFile[];
  migrationChanges?: readonly ChangedFile[];
  sourceChanges?: readonly ChangedFile[];
  baseline?: MigrationFile;
  gaps?: readonly CoverageGap[];
  defaultSchema?: string;
  postgresMajor?: 18;
}

export interface DependencyEvidence {
  queryId: string;
  kind: "static-sql-reference" | "prisma-reference";
  statement: "select" | "insert" | "update" | "delete";
  access: "table" | "column" | "wildcard";
  target: DatabaseObject;
  confidence: EvidenceConfidence;
  writeTarget?: boolean;
  location: SourceLocation;
}

export interface DependencyGraph {
  files: number;
  queries: number;
  references: DependencyEvidence[];
  gaps: CoverageGap[];
  nodes: { id: string; type: "release" | "file" | "query" | "table" | "column"; label: string }[];
  edges: {
    from: string;
    to: string;
    kind:
      | "RELEASE_CONTAINS_FILE"
      | "FILE_CONTAINS_QUERY"
      | "QUERY_REFERENCES_TABLE"
      | "QUERY_REFERENCES_COLUMN";
    location?: SourceLocation;
  }[];
}

export type CompatibilityRuleId = `COMPAT00${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9}` | "COMPAT010";

export interface CompatibilityFinding {
  id: string;
  ruleId: CompatibilityRuleId;
  title: string;
  severity: Severity;
  status: Exclude<CompatibilityStatus, "compatible_within_analyzed_scope">;
  confidence: EvidenceConfidence;
  object: string | null;
  message: string;
  recommendation: string;
  limitations: string[];
  location?: SourceLocation;
  previousEvidence: DependencyEvidence[];
  proposedEvidence: DependencyEvidence[];
}

export interface CompatibilityReport {
  schemaVersion: 1;
  kind: "release-compatibility";
  previous: ReleaseReference;
  proposed: ReleaseReference;
  defaultSchema: string;
  postgresMajor: 18;
  status: CompatibilityStatus;
  migrationReport: ScanReport | null;
  migrationChanges: readonly ChangedFile[];
  sourceChanges: readonly ChangedFile[];
  dependencies: Record<ReleaseSide, DependencyGraph>;
  findings: CompatibilityFinding[];
  coverage: { gaps: CoverageGap[]; limitations: string[]; baseline: "supplied" | "absent" };
}

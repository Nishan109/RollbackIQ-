export const severities = ["critical", "high", "medium", "low", "info"] as const;
export type Severity = (typeof severities)[number];
export type Confidence = "confirmed" | "potential" | "unknown";
export type Coverage = "covered" | "partial" | "parse-error";

export const MAX_FILES = 50;
export const MAX_FILE_BYTES = 256 * 1024;
export const MAX_TOTAL_BYTES = 1024 * 1024;
export const ANALYZER_VERSION = "0.1.0";

export interface MigrationFile {
  path: string;
  sql: string;
}

export interface SourceLocation {
  path: string;
  line: number;
  column: number;
}

export interface DatabaseObject {
  schema?: string;
  table: string;
  column?: string;
}

export type Operation =
  | "create-table"
  | "enable-row-security"
  | "add-column"
  | "drop-table"
  | "drop-column"
  | "rename-column"
  | "alter-type"
  | "set-not-null"
  | "add-constraint"
  | "drop-constraint"
  | "create-index"
  | "drop-index"
  | "unsupported"
  | "parse-error";

export interface SchemaChange {
  id: string;
  operation: Operation;
  object: string | null;
  detail: string;
  location: SourceLocation;
  concurrent?: boolean;
  unique?: boolean;
  target?: DatabaseObject;
  newColumn?: string;
  columns?: string[];
  conditional?: boolean;
  unsupportedNode?: string;
  dataType?: string;
}

export interface RuleDefinition {
  id: string;
  title: string;
  severity: Severity;
  confidence: Confidence;
  description: string;
  mitigation: string;
  matches(change: SchemaChange): boolean;
}

export interface Finding {
  id: string;
  ruleId: string;
  severity: Severity;
  confidence: Confidence;
  title: string;
  description: string;
  mitigation: string;
  changeId: string;
  object: string | null;
  evidence: string;
  location: SourceLocation;
}

export interface FileResult {
  path: string;
  coverage: Coverage;
  statements: number;
  changes: SchemaChange[];
}

export interface ScanReport {
  schemaVersion: 1;
  analyzerVersion: string;
  parserVersion: number;
  compatibility: "unknown";
  files: FileResult[];
  findings: Finding[];
  summary: {
    files: number;
    statements: number;
    changes: number;
    incompleteFiles: number;
    bySeverity: Record<Severity, number>;
  };
}

export interface ScanPolicy {
  failOn: Severity | "none";
  failOnIncomplete: boolean;
}

export interface PolicyDecision {
  blocked: boolean;
  findingIds: string[];
  incompleteFiles: string[];
}

import {
  ANALYZER_VERSION,
  type Finding,
  MAX_FILE_BYTES,
  MAX_FILES,
  MAX_TOTAL_BYTES,
  type MigrationFile,
  type PolicyDecision,
  type ScanPolicy,
  type ScanReport,
  severities,
} from "./contracts";
import { readPostgres } from "./postgres";
import { rules } from "./rules";

export * from "./contracts";
export { toSarif } from "./sarif";

export function isMigrationPath(path: string) {
  return (
    path.length <= 512 &&
    path.toLowerCase().endsWith(".sql") &&
    !/[\\:\p{Cc}\p{Cf}]/u.test(path) &&
    path.split("/").every((part) => part && part !== "." && part !== "..")
  );
}

export async function scanMigrations(files: readonly MigrationFile[]): Promise<ScanReport> {
  if (!files.length || files.length > MAX_FILES) {
    throw new RangeError(`Provide between 1 and ${MAX_FILES} migration files.`);
  }

  const paths = new Set<string>();
  let totalBytes = 0;
  for (const file of files) {
    if (!isMigrationPath(file.path) || paths.has(file.path)) {
      throw new TypeError("Each migration needs a unique, relative .sql report path.");
    }
    paths.add(file.path);
    const bytes = Buffer.byteLength(file.sql);
    totalBytes += bytes;
    if (bytes > MAX_FILE_BYTES || totalBytes > MAX_TOTAL_BYTES || file.sql.includes("\0")) {
      throw new RangeError("Migration input exceeds the byte limit or contains a null byte.");
    }
  }

  const findings: Finding[] = [];
  const results: ScanReport["files"] = [];
  const bySeverity: ScanReport["summary"]["bySeverity"] = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
  };
  let parserVersion = 0;
  for (const file of files) {
    const { parserVersion: version, ...result } = await readPostgres(file);
    parserVersion = version;
    results.push(result);
    for (const change of result.changes) {
      for (const rule of rules.filter((candidate) => candidate.matches(change))) {
        findings.push({
          id: `${rule.id}-${change.id}`,
          ruleId: rule.id,
          severity: rule.severity,
          confidence: rule.confidence,
          title: rule.title,
          description: rule.description,
          mitigation: rule.mitigation,
          changeId: change.id,
          object: change.object,
          evidence: change.detail,
          location: change.location,
        });
        bySeverity[rule.severity] += 1;
      }
    }
  }

  return {
    schemaVersion: 1,
    analyzerVersion: ANALYZER_VERSION,
    parserVersion,
    compatibility: "unknown",
    files: results,
    findings,
    summary: {
      files: results.length,
      statements: results.reduce((count, file) => count + file.statements, 0),
      changes: results.reduce((count, file) => count + file.changes.length, 0),
      incompleteFiles: results.filter((file) => file.coverage !== "covered").length,
      bySeverity,
    },
  };
}

export function evaluatePolicy(report: ScanReport, policy: ScanPolicy): PolicyDecision {
  const threshold = policy.failOn === "none" ? -1 : severities.indexOf(policy.failOn);
  const findingIds = report.findings
    .filter((finding) => severities.indexOf(finding.severity) <= threshold)
    .map(({ id }) => id);
  const incompleteFiles = policy.failOnIncomplete
    ? report.files.filter((file) => file.coverage !== "covered").map(({ path }) => path)
    : [];
  return {
    blocked: findingIds.length > 0 || incompleteFiles.length > 0,
    findingIds,
    incompleteFiles,
  };
}

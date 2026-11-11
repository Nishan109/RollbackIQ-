import { appendFile } from "node:fs/promises";
import type { CompatibilityReport } from "@rollbackiq/scanner-core/compatibility/contracts";

export function escapeAnnotation(value: string) {
  return value.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
}

export async function compatibilityGithub(report: CompatibilityReport, blocked: boolean) {
  if (process.env.GITHUB_STEP_SUMMARY)
    await appendFile(
      process.env.GITHUB_STEP_SUMMARY,
      [
        "## RollbackIQ previous-release compatibility",
        "",
        `- Status: ${report.status}`,
        `- Previous commit: ${report.previous.commit ?? "Snapshot input"}`,
        `- Proposed commit: ${report.proposed.commit ?? "Snapshot input"}`,
        `- Compatibility findings: ${report.findings.length}`,
        `- Coverage gaps: ${report.coverage.gaps.length}`,
        `- Policy: ${blocked ? "Blocked" : "Passed"}`,
        "",
        "Inspect the JSON and SARIF artifacts for evidence and analysis limitations.",
        "",
      ].join("\n"),
    );
  const findings = [...report.findings, ...(report.migrationReport?.findings ?? [])];
  for (const finding of findings.slice(0, 50)) {
    if (!finding.location) continue;
    const level =
      finding.severity === "critical" || finding.severity === "high"
        ? "error"
        : finding.severity === "info"
          ? "notice"
          : "warning";
    const path = escapeAnnotation(finding.location.path)
      .replaceAll(",", "%2C")
      .replaceAll(":", "%3A");
    process.stdout.write(
      `::${level} file=${path},line=${finding.location.line},col=${finding.location.column}::${escapeAnnotation(`${finding.ruleId} ${finding.title}`)}\n`,
    );
  }
}

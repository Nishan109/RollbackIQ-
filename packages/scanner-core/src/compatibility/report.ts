import { toSarif } from "../sarif";
import type { CompatibilityReport } from "./contracts";
import { compatibilityRules } from "./rules";

export function compatibilitySarif(report: CompatibilityReport) {
  const base = toSarif(report.migrationReport);
  const compat = report.findings.map((finding) => ({
    ruleId: finding.ruleId,
    level:
      finding.severity === "critical" || finding.severity === "high"
        ? "error"
        : finding.severity === "info"
          ? "note"
          : "warning",
    message: { text: `${finding.title}. ${finding.message} ${finding.object ?? ""}`.trimEnd() },
    properties: { compatibilityStatus: finding.status, confidence: finding.confidence },
    partialFingerprints: { rollbackiqFindingId: finding.id },
    locations: finding.location
      ? [
          {
            physicalLocation: {
              artifactLocation: {
                uri: finding.location.path.split("/").map(encodeURIComponent).join("/"),
              },
              region: { startLine: finding.location.line, startColumn: finding.location.column },
            },
          },
        ]
      : [],
    relatedLocations: finding.previousEvidence.map(({ location }, index) => ({
      id: index + 1,
      message: { text: "Previous-release dependency" },
      physicalLocation: {
        artifactLocation: { uri: location.path.split("/").map(encodeURIComponent).join("/") },
        region: { startLine: location.line, startColumn: location.column },
      },
    })),
  }));
  return {
    ...base,
    runs: base.runs.map((run) => ({
      ...run,
      tool: {
        driver: {
          ...run.tool.driver,
          rules: [
            ...run.tool.driver.rules,
            ...compatibilityRules.map(({ id, title, description }) => ({
              id,
              shortDescription: { text: title },
              fullDescription: { text: description },
            })),
          ],
        },
      },
      results: [...run.results, ...compat],
    })),
  };
}

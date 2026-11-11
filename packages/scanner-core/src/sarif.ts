import { ANALYZER_VERSION, type ScanReport, type Severity } from "./contracts";
import { rules } from "./rules";

const levels = {
  critical: "error",
  high: "error",
  medium: "warning",
  low: "note",
  info: "note",
} as const satisfies Record<Severity, string>;

export function toSarif(report: ScanReport | null) {
  return {
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "RollbackIQ",
            version: report?.analyzerVersion ?? ANALYZER_VERSION,
            rules: rules.map((rule) => ({
              id: rule.id,
              shortDescription: { text: rule.title },
              fullDescription: { text: rule.description },
              help: { text: rule.mitigation },
              defaultConfiguration: { level: levels[rule.severity] },
            })),
          },
        },
        results: (report?.findings ?? []).map((finding) => ({
          ruleId: finding.ruleId,
          level: levels[finding.severity],
          message: {
            text: `${finding.title}. ${finding.description} Evidence: ${finding.evidence}`,
          },
          partialFingerprints: { rollbackiqFindingId: finding.id },
          properties: { severity: finding.severity, confidence: finding.confidence },
          locations: [
            {
              physicalLocation: {
                artifactLocation: {
                  uri: finding.location.path.split("/").map(encodeURIComponent).join("/"),
                },
                region: { startLine: finding.location.line, startColumn: finding.location.column },
              },
            },
          ],
        })),
      },
    ],
  };
}

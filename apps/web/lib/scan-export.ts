import { compatibilitySarif } from "@rollbackiq/scanner-core/compatibility";
import { apiJson } from "./bounded-json";
import { compatibilityReportSchema } from "./compatibility-report";

type StoredScan = {
  id: string;
  repository_id: string;
  created_at: string;
  status: string;
  report: unknown;
};

// Call only after the session-bound, RLS-protected scan lookup succeeds.
export function scanResponse(scan: StoredScan, format: string | null) {
  if (format === null) return apiJson(scan);
  if (format !== "json" && format !== "sarif")
    return apiJson({ error: "Choose JSON or SARIF export." }, 400);
  const parsed = compatibilityReportSchema.safeParse(scan.report);
  if (!parsed.success) return apiJson({ error: "This saved report cannot be exported." }, 422);
  const report = parsed.data;
  const savedScan = {
    id: scan.id,
    repositoryId: scan.repository_id,
    createdAt: scan.created_at,
    previousCommit: report.previous.commit,
    proposedCommit: report.proposed.commit,
  };
  const sarif = format === "sarif" ? compatibilitySarif(report) : null;
  const body = sarif
    ? {
        ...sarif,
        runs: sarif.runs.map((run) => ({
          ...run,
          properties: { savedScan, compatibilityStatus: report.status },
        })),
      }
    : { ...(scan.report as Record<string, unknown>), savedScan };
  return new Response(`${JSON.stringify(body, null, 2)}\n`, {
    headers: {
      "Content-Type": format === "sarif" ? "application/sarif+json" : "application/json",
      "Content-Disposition": `attachment; filename="rollbackiq-${encodeURIComponent(scan.id)}.${format}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

import type { MigrationFile, ScanReport } from "@rollbackiq/scanner-core";
import type {
  CompatibilityReport,
  CompatibilityStatus,
} from "@rollbackiq/scanner-core/compatibility/contracts";
import { z } from "zod";
import { compatibilityReportSchema, migrationSummary } from "./compatibility-report";

export type SavedScanSummary = {
  id: string;
  repository_id: string;
  repository_name: string;
  created_at: string;
  status: CompatibilityStatus;
  finding_count: number;
  previous_sha: string;
  proposed_sha: string;
};

export type SavedDashboard = {
  scans: SavedScanSummary[];
  selectedId?: string;
  unavailable: boolean;
  more: boolean;
};

export type WorkspaceRun = {
  id: string;
  origin: "demo" | "sql" | "import" | "saved";
  label: string;
  report: ScanReport;
  files: MigrationFile[];
  time: number | null;
  durationMs: number | null;
  compatibility?: CompatibilityReport;
};

export function savedScanLabel(scan: SavedScanSummary) {
  return `${scan.repository_name} · ${scan.previous_sha.slice(0, 12)} → ${scan.proposed_sha.slice(0, 12)}`;
}

export function savedWorkspaceRun(scan: SavedScanSummary, value: unknown): WorkspaceRun {
  const data = z
    .object({
      id: z.uuid(),
      repository_id: z.uuid(),
      report: compatibilityReportSchema,
    })
    .parse(value);
  if (data.id !== scan.id || data.repository_id !== scan.repository_id)
    throw new Error("The saved report does not match the selected scan.");
  return {
    id: scan.id,
    origin: "saved",
    label: savedScanLabel(scan),
    report: migrationSummary(data.report),
    files: [],
    time: Date.parse(scan.created_at),
    durationMs: null,
    compatibility: data.report,
  };
}

export function workspaceHistory(runs: WorkspaceRun[], saved: SavedScanSummary[]) {
  return [
    ...saved.map((scan) => ({
      id: scan.id,
      label: savedScanLabel(scan),
      trigger: "Saved report",
      findings: scan.finding_count,
      status: scan.status,
      durationMs: null as number | null,
      time: Date.parse(scan.created_at) as number | null,
    })),
    ...runs
      .filter((run) => run.origin !== "saved")
      .map((run) => ({
        id: run.id,
        label: run.label,
        trigger:
          run.origin === "import"
            ? "Report import"
            : run.id === "demo"
              ? "Demo load"
              : run.origin === "demo"
                ? "Demo scan"
                : "Manual",
        findings: run.compatibility?.findings.length ?? run.report.findings.length,
        status: run.compatibility?.status ?? ("unknown" as CompatibilityStatus),
        durationMs: run.durationMs,
        time: run.time,
      })),
  ].sort((a, b) => (b.time ?? 0) - (a.time ?? 0));
}

import { scanConfiguration } from "./github/contracts";
import type { TenantRole } from "./supabase/database";

export function canManageGitHub(role?: TenantRole) {
  return role === "owner" || role === "admin";
}

export function setupProgress({
  organization,
  connections,
  repositories,
}: {
  organization: boolean;
  connections: readonly { installation_id: number; status: string }[];
  repositories: readonly {
    installation_id: number;
    status: string;
    enabled: boolean;
    configuration: unknown;
  }[];
}) {
  const installations = new Set(
    connections.filter(({ status }) => status === "connected").map((row) => row.installation_id),
  );
  const linked = repositories.filter(
    (repo) => repo.status === "connected" && installations.has(repo.installation_id),
  );
  const configured = linked.filter(
    (repo) => scanConfiguration.safeParse(repo.configuration).success,
  );
  return {
    organization,
    github: organization && installations.size > 0,
    repository: organization && linked.length > 0,
    configuration: organization && configured.length > 0,
    automatic: organization && configured.some(({ enabled }) => enabled),
  };
}

export function jobStatus(status: string, reportId: string | null) {
  switch (status) {
    case "queued":
      return "Awaiting processing";
    case "running":
      return "Processing";
    case "completed":
      return reportId ? "Completed" : "Report unavailable";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
    default:
      return "Status unavailable";
  }
}

const verdicts = new Map([
  ["incompatible", "Incompatible"],
  ["potentially_incompatible", "Potentially incompatible"],
  ["compatible_within_analyzed_scope", "Compatible within analyzed scope"],
  ["unknown", "Unknown"],
]);

export function verdictLabel(status: string) {
  return verdicts.get(status) ?? "Verdict unavailable";
}

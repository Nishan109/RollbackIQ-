import { createHash } from "node:crypto";
import type { CompatibilityReport } from "@rollbackiq/scanner-core/compatibility/contracts";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { compatibilityReportSchema } from "../compatibility-report";
import type { SavedScanSummary } from "../workspace-reports";
import type { Database } from "./database";

type Client = SupabaseClient<Database>;
export const idSchema = z.uuid();
const cursorSchema = z.tuple([z.iso.datetime({ offset: true }), idSchema]);

export function scanCursor(value?: string | null) {
  if (!value) return null;
  const parsed = cursorSchema.safeParse(value.split("~"));
  return parsed.success ? parsed.data : null;
}

export async function repositoryFor(client: Client, id: string) {
  const { data } = await client
    .from("repositories")
    .select("id,organization_id,name")
    .eq("id", id)
    .maybeSingle();
  return data;
}

export async function scanPage(
  client: Client,
  repository: { id: string; organization_id: string },
  cursor: ReturnType<typeof scanCursor>,
) {
  let query = client
    .from("scans")
    .select("id,created_at,status,finding_count,previous_sha,proposed_sha")
    .eq("organization_id", repository.organization_id)
    .eq("repository_id", repository.id);
  if (cursor)
    query = query.or(
      `created_at.lt.${cursor[0]},and(created_at.eq.${cursor[0]},id.lt.${cursor[1]})`,
    );
  const { data, error } = await query
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(26);
  if (error || !data) return null;
  const scans = data.slice(0, 25);
  const last = scans.at(-1);
  return { scans, next: data.length > 25 && last ? `${last.created_at}~${last.id}` : null };
}

export async function saveReport(
  client: Client,
  repositoryId: string,
  report: CompatibilityReport,
) {
  const idempotency = createHash("sha256").update(JSON.stringify(report)).digest("hex");
  return client.rpc("rollbackiq_ingest_scan", {
    p_repository_id: repositoryId,
    p_idempotency_key: idempotency,
    p_report: report,
  });
}

// The session-bound client applies organization RLS to both lookups. Only the
// history metadata is returned here; report bodies load through /api/scans/[id].
export async function workspaceScans(client: Client, selectedId?: string) {
  const columns = "id,repository_id,created_at,status,finding_count,previous_sha,proposed_sha";
  const { data, error } = await client
    .from("scans")
    .select(columns)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(26);
  const unavailable = { scans: [] as SavedScanSummary[], unavailable: true, more: false };
  if (error || !data) return unavailable;
  const rows = data.slice(0, 25);
  if (selectedId && !rows.some(({ id }) => id === selectedId)) {
    const selected = await client.from("scans").select(columns).eq("id", selectedId).maybeSingle();
    if (selected.error) return unavailable;
    if (selected.data) rows.unshift(selected.data);
  }
  if (!rows.length) return { scans: [], unavailable: false, more: false };
  const repositories = await client
    .from("repositories")
    .select("id,name")
    .in("id", [...new Set(rows.map(({ repository_id }) => repository_id))]);
  if (repositories.error || !repositories.data) return unavailable;
  const names = new Map(repositories.data.map(({ id, name }) => [id, name]));
  const scans: SavedScanSummary[] = rows.flatMap((row) => {
    const name = names.get(row.repository_id);
    if (!name) return [];
    const status = compatibilityReportSchema.shape.status.safeParse(row.status);
    return [{ ...row, repository_name: name, status: status.success ? status.data : "unknown" }];
  });
  return { scans, unavailable: false, more: data.length > 25 };
}

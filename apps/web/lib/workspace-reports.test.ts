import assert from "node:assert/strict";
import { test } from "node:test";
import { analyzeCompatibility } from "@rollbackiq/scanner-core/compatibility";
import { type SavedScanSummary, savedWorkspaceRun, workspaceHistory } from "./workspace-reports";

async function fixture() {
  const source = {
    path: "src/reports.ts",
    text: 'db.query("SELECT hostname FROM public.audit_reports");',
  };
  const report = await analyzeCompatibility({
    previous: { release: { ref: "previous", commit: "a".repeat(40) }, sources: [source] },
    proposed: { release: { ref: "proposed", commit: "b".repeat(40) }, sources: [source] },
    migrations: [
      {
        path: "supabase/migrations/drop.sql",
        sql: "ALTER TABLE public.audit_reports DROP COLUMN hostname;",
      },
    ],
  });
  const scan: SavedScanSummary = {
    id: "00000000-0000-4000-8000-000000000001",
    repository_id: "00000000-0000-4000-8000-000000000002",
    repository_name: "org/reports",
    created_at: "2026-11-14T07:00:00Z",
    status: report.status,
    finding_count: report.findings.length,
    previous_sha: report.previous.commit ?? "",
    proposed_sha: report.proposed.commit ?? "",
  };
  return { scan, value: { id: scan.id, repository_id: scan.repository_id, report } };
}

test("saved dashboard reports retain their identity, saved date and compatibility evidence", async () => {
  const { scan, value } = await fixture();
  const run = savedWorkspaceRun(scan, value);
  assert.equal(run.origin, "saved");
  assert.equal(run.id, scan.id);
  assert.equal(run.time, Date.parse(scan.created_at));
  assert.match(run.label, /org\/reports/);
  assert.equal(run.compatibility?.status, "incompatible");
  assert.equal(run.compatibility?.findings[0]?.severity, "critical");
  assert.equal(run.compatibility?.dependencies.previous.queries, 1);
  assert.deepEqual(run.report, value.report.migrationReport);
});

test("a saved dashboard selection rejects a different scan or repository response", async () => {
  const { scan, value } = await fixture();
  assert.throws(
    () => savedWorkspaceRun(scan, { ...value, id: scan.repository_id }),
    /does not match/,
  );
  assert.throws(
    () => savedWorkspaceRun(scan, { ...value, repository_id: scan.id }),
    /does not match/,
  );
  assert.throws(() => savedWorkspaceRun(scan, { ...value, report: { status: "compatible" } }));
});

test("persistent dashboard history includes unloaded reports without duplicating its report cache", async () => {
  const { scan, value } = await fixture();
  const run = savedWorkspaceRun(scan, value);
  const older = {
    ...scan,
    id: "00000000-0000-4000-8000-000000000003",
    created_at: "2026-11-13T07:00:00Z",
  };
  const imported = {
    ...run,
    id: "local-import",
    origin: "import" as const,
    time: Date.parse("2026-11-14T08:00:00Z"),
  };
  const rows = workspaceHistory([run, imported], [scan, older]);
  assert.deepEqual(
    rows.map(({ id }) => id),
    [imported.id, scan.id, older.id],
  );
  assert.equal(rows[0]?.trigger, "Report import");
  assert.equal(rows[1]?.trigger, "Saved report");
  assert.equal(rows[2]?.status, "incompatible");
  assert.equal(rows[2]?.findings, 1);
});

test("saved compatibility reports with no migration summary still open in the dashboard", async () => {
  const { scan, value } = await fixture();
  const run = savedWorkspaceRun(scan, {
    ...value,
    report: { ...value.report, migrationReport: null },
  });
  assert.equal(run.report.summary.files, 0);
  assert.equal(run.compatibility?.findings.length, 1);
});

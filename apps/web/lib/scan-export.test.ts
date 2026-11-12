import assert from "node:assert/strict";
import { test } from "node:test";
import { analyzeCompatibility } from "@rollbackiq/scanner-core/compatibility";
import { scanResponse } from "./scan-export";

async function fixture() {
  const report = await analyzeCompatibility({
    previous: { release: { ref: "previous", commit: "a".repeat(40) }, sources: [] },
    proposed: { release: { ref: "proposed", commit: "b".repeat(40) }, sources: [] },
    migrations: [
      {
        path: "supabase/migrations/qa.sql",
        sql: "CREATE TABLE IF NOT EXISTS public.qa (id bigint PRIMARY KEY);\nALTER TABLE public.qa ENABLE ROW LEVEL SECURITY;",
      },
    ],
  });
  return {
    id: "00000000-0000-4000-8000-000000000001",
    repository_id: "00000000-0000-4000-8000-000000000002",
    created_at: "2026-11-12T00:00:00Z",
    status: report.status,
    report: JSON.parse(JSON.stringify(report)) as typeof report,
  };
}

test("saved JSON export retains evidence, coverage and report identity while the existing API stays compatible", async () => {
  const scan = await fixture();
  assert.deepEqual(await scanResponse(scan, null).json(), scan);
  const response = scanResponse(scan, "json");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("content-type"), "application/json");
  assert.equal(
    response.headers.get("content-disposition"),
    `attachment; filename="rollbackiq-${scan.id}.json"`,
  );
  const { savedScan, ...report } = await response.json();
  assert.deepEqual(report, scan.report);
  assert.equal(savedScan.id, scan.id);
  assert.equal(savedScan.repositoryId, scan.repository_id);
  assert.equal(savedScan.previousCommit, "a".repeat(40));
  assert.equal(savedScan.proposedCommit, "b".repeat(40));
});

test("saved SARIF export retains COMPAT010 severity, source location, confidence and commit metadata", async () => {
  const scan = await fixture();
  const response = scanResponse(scan, "sarif");
  assert.equal(response.headers.get("content-type"), "application/sarif+json");
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.match(response.headers.get("content-disposition") ?? "", /\.sarif"$/);
  const sarif = await response.json();
  assert.equal(sarif.version, "2.1.0");
  const run = sarif.runs[0];
  assert.equal(run.tool.driver.name, "RollbackIQ");
  assert.equal(run.properties.savedScan.id, scan.id);
  assert.equal(run.properties.compatibilityStatus, scan.status);
  const finding = run.results.find((result: { ruleId: string }) => result.ruleId === "COMPAT010");
  assert.ok(finding);
  assert.equal(finding.level, "error");
  assert.equal(finding.properties.confidence, "low");
  assert.equal(
    finding.locations[0].physicalLocation.artifactLocation.uri,
    "supabase/migrations/qa.sql",
  );
  assert.equal(finding.locations[0].physicalLocation.region.startLine, 2);
  assert.ok(run.tool.driver.rules.some((rule: { id: string }) => rule.id === finding.ruleId));
});

test("saved exports reject unsupported formats and malformed reports without returning stored data", async () => {
  const scan = await fixture();
  assert.equal(scanResponse(scan, "html").status, 400);
  const response = scanResponse({ ...scan, report: { secret: "fixture-secret" } }, "sarif");
  assert.equal(response.status, 422);
  assert.doesNotMatch(await response.text(), /fixture-secret/);
});

import assert from "node:assert/strict";
import test from "node:test";
import { canManageGitHub, jobStatus, setupProgress, verdictLabel } from "./team-experience";

const connection = { installation_id: 10, status: "connected" };
const repo = {
  installation_id: 10,
  status: "connected",
  enabled: true,
  configuration: { migrations: "supabase/migrations", sources: ["src"], previous: "v1.0.0" },
};

test("setup requires an organization, an active installation and its own connected repository", () => {
  assert.deepEqual(setupProgress({ organization: false, connections: [], repositories: [] }), {
    organization: false,
    github: false,
    repository: false,
    configuration: false,
    automatic: false,
  });
  assert.equal(
    setupProgress({
      organization: true,
      connections: [connection],
      repositories: [{ ...repo, installation_id: 20 }],
    }).repository,
    false,
  );
  assert.equal(
    setupProgress({
      organization: true,
      connections: [{ ...connection, status: "suspended" }],
      repositories: [repo],
    }).github,
    false,
  );
  assert.equal(
    setupProgress({
      organization: true,
      connections: [connection],
      repositories: [{ ...repo, status: "disconnected" }],
    }).repository,
    false,
  );
});

test("a linked repo can have missing settings or be configured with scanning disabled", () => {
  const progress = (row: typeof repo) =>
    setupProgress({
      organization: true,
      connections: [connection],
      repositories: [row],
    });
  assert.deepEqual(progress({ ...repo, configuration: { ...repo.configuration, previous: "" } }), {
    organization: true,
    github: true,
    repository: true,
    configuration: false,
    automatic: false,
  });
  const disabled = progress({ ...repo, enabled: false });
  assert.equal(disabled.configuration, true);
  assert.equal(disabled.automatic, false);
  assert.equal(progress(repo).automatic, true);
});

test("GitHub setup actions appear for owners and admins only", () => {
  assert.equal(canManageGitHub("owner"), true);
  assert.equal(canManageGitHub("admin"), true);
  assert.equal(canManageGitHub("developer"), false);
  assert.equal(canManageGitHub("viewer"), false);
  assert.equal(canManageGitHub(), false);
});

test("job labels keep pending processing distinct from saved reports", () => {
  assert.equal(jobStatus("queued", null), "Awaiting processing");
  assert.equal(jobStatus("running", null), "Processing");
  assert.equal(jobStatus("completed", null), "Report unavailable");
  assert.equal(jobStatus("completed", "saved"), "Completed");
  assert.equal(jobStatus("failed", null), "Failed");
  assert.equal(jobStatus("cancelled", null), "Cancelled");
  assert.equal(jobStatus("other", null), "Status unavailable");
  assert.equal(verdictLabel("potentially_incompatible"), "Potentially incompatible");
  assert.equal(verdictLabel("toString"), "Verdict unavailable");
});

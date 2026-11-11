import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const cli = (file: "index" | "git", args: string[], env = process.env) =>
  spawnSync(process.execPath, ["--import", "tsx", `packages/cli/src/${file}.ts`, ...args], {
    cwd: root,
    encoding: "utf8",
    env,
    timeout: 20000,
  });

test("file CLI emits SARIF and exits 1 when the threshold is met", () => {
  const result = cli("index", [
    "--format",
    "sarif",
    "--fail-on",
    "high",
    "examples/demo-saas/migrations/002_drop_legacy_tier.sql",
  ]);
  assert.equal(result.status, 1, result.stderr);
  assert.equal(JSON.parse(result.stdout).runs[0].results[0].ruleId, "PG002");
});

test("file CLI returns 2 for invalid usage", () => {
  const result = cli("index", ["--fail-on", "urgent", "file.sql"]);
  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stderr, /--fail-on accepts/);
});

test("Git CLI reads candidate blobs, scopes paths, reports removals and publishes annotations", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rollbackiq-git-"));
  try {
    const git = (...args: string[]) =>
      execFileSync("git", ["-C", directory, ...args], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }).trim();
    const commit = (message: string) =>
      git(
        "-c",
        "user.name=RollbackIQ Test",
        "-c",
        "user.email=rollbackiq@example.invalid",
        "commit",
        "-m",
        message,
      );
    git("init", "-q");
    await mkdir(join(directory, "migrations"));
    await writeFile(
      join(directory, "migrations", "removed.sql"),
      "ALTER TABLE orders ADD COLUMN a text;",
    );
    git("add", ".");
    commit("Baseline");
    const base = git("rev-parse", "HEAD");
    git("rm", "migrations/removed.sql");
    await mkdir(join(directory, "migrations"), { recursive: true });
    const candidate = join(directory, "migrations", "drop,legacy.sql");
    await writeFile(candidate, "ALTER TABLE orders DROP COLUMN legacy;");
    await writeFile(join(directory, "outside.sql"), "DROP TABLE excluded;");
    git("add", ".");
    commit("Candidate");
    await writeFile(candidate, "DROP TABLE uncommitted;");

    const args = [
      "--repo",
      directory,
      "--base",
      base,
      "--path",
      "migrations",
      "--fail-on",
      "high",
      "--fail-incomplete",
    ];
    const result = cli("git", args);
    assert.equal(result.status, 1, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.head, git("rev-parse", "HEAD"));
    assert.equal(output.report.findings[0].ruleId, "PG002");
    assert.equal(output.report.findings.length, 1);
    assert.equal(output.skipped[0].path, "migrations/removed.sql");

    const summary = join(directory, "summary.md");
    const out = join(directory, "reports");
    const action = cli("git", [...args, "--github", "--output-dir", out], {
      ...process.env,
      GITHUB_STEP_SUMMARY: summary,
    });
    assert.equal(action.status, 1, action.stderr);
    assert.match(action.stdout, /::error file=migrations\/drop%2Clegacy.sql/);
    assert.match(await readFile(summary, "utf8"), /Policy: Blocked/);
    assert.equal(
      JSON.parse(await readFile(join(out, "rollbackiq-report.sarif"), "utf8")).runs[0].results
        .length,
      1,
    );

    const all = cli("git", ["--repo", directory, "--base", base]);
    assert.equal(all.status, 0, all.stderr);
    assert.equal(JSON.parse(all.stdout).report.findings.length, 2);
    const noChanges = cli("git", ["--repo", directory, "--base", "HEAD", "--output-dir", out]);
    assert.equal(noChanges.status, 0, noChanges.stderr);
    assert.equal(JSON.parse(noChanges.stdout).report, null);
    assert.deepEqual(
      JSON.parse(await readFile(join(out, "rollbackiq-report.sarif"), "utf8")).runs[0].results,
      [],
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { analyzeCompatibility } from "@rollbackiq/scanner-core/compatibility";
import { readCompatibilityInput } from "./compatibility-git";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const cli = (args: string[], env = process.env) =>
  spawnSync(process.execPath, ["--import", "tsx", "packages/cli/src/compatibility.ts", ...args], {
    cwd: root,
    encoding: "utf8",
    env,
    timeout: 30000,
    windowsHide: true,
  });

test("compatibility Git CLI analyzes two tagged releases without reading the working tree", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rollbackiq-compat-"));
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
      "user.email=test@example.invalid",
      "commit",
      "-m",
      message,
    );
  try {
    git("init", "-q");
    await mkdir(join(directory, "src"));
    await mkdir(join(directory, "db", "migrations"), { recursive: true });
    await writeFile(join(directory, "db", "migrations", ".gitkeep"), "");
    await writeFile(
      join(directory, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@/*": ["src/*"] } } }),
    );
    await writeFile(
      join(directory, "src", "client.ts"),
      'import {createClient} from "@supabase/supabase-js";export async function connect(){return createClient(url,key);}',
    );
    await writeFile(
      join(directory, "src", "user.ts"),
      'import {connect} from "@/client";const client=await connect();export const result=await client.from("users").select("full_name");',
    );
    git("add", ".");
    commit("Previous release");
    git("tag", "v1.0.0");
    await writeFile(
      join(directory, "src", "user.ts"),
      'throw new Error("Proposed repository code must never execute");\nimport {connect} from "@/client";const client=await connect();export const result=await client.from("users").select("id");',
    );
    await writeFile(
      join(directory, "db", "migrations", "002.sql"),
      "ALTER TABLE public.users DROP COLUMN full_name;",
    );
    git("add", ".");
    commit("Proposed release");
    git("tag", "v1.1.0");
    await writeFile(
      join(directory, "src", "user.ts"),
      "throw new Error('uncommitted code must not execute');",
    );
    await writeFile(join(directory, "tsconfig.json"), "uncommitted configuration must not be read");
    const before = git("status", "--porcelain");
    const args = [
      "--repo",
      directory,
      "--previous",
      "v1.0.0",
      "--proposed",
      "v1.1.0",
      "--migrations",
      "./db/migrations",
      "--sources",
      "./src",
      "--fail-on",
      "high",
      "--strict",
    ];
    const result = cli(args);
    assert.equal(result.status, 1, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.kind, "release-compatibility");
    assert.equal(report.status, "incompatible");
    assert.equal(report.previous.commit, git("rev-parse", "v1.0.0"));
    assert.equal(report.dependencies.previous.queries, 1);
    assert.equal(report.coverage.gaps.length, 0);
    assert.equal(report.findings[0].previousEvidence[0].location.path, "src/user.ts");
    assert.equal(report.sourceChanges[0].status, "modified");
    assert.equal(git("status", "--porcelain"), before);

    const missing = cli([...args, "--previous", "missing-release"]);
    assert.equal(missing.status, 2);
    assert.equal(JSON.parse(missing.stderr).code, "COMPAT009");
    const out = join(directory, "reports");
    const summary = join(directory, "summary.md");
    const actions = cli([...args, "--github", "--output-dir", out], {
      ...process.env,
      GITHUB_STEP_SUMMARY: summary,
    });
    assert.equal(actions.status, 1, actions.stderr);
    assert.match(actions.stdout, /::error file=db\/migrations\/002.sql/);
    assert.match(await readFile(summary, "utf8"), /Status: incompatible/);
    assert.ok(
      JSON.parse(await readFile(join(out, "rollbackiq-report.sarif"), "utf8")).runs[0].results.some(
        ({ ruleId }: { ruleId: string }) => ruleId === "COMPAT001",
      ),
    );
    const options = {
      repo: directory,
      previous: "HEAD",
      proposed: "HEAD",
      migrations: "db/migrations",
      sources: ["src"],
    };
    const empty = await analyzeCompatibility(await readCompatibilityInput(options));
    assert.equal(empty.status, "compatible_within_analyzed_scope");
    assert.equal(empty.migrationReport, null);
    await assert.rejects(
      readCompatibilityInput({ ...options, migrations: "../private" }),
      /relative/,
    );
    await assert.rejects(readCompatibilityInput({ ...options, migrations: "typo" }), /no tracked/);
    git("restore", "src/user.ts");
    git("mv", "src/user.ts", "src/renamed.ts");
    git("mv", "db/migrations/002.sql", "db/migrations/003.sql");
    await writeFile(join(directory, "src", "binary.ts"), Buffer.from([0, 255, 0]));
    git("add", ".");
    commit("Rename historical migration and source; add binary input");
    const renamed = await readCompatibilityInput({ ...options, previous: "v1.1.0" });
    assert.ok(
      renamed.sourceChanges?.some(
        ({ status, previousPath }) => status === "renamed" && previousPath === "src/user.ts",
      ),
    );
    assert.ok(renamed.migrationChanges?.some(({ status }) => status === "renamed"));
    assert.ok(
      renamed.gaps?.some(
        ({ location, message }) => location?.path === "src/binary.ts" && message.includes("binary"),
      ),
    );
    const shallow = join(directory, "shallow");
    git("clone", "--depth", "1", pathToFileURL(directory).href, shallow);
    await assert.rejects(
      readCompatibilityInput({ ...options, repo: shallow, previous: "v1.0.0" }),
      /checkout is shallow/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  evaluatePolicy,
  isMigrationPath,
  MAX_FILE_BYTES,
  MAX_FILES,
  MAX_TOTAL_BYTES,
  type MigrationFile,
  type ScanReport,
  scanMigrations,
  toSarif,
} from "@rollbackiq/scanner-core";
import { parsePolicy, policyOptions, serialize } from "./options";
import { gitReader, resolveGitCommit, utf8 } from "./git-read";
import { escapeAnnotation } from "./github-report";

const oid = /^[0-9a-f]{40}$|^[0-9a-f]{64}$/;

function validateDir(path: string) {
  if (path === ".") return;
  if (!isMigrationPath(`${path}/example.sql`))
    throw new Error("--path must be a repository-relative directory.");
}

async function githubOutput(report: ScanReport | null, skipped: number, blocked: boolean) {
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) {
    await appendFile(
      summary,
      [
        "## RollbackIQ migration scan",
        "",
        `- Files analyzed: ${report?.summary.files ?? 0}`,
        `- Files with incomplete coverage: ${(report?.summary.incompleteFiles ?? 0) + skipped}`,
        `- Findings: ${report?.findings.length ?? 0}`,
        `- Policy: ${blocked ? "Blocked" : "Passed"}`,
        "",
        "Review report artifacts for rule evidence and coverage. Static analysis provides limited rollback evidence.",
        "",
      ].join("\n"),
    );
  }
  for (const finding of report?.findings.slice(0, 50) ?? []) {
    const level =
      finding.severity === "critical" || finding.severity === "high"
        ? "error"
        : finding.severity === "info"
          ? "notice"
          : "warning";
    const path = escapeAnnotation(finding.location.path)
      .replaceAll(",", "%2C")
      .replaceAll(":", "%3A");
    const text = escapeAnnotation(`${finding.ruleId} ${finding.title}. ${finding.description}`);
    process.stdout.write(
      `::${level} file=${path},line=${finding.location.line},col=${finding.location.column}::${text}\n`,
    );
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      ...policyOptions,
      base: { type: "string" },
      head: { type: "string", default: "HEAD" },
      repo: { type: "string", default: "." },
      path: { type: "string", multiple: true },
      "output-dir": { type: "string" },
      github: { type: "boolean", default: false },
    },
  });
  if (values.help) {
    process.stdout.write(
      "Usage: pnpm scan:git --base <commit> [--head HEAD] [--repo .] [--path <migration-dir>] [--fail-on high] [--fail-incomplete] [--output-dir <dir>] [--github]\n",
    );
    return;
  }
  if (!values.base) throw new Error("--base is required.");
  const policy = parsePolicy(values["fail-on"], values["fail-incomplete"]);
  const paths = values.path?.map((path) => path.replace(/\/+$/, "")) ?? ["."];
  for (const path of paths) validateDir(path);
  const git = gitReader(values.repo);
  const commit = (ref: string) => resolveGitCommit(git, ref);
  const [base, head] = await Promise.all([commit(values.base), commit(values.head)]);
  const entries = utf8
    .decode(
      await git([
        "diff",
        "--raw",
        "-z",
        "--no-abbrev",
        "--no-renames",
        "--no-ext-diff",
        "--no-textconv",
        base,
        head,
        "--",
        ...paths.map((path) => `:(top,literal)${path === "." ? "" : path}`),
      ]),
    )
    .split("\0");
  const files: MigrationFile[] = [];
  const skipped: { path: string; reason: string }[] = [];
  let total = 0;
  for (let i = 0; i < entries.length - 1; i += 2) {
    const [, mode, , blob] = entries[i]?.split(" ") ?? [];
    const path = entries[i + 1];
    if (!path?.toLowerCase().endsWith(".sql")) continue;
    if (!isMigrationPath(path))
      throw new Error("Git returned a migration path outside the report format.");
    if (mode !== "100644" && mode !== "100755") {
      skipped.push({
        path,
        reason:
          mode === "000000"
            ? "Migration removed from candidate."
            : "Candidate is not a regular Git blob.",
      });
      continue;
    }
    if (!blob || !oid.test(blob)) throw new Error("Git returned an invalid blob ID.");
    const size = Number(utf8.decode(await git(["cat-file", "-s", blob])).trim());
    if (!Number.isSafeInteger(size) || size < 0)
      throw new Error("Git returned an invalid blob size.");
    if (size > MAX_FILE_BYTES || files.length >= MAX_FILES || size + total > MAX_TOTAL_BYTES) {
      skipped.push({ path, reason: "Migration exceeds the scan input limits." });
      continue;
    }
    const sql = utf8.decode(await git(["cat-file", "blob", blob], MAX_FILE_BYTES + 1));
    total += size;
    files.push({ path, sql });
  }
  const report = files.length ? await scanMigrations(files) : null;
  const decision = report
    ? evaluatePolicy(report, policy)
    : { blocked: false, findingIds: [], incompleteFiles: [] };
  const blocked = decision.blocked || (policy.failOnIncomplete && skipped.length > 0);
  const result = serialize({
    schemaVersion: 1,
    base,
    head,
    skipped,
    policy: { ...decision, blocked },
    report,
  });
  if (values["output-dir"]) {
    const directory = resolve(values["output-dir"]);
    await mkdir(directory, { recursive: true });
    await writeFile(resolve(directory, "rollbackiq-report.json"), result);
    await writeFile(resolve(directory, "rollbackiq-report.sarif"), serialize(toSarif(report)));
  }
  if (values.github) await githubOutput(report, skipped.length, blocked);
  else process.stdout.write(result);
  process.exitCode = blocked ? 1 : 0;
}

main().catch(() => {
  process.stderr.write(
    "RollbackIQ: Git scan failed. Verify both refs, migration paths, repository access and input limits.\n",
  );
  process.exitCode = 2;
});

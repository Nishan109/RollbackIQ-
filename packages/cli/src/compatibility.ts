import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  analyzeCompatibility,
  compatibilityPolicy,
  compatibilitySarif,
} from "@rollbackiq/scanner-core/compatibility";
import { CompatibilityGitError, readCompatibilityInput } from "./compatibility-git";
import { compatibilityGithub } from "./github-report";
import { parsePolicy, policyOptions, serialize } from "./options";

async function main() {
  const { values } = parseArgs({
    options: {
      ...policyOptions,
      repo: { type: "string", default: "." },
      previous: { type: "string" },
      proposed: { type: "string", default: "HEAD" },
      migrations: { type: "string" },
      sources: { type: "string", multiple: true },
      prisma: { type: "string" },
      schema: { type: "string" },
      "default-schema": { type: "string", default: "public" },
      postgres: { type: "string", default: "18" },
      format: { type: "string", default: "json" },
      "output-dir": { type: "string" },
      github: { type: "boolean", default: false },
      strict: { type: "boolean", default: false },
    },
  });
  if (values.help) {
    process.stdout.write(
      [
        "Usage: pnpm compatibility --repo . --previous v1.0.0 --proposed HEAD --migrations ./db/migrations",
        "  --sources src       Repeat for each source directory. Default: src.",
        "  --prisma path       Optional tracked Prisma schema. Defaults to prisma/schema.prisma when present.",
        "  --schema path.sql   Optional simple CREATE TABLE baseline from the previous commit.",
        "  --postgres 18       PostgreSQL syntax version supported by this parser.",
        "  --default-schema public",
        "  --format json|text|sarif",
        "  --fail-on critical|high|medium|low|info|none",
        "  --strict            Block incomplete coverage as well as the configured severity gate.",
        "  --fail-incomplete   Equivalent to the incomplete-coverage part of --strict.",
        "  --output-dir path   Save JSON and SARIF artifacts.",
        "  --github            Write a job summary and annotations.",
        "Exit codes: 0 policy passed, 1 policy blocked, 2 analysis/configuration failure.",
        "",
      ].join("\n"),
    );
    return;
  }
  if (!values.previous || !values.migrations)
    throw new Error("--previous and --migrations are required.");
  if (values.postgres !== "18")
    throw new Error(
      "This parser supports --postgres 18. Verify target-server behavior separately.",
    );
  if (!["json", "text", "sarif"].includes(values.format))
    throw new Error("--format accepts json, text or sarif.");
  const policy = parsePolicy(values["fail-on"], values.strict || values["fail-incomplete"]);
  const start = performance.now();
  const input = await readCompatibilityInput({
    repo: values.repo,
    previous: values.previous,
    proposed: values.proposed,
    migrations: values.migrations,
    sources: values.sources ?? ["src"],
    prisma: values.prisma,
    baseline: values.schema,
    defaultSchema: values["default-schema"],
  });
  const report = await analyzeCompatibility(input);
  const decision = compatibilityPolicy(report, policy);
  const result = {
    ...report,
    policy: decision,
    completedAt: new Date().toISOString(),
    durationMs: Math.round(performance.now() - start),
  };
  if (values["output-dir"]) {
    const directory = resolve(values["output-dir"]);
    await mkdir(directory, { recursive: true });
    await writeFile(resolve(directory, "rollbackiq-report.json"), serialize(result));
    await writeFile(
      resolve(directory, "rollbackiq-report.sarif"),
      serialize(compatibilitySarif(report)),
    );
  }
  if (values.github) await compatibilityGithub(report, decision.blocked);
  else if (values.format === "text") {
    process.stdout.write(
      [
        `RollbackIQ previous-release compatibility: ${report.status}`,
        `Previous commit: ${report.previous.commit}`,
        `Proposed commit: ${report.proposed.commit}`,
        `Migrations: ${report.migrationReport?.summary.files ?? 0}. Queries: previous ${report.dependencies.previous.queries}, proposed ${report.dependencies.proposed.queries}.`,
        `Coverage gaps: ${report.coverage.gaps.length}. Policy: ${decision.blocked ? "blocked" : "passed"}.`,
        ...report.findings.map(
          (finding) =>
            `${finding.ruleId} [${finding.severity}/${finding.status}/${finding.confidence}] ${finding.title}${finding.object ? ` (${finding.object})` : ""}`,
        ),
        "",
        "Review the JSON report for source evidence and scope limitations.",
        "",
      ].join("\n"),
    );
  } else
    process.stdout.write(
      serialize(values.format === "sarif" ? compatibilitySarif(report) : result),
    );
  process.exitCode = decision.blocked ? 1 : 0;
}

main().catch((error: unknown) => {
  const code = error instanceof CompatibilityGitError ? error.code : "COMPAT010";
  const message =
    error instanceof CompatibilityGitError
      ? error.message
      : error instanceof Error && !("cmd" in error)
        ? error.message
        : "Git object analysis failed. Fetch complete history and objects for both references, verify paths, and retry.";
  process.stderr.write(serialize({ kind: "analysis-error", status: "unknown", code, message }));
  process.exitCode = 2;
});

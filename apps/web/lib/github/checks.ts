import { isMigrationPath, severities } from "@rollbackiq/scanner-core";
import type { CompatibilityReport } from "@rollbackiq/scanner-core/compatibility/contracts";
import { z } from "zod";
import { type GithubJob, githubId, sha } from "./contracts";
import { GithubError } from "./provider";

export type GithubRequest = (path: string, method?: string, body?: unknown) => Promise<unknown>;
export type CheckConclusion =
  | "success"
  | "failure"
  | "action_required"
  | "neutral"
  | "cancelled"
  | "timed_out";

export const checkMessages: Readonly<Record<string, string>> = {
  permission_missing: "The GitHub App needs Checks write permission.",
  installation_approval_required: "Approve the App's updated permissions on this installation.",
  repository_not_installed: "This repository is unavailable to the GitHub App installation.",
  installation_unavailable: "The GitHub App installation is suspended or unavailable.",
  token_expired:
    "GitHub rejected the refreshed installation token. Verify the App credentials and access.",
  rate_limited: "GitHub rate limited the request.",
  provider_unavailable: "GitHub could not complete the request.",
  access_denied: "GitHub denied the Check request. Verify installation and repository access.",
  check_rejected: "GitHub rejected the Check request.",
  recovery_incomplete: "The existing Check could not be identified safely.",
  lease_exhausted: "The worker lease expired after the final attempt.",
  scan_failed: "The scan could not produce a compatibility report.",
  stale_head: "The pull request is closed or has a newer head.",
  timed_out: "The worker reached its scan deadline.",
};

export class CheckIssue extends Error {
  constructor(
    readonly code: string,
    readonly retry = false,
    readonly retryAfter = 0,
  ) {
    super(checkMessages[code] ?? "GitHub Check publication did not complete.");
  }
}

export function checkIssue(error: unknown) {
  if (error instanceof CheckIssue) return error;
  if (error instanceof GithubError) {
    if (error.rateLimited) return new CheckIssue("rate_limited", true, error.retryAfter);
    if (error.status === 401) return new CheckIssue("token_expired", true);
    if (error.status === 403) return new CheckIssue("access_denied");
    if (error.status === 404) return new CheckIssue("repository_not_installed");
    if (error.status >= 500) return new CheckIssue("provider_unavailable", true);
    return new CheckIssue("check_rejected");
  }
  return new CheckIssue("provider_unavailable", true);
}

export const defaultCheckPolicy = { failOn: "high", incomplete: "action_required" } as const;

export function checkOutput(report: CompatibilityReport, job: GithubJob, reportUrl: string) {
  const policy = job.configuration.checkPolicy ?? defaultCheckPolicy;
  const severitiesFound = [
    ...report.findings.map((finding) => finding.severity),
    ...(report.migrationReport?.findings.map((finding) => finding.severity) ?? []),
  ];
  const highest = severities.find((severity) => severitiesFound.includes(severity));
  const threshold = policy.failOn === "none" ? -1 : severities.indexOf(policy.failOn);
  const conclusion: CheckConclusion =
    report.status === "incompatible" || (highest && severities.indexOf(highest) <= threshold)
      ? "failure"
      : report.status === "unknown" || report.coverage.gaps.length
        ? policy.incomplete
        : report.status === "potentially_incompatible"
          ? "neutral"
          : "success";
  const candidatePaths = new Set(
    report.migrationChanges.filter(({ status }) => status !== "deleted").map(({ path }) => path),
  );
  const parsedPaths = new Set(report.migrationReport?.files.map(({ path }) => path));
  const annotations = report.findings
    .flatMap(({ location, ruleId, severity, message }) =>
      location &&
      candidatePaths.has(location.path) &&
      parsedPaths.has(location.path) &&
      isMigrationPath(location.path) &&
      Number.isSafeInteger(location.line) &&
      location.line > 0
        ? [
            {
              path: location.path,
              start_line: location.line,
              end_line: location.line,
              annotation_level:
                severity === "critical" || severity === "high"
                  ? "failure"
                  : severity === "info"
                    ? "notice"
                    : "warning",
              title: `${ruleId} · ${severity}`,
              message: `${message.slice(0, 800)}\nFull report: ${reportUrl}`,
            },
          ]
        : [],
    )
    .slice(0, 50);
  const rows = report.findings.slice(0, 20).map(({ ruleId, severity, confidence, object }) => {
    const safe = object?.replace(/[\p{Cc}\p{Cf}`<>@|]/gu, " ").slice(0, 160);
    return `- ${ruleId} · ${severity} severity · ${confidence} confidence${safe ? ` · \`${safe}\`` : ""}`;
  });
  const status = report.status.replaceAll("_", " ");
  return {
    status: "completed" as const,
    conclusion,
    details_url: reportUrl,
    output: {
      title: status[0]?.toUpperCase() + status.slice(1),
      summary: [
        "Scan completed.",
        `- Compatibility: **${status}**`,
        `- Highest severity: ${highest ?? "none"}`,
        `- Previous-release queries: ${report.dependencies.previous.queries}`,
        `- Compatibility findings: ${report.findings.length}`,
        `- Coverage gaps: ${report.coverage.gaps.length}`,
        `- Gate: ${policy.failOn}; incomplete analysis: ${policy.incomplete.replaceAll("_", " ")}`,
        "",
        ...rows,
        "",
        `[Open RollbackIQ report](${reportUrl})`,
        "Compatibility is limited to the analyzed inputs and supported operations.",
      ].join("\n"),
      ...(annotations.length ? { annotations } : {}),
    },
  };
}

const remoteCheck = z.object({
  id: githubId,
  app: z.object({ id: githubId }).nullable(),
  head_sha: sha,
  external_id: z.string().nullable(),
  status: z.string(),
  conclusion: z.string().nullish(),
  details_url: z.string().nullish(),
});

export async function recoverCheck(request: GithubRequest, job: GithubJob, appId: number) {
  const base = `/repos/${job.full_name}`;
  const belongs = (run: z.infer<typeof remoteCheck>) =>
    run.app?.id === appId && run.head_sha === job.head_sha && run.external_id === job.id;
  if (job.check_id) {
    const run = remoteCheck.parse(await request(`${base}/check-runs/${job.check_id}`));
    if (!belongs(run) || run.id !== job.check_id) throw new CheckIssue("recovery_incomplete");
    return run;
  }
  for (let page = 1; page <= 10; page++) {
    const result = z
      .object({
        total_count: z.number().int().nonnegative(),
        check_runs: z.array(remoteCheck).max(100),
      })
      .parse(
        await request(
          `${base}/commits/${job.head_sha}/check-runs?app_id=${appId}&check_name=RollbackIQ&filter=all&per_page=100&page=${page}`,
        ),
      );
    const run = result.check_runs.find(belongs);
    if (run) return run;
    if ((page - 1) * 100 + result.check_runs.length >= result.total_count) return null;
    if (result.check_runs.length !== 100) break;
  }
  throw new CheckIssue("recovery_incomplete");
}

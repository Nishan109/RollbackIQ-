import { analyzeCompatibility, compatibilityPolicy } from "@rollbackiq/scanner-core/compatibility";
import { z } from "zod";
import { compatibilityReportSchema } from "../compatibility-report";
import { type GithubJob, githubId, jobSchema, sha } from "./contracts";
import { Github, GithubError } from "./provider";
import { githubSnapshot } from "./snapshot";
import type { GithubRpc } from "./store";

export class StaleJob extends Error {}
export async function currentPull(provider: Github, token: string, job: GithubJob) {
  const current = z
    .object({
      state: z.string(),
      head: z.object({ sha }),
      base: z.object({ repo: z.object({ id: githubId }) }),
    })
    .parse(await provider.request(`/repos/${job.full_name}/pulls/${job.pull_number}`, token));
  if (
    current.state !== "open" ||
    current.head.sha !== job.head_sha ||
    current.base.repo.id !== job.github_id
  )
    throw new StaleJob("Pull request was closed or updated. A newer event is required.");
}
export async function runGithubJob(
  store: GithubRpc,
  providerFactory: (signal: AbortSignal) => Github = (signal) => new Github(fetch, signal),
) {
  const raw = await store("claim", {});
  if (raw === null) return false;
  const job = jobSchema.parse(raw);
  const common = { job: job.id, lease: job.lease_token };
  const provider = providerFactory(AbortSignal.timeout(120_000));
  let token: string | undefined;
  let checkId = job.check_id;
  try {
    await provider.installation(job.installation_id);
    token = await provider.token(job.installation_id, job.github_id);
    const repo = z
      .object({ id: githubId, full_name: z.string() })
      .parse(await provider.request(`/repos/${job.full_name}`, token));
    if (repo.id !== job.github_id || repo.full_name !== job.full_name)
      throw new Error("Repository changed; refresh GitHub access");
    await currentPull(provider, token, job);
    const checks = `/repos/${job.full_name}/check-runs`;
    if (job.configuration.publishChecks) {
      await store("checkpoint", { ...common, check: checkId });
      if (!checkId) {
        // Recover a check when the provider accepted creation but the worker
        // crashed before persisting its ID. Check publication is commit-scoped.
        const existing = z
          .object({
            check_runs: z.array(z.object({ id: githubId, external_id: z.string().nullable() })),
          })
          .parse(
            await provider.request(
              `/repos/${job.full_name}/commits/${job.head_sha}/check-runs?check_name=RollbackIQ&per_page=100`,
              token,
            ),
          );
        checkId = existing.check_runs.find((c) => c.external_id === job.id)?.id ?? null;
      }
      if (!checkId)
        checkId = z.object({ id: githubId }).parse(
          await provider.request(checks, token, "POST", {
            name: "RollbackIQ",
            head_sha: job.head_sha,
            external_id: job.id,
            status: "in_progress",
            details_url: `${provider.settings.origin}/team/repositories/${job.repository_id}`,
            output: {
              title: "Analyzing release compatibility",
              summary:
                "Comparing committed source and migrations with the configured previous release.",
            },
          }),
        ).id;
      await store("checkpoint", { ...common, check: checkId });
    }
    const report = compatibilityReportSchema.parse(
      job.scan_id
        ? await store("report", common)
        : await analyzeCompatibility(
            await githubSnapshot(provider, token, job.full_name, job.head_sha, job.configuration),
          ),
    );
    if (Buffer.byteLength(JSON.stringify(report)) > 1_900_000)
      throw new Error("Report exceeds the hosted storage limit; use the CLI for this repository");
    await currentPull(provider, token, job);
    const saved = z.object({ scan: z.uuid() }).parse(await store("save", { ...common, report }));
    if (checkId) {
      // Revalidate immediately before publication. A Check always targets this
      // exact head SHA and cannot replace a Check on a newer commit.
      await currentPull(provider, token, job);
      await store("checkpoint", { ...common, check: checkId });
      const policy = compatibilityPolicy(report, { failOn: "high", failOnIncomplete: true });
      await provider.request(`${checks}/${checkId}`, token, "PATCH", {
        status: "completed",
        conclusion: policy.blocked ? "action_required" : "success",
        details_url: `${provider.settings.origin}/team/repositories/${job.repository_id}?scan=${saved.scan}`,
        output: {
          title: report.status.replaceAll("_", " "),
          summary: `${report.findings.length} compatibility findings; ${report.coverage.gaps.length} coverage gaps. Policy: block High/Critical findings and incomplete coverage. Review the report before merging.`,
        },
      });
    }
    await store("finish", common);
  } catch (error) {
    const cancelled = error instanceof StaleJob;
    const message = cancelled
      ? "Pull request was closed or updated. This job was cancelled."
      : error instanceof GithubError
        ? error.message
        : "Scan failed. Check repository access, configuration, baseline and worker logs; retry through a new pull-request update.";
    // No provider response bodies, repository source, tokens or raw exceptions
    // enter the database or logs.
    if (token && checkId) {
      try {
        await store("checkpoint", { ...common, check: checkId });
        await provider.request(`/repos/${job.full_name}/check-runs/${checkId}`, token, "PATCH", {
          status: "completed",
          conclusion: cancelled ? "cancelled" : "action_required",
          output: { title: "Analysis incomplete", summary: message },
        });
      } catch {
        /* DB retry state remains authoritative if GitHub is unavailable. */
      }
    }
    try {
      await store("fail", { ...common, cancelled, error: message });
    } catch {
      /* A revoked lease must never be revived. */
    }
    console.error(
      JSON.stringify({ event: "github_job_failed", job: job.id, attempt: job.attempts, cancelled }),
    );
  }
  return true;
}

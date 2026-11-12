import { analyzeCompatibility } from "@rollbackiq/scanner-core/compatibility";
import { z } from "zod";
import { compatibilityReportSchema } from "../compatibility-report";
import {
  type CheckConclusion,
  checkIssue,
  CheckIssue,
  checkOutput,
  type GithubRequest,
  recoverCheck,
} from "./checks";
import { githubAppSettings } from "./config";
import { type GithubJob, githubId, jobSchema, sha } from "./contracts";
import { Github, GithubError } from "./provider";
import { githubSnapshot } from "./snapshot";
import type { GithubRpc } from "./store";

export class StaleJob extends Error {}
class LeaseLost extends Error {}

export async function currentPull(request: GithubRequest, job: GithubJob) {
  const current = z
    .object({
      state: z.string(),
      head: z.object({ sha }),
      base: z.object({ repo: z.object({ id: githubId }) }),
    })
    .parse(await request(`/repos/${job.full_name}/pulls/${job.pull_number}`));
  if (
    current.state !== "open" ||
    current.head.sha !== job.head_sha ||
    current.base.repo.id !== job.github_id
  )
    throw new StaleJob();
}

async function repositorySession(provider: Github, job: GithubJob) {
  let installation: Awaited<ReturnType<Github["installation"]>>;
  try {
    installation = await provider.installation(job.installation_id);
  } catch (error) {
    if (error instanceof GithubError && error.status !== 404) throw error;
    throw new CheckIssue("installation_unavailable");
  }
  let token = await provider.token(job.installation_id, job.github_id);
  let refreshed = false;
  const request: GithubRequest = async (path, method, body) => {
    const usedToken = token;
    try {
      return await provider.request(path, usedToken, method, body);
    } catch (error) {
      if (!(error instanceof GithubError) || error.status !== 401) throw error;
      // Only one refresh per job. Concurrent reads share the same refresh.
      if (!refreshed) {
        refreshed = true;
        tokenRefresh = provider.token(job.installation_id, job.github_id);
      }
      if (usedToken === token && !tokenRefresh) throw error;
      if (tokenRefresh) token = await tokenRefresh;
      if (usedToken === token) throw error;
      return provider.request(path, token, method, body);
    }
  };
  let tokenRefresh: Promise<string> | undefined;
  const repo = z
    .object({ id: githubId, full_name: z.string() })
    .parse(await request(`/repos/${job.full_name}`));
  if (repo.id !== job.github_id || repo.full_name !== job.full_name)
    throw new CheckIssue("repository_not_installed");
  return { request, installation, token: () => token };
}

async function checkPermission(provider: Github, installed: string | undefined) {
  if (installed === "write") return;
  const app = z
    .object({ permissions: z.object({ checks: z.string().optional() }) })
    .parse(await provider.request("/app", provider.jwt()));
  throw new CheckIssue(
    app.permissions.checks === "write" ? "installation_approval_required" : "permission_missing",
  );
}

type WorkerOptions = {
  release?: string | null;
  timeoutMs?: number;
  heartbeatMs?: number;
  onQueueContact?: () => void;
};

export async function runGithubJob(
  store: GithubRpc,
  providerFactory: (signal: AbortSignal) => Github = (signal) =>
    new Github(fetch, signal, githubAppSettings()),
  options: WorkerOptions = {},
) {
  const raw = await store("claim", { release: options.release ?? null });
  options.onQueueContact?.();
  if (raw === null) return false;
  const job = jobSchema.parse(raw);
  const start = Date.now();
  const log = (event: string, fields: Record<string, string | number | boolean | null> = {}) =>
    console.info(
      JSON.stringify({
        event,
        job_id: job.id,
        repository_id: job.github_id,
        pull_number: job.pull_number,
        head_sha: job.head_sha,
        attempt: job.attempts,
        release: options.release ?? null,
        duration_ms: Date.now() - start,
        ...fields,
      }),
    );
  log("github_job_started");

  const lease = { job: job.id, lease: job.lease_token };
  const lostLease = new AbortController();
  const deadline = AbortSignal.timeout(options.timeoutMs ?? 180_000);
  const signal = AbortSignal.any([deadline, lostLease.signal]);
  let renewal: Promise<void> | undefined;
  const heartbeat = setInterval(() => {
    if (signal.aborted || renewal) return;
    renewal = store("renew", lease)
      .then(() => options.onQueueContact?.())
      .catch(() => {
        lostLease.abort(new LeaseLost());
      })
      .finally(() => {
        renewal = undefined;
      });
  }, options.heartbeatMs ?? 30_000);
  heartbeat.unref();
  const checkpoint = async (data: Record<string, unknown>) => {
    signal.throwIfAborted();
    await store("checkpoint", { ...lease, ...data });
    options.onQueueContact?.();
  };

  let checkId: number | null = null;
  let scanId = job.scan_id;
  let published = job.check_state === "published";
  let publishedConclusion: CheckConclusion | undefined;
  let session: Awaited<ReturnType<typeof repositorySession>> | undefined;
  try {
    const provider = providerFactory(signal);
    session = await repositorySession(provider, job);
    const { request, installation } = session;
    await currentPull(request, job);

    const repositoryUrl = `${provider.settings.origin}/team/repositories/${job.repository_id}`;
    const checkPath = `/repos/${job.full_name}/check-runs`;
    let remote: Awaited<ReturnType<typeof recoverCheck>> = null;
    let publicationIssue: CheckIssue | undefined;
    if (job.configuration.publishChecks && !published) {
      try {
        await checkPermission(provider, installation.permissions?.checks);
        remote = await recoverCheck(request, job, provider.settings.appId);
        checkId = remote?.id ?? null;
      } catch (error) {
        signal.throwIfAborted();
        publicationIssue = checkIssue(error);
      }
      if (!publicationIssue && !checkId) {
        await currentPull(request, job);
        // A database failure must abort the attempt before any external write.
        await checkpoint({ check: checkId, state: "pending" });
        try {
          checkId = z.object({ id: githubId }).parse(
            await request(checkPath, "POST", {
              name: "RollbackIQ",
              head_sha: job.head_sha,
              external_id: job.id,
              status: "in_progress",
              details_url: repositoryUrl,
              output: {
                title: "Analyzing release compatibility",
                summary: "Comparing committed sources and migrations with the previous release.",
              },
            }),
          ).id;
        } catch (error) {
          signal.throwIfAborted();
          publicationIssue = checkIssue(error);
        }
      }
      if (checkId) await checkpoint({ check: checkId, state: "in_progress" });
    } else if (!job.configuration.publishChecks) {
      await checkpoint({ state: "disabled" });
    }

    const report = compatibilityReportSchema.parse(
      scanId
        ? await store("report", lease)
        : await analyzeCompatibility(
            await githubSnapshot(
              { signal, request: (path, _token, method, body) => request(path, method, body) },
              "",
              job.full_name,
              job.head_sha,
              job.configuration,
            ),
          ),
    );
    signal.throwIfAborted();
    if (Buffer.byteLength(JSON.stringify(report)) > 1_900_000)
      throw new Error("Report exceeds the hosted storage limit");
    await currentPull(request, job);
    signal.throwIfAborted();
    if (!scanId)
      scanId = z.object({ scan: z.uuid() }).parse(await store("save", { ...lease, report })).scan;

    if (job.configuration.publishChecks && !published) {
      if (!publicationIssue && checkId) {
        const body = checkOutput(report, job, `${repositoryUrl}?scan=${scanId}`);
        // GitHub appends annotations on PATCH. Reconcile an acknowledged
        // completion before retrying after an ambiguous response or DB failure.
        await checkpoint({ check: checkId, state: "in_progress" });
        try {
          await currentPull(request, job);
          if (
            remote?.status !== "completed" ||
            remote.details_url !== body.details_url ||
            remote.conclusion !== body.conclusion
          )
            await request(`${checkPath}/${checkId}`, "PATCH", body);
          published = true;
          publishedConclusion = body.conclusion;
        } catch (error) {
          if (error instanceof StaleJob) throw error;
          signal.throwIfAborted();
          publicationIssue = checkIssue(error);
        }
        if (published)
          await checkpoint({ check: checkId, state: "published", conclusion: body.conclusion });
      }
      if (publicationIssue) {
        log("github_check_unpublished", { scan_id: scanId, reason: publicationIssue.code });
        if (publicationIssue.retry && job.attempts < 3) throw publicationIssue;
        await checkpoint({
          check: checkId,
          state: publicationIssue.retry ? "failed" : "blocked",
          reason: publicationIssue.code,
        });
      }
    }
    signal.throwIfAborted();
    await store("finish", lease);
    options.onQueueContact?.();
    log("github_job_completed", { scan_id: scanId, compatibility: report.status });
  } catch (error) {
    if (lostLease.signal.aborted) {
      log("github_job_lease_lost", { scan_id: scanId });
      throw new LeaseLost();
    }
    const cancelled = error instanceof StaleJob;
    const issue = cancelled
      ? new CheckIssue("stale_head")
      : deadline.aborted
        ? new CheckIssue("timed_out", true)
        : error instanceof GithubError || error instanceof CheckIssue
          ? checkIssue(error)
          : new CheckIssue("scan_failed", true);
    const terminal = cancelled || !issue.retry || job.attempts >= 3;
    let terminalConclusion: "cancelled" | "timed_out" | "failure" | undefined;
    if (
      terminal &&
      !published &&
      (!scanId || cancelled) &&
      job.configuration.publishChecks &&
      (checkId || job.check_id) &&
      session
    ) {
      const conclusion = cancelled ? "cancelled" : deadline.aborted ? "timed_out" : "failure";
      try {
        await store("renew", lease);
        const recovery = providerFactory(AbortSignal.timeout(20_000));
        const token = session.token();
        const target = await recoverCheck(
          (path, method, body) => recovery.request(path, token, method, body),
          { ...job, check_id: checkId ?? job.check_id },
          recovery.settings.appId,
        );
        // Preserve a completed Check if a previous attempt received an
        // ambiguous response after GitHub accepted the final update.
        if (target && target.status !== "completed") {
          await recovery.request(
            `/repos/${job.full_name}/check-runs/${target.id}`,
            token,
            "PATCH",
            {
              status: "completed",
              conclusion,
              output: { title: "Analysis incomplete", summary: issue.message },
            },
          );
          terminalConclusion = conclusion;
        }
      } catch {
        log("github_check_terminal_update_failed", { reason: issue.code });
      }
    }
    await store("fail", {
      ...lease,
      cancelled,
      retry: !terminal,
      retryAfter: issue.retryAfter,
      error: issue.message,
      ...(job.configuration.publishChecks && !published
        ? {
            state: terminalConclusion ? "published" : terminal ? "failed" : "pending",
            reason: issue.code,
            conclusion: terminalConclusion,
          }
        : {}),
      ...(publishedConclusion ? { state: "published", conclusion: publishedConclusion } : {}),
    });
    options.onQueueContact?.();
    log(
      cancelled
        ? "github_job_cancelled"
        : terminal
          ? scanId
            ? "github_job_completed"
            : "github_job_failed"
          : "github_job_retry",
      {
        scan_id: scanId,
        reason: issue.code,
      },
    );
  } finally {
    clearInterval(heartbeat);
  }
  return true;
}

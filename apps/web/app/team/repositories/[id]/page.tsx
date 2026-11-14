import {
  ArrowRight,
  ArrowUpRight,
  Download,
  FileCheck2,
  FolderGit2,
  GitPullRequest,
  Settings2,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CompatibilityPanel } from "@/components/compatibility-panel";
import { NavigationStatus } from "@/components/navigation-status";
import { ProductHeader } from "@/components/product-header";
import { SubmitButton } from "@/components/submit-button";
import { compatibilityReportSchema } from "@/lib/compatibility-report";
import { geminiSettings } from "@/lib/gemini";
import { checkMessages } from "@/lib/github/checks";
import { fullName } from "@/lib/github/contracts";
import { idSchema, repositoryFor, scanCursor, scanPage } from "@/lib/supabase/scans";
import { requireIdentity } from "@/lib/supabase/server";
import { canManageGitHub, jobStatus, verdictLabel } from "@/lib/team-experience";
import { reviewScan } from "../../actions";
import { AiExplanation } from "./ai-explanation";
import { UploadScan } from "./upload-scan";

export const metadata: Metadata = { title: "Repository reports", robots: { index: false } };

export default async function RepositoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ cursor?: string; scan?: string; notice?: string }>;
}) {
  const { client, user } = await requireIdentity();
  const [route, search] = await Promise.all([params, searchParams]);
  const id = idSchema.safeParse(route.id);
  if (!id.success) notFound();
  const repo = await repositoryFor(client, id.data);
  if (!repo) notFound();
  const cursor = scanCursor(search.cursor);
  const selectedId = idSchema.safeParse(search.scan);
  const [history, membership, selected, review, jobs, selectedJob, githubRepository] =
    await Promise.all([
      scanPage(client, repo, cursor),
      client
        .from("organization_members")
        .select("role")
        .eq("organization_id", repo.organization_id)
        .eq("user_id", user.id)
        .maybeSingle(),
      selectedId.success
        ? client
            .from("scans")
            .select("id,report")
            .eq("repository_id", repo.id)
            .eq("id", selectedId.data)
            .maybeSingle()
        : null,
      selectedId.success
        ? client
            .from("scan_reviews")
            .select("decision,reviewed_at")
            .eq("organization_id", repo.organization_id)
            .eq("scan_id", selectedId.data)
            .order("reviewed_at", { ascending: false })
            .limit(1)
            .maybeSingle()
        : null,
      client
        .from("github_jobs")
        .select(
          "id,pull_number,head_sha,status,attempts,scan_id,check_id,check_state,check_error,check_conclusion",
        )
        .eq("repository_id", repo.id)
        .order("created_at", { ascending: false })
        .limit(20),
      selectedId.success
        ? client
            .from("github_jobs")
            .select("id")
            .eq("repository_id", repo.id)
            .eq("scan_id", selectedId.data)
            .limit(1)
            .maybeSingle()
        : null,
      client
        .from("github_repositories")
        .select("full_name")
        .eq("repository_id", repo.id)
        .maybeSingle(),
    ]);
  const canWrite = !!membership.data && membership.data.role !== "viewer";
  const report = selected?.data ? compatibilityReportSchema.safeParse(selected.data.report) : null;
  const githubName = fullName.safeParse(githubRepository.data?.full_name);
  const githubUrl = githubName.success ? `https://github.com/${githubName.data}` : null;
  const latest = !search.scan && !cursor ? history?.scans[0] : null;
  const nameSeparator = repo.name.indexOf("/");
  return (
    <main className="container team-layout product-team repository-page" id="main-content">
      <ProductHeader
        active="repository"
        teamHref={`/team?organization=${repo.organization_id}`}
        guideHref="/help#understanding-scans"
      />
      <div className="repository-hero">
        <div>
          <span className="product-eyebrow">
            <FolderGit2 size={14} aria-hidden="true" /> REPOSITORY INTELLIGENCE
          </span>
          <h1>
            {nameSeparator >= 0 ? (
              <>
                <span className="repository-owner">{repo.name.slice(0, nameSeparator + 1)}</span>
                <wbr />
                {repo.name.slice(nameSeparator + 1)}
              </>
            ) : (
              repo.name
            )}
          </h1>
          <p>Pull request scans, release evidence, and saved reports. All in one place.</p>
        </div>
        <div className="repository-actions">
          {githubUrl && (
            <a href={githubUrl} className="text-link">
              View on GitHub <ArrowUpRight size={14} />
            </a>
          )}
          {canManageGitHub(membership.data?.role) && (
            <Link
              className="button secondary compact"
              href={`/team/github?organization=${repo.organization_id}`}
            >
              <Settings2 size={15} aria-hidden="true" /> Scan settings
              <NavigationStatus />
            </Link>
          )}
        </div>
      </div>
      {latest && (
        <section
          className="dashboard-card repository-latest"
          aria-labelledby="latest-report-heading"
        >
          <span className="metric-icon violet">
            <FileCheck2 size={20} aria-hidden="true" />
          </span>
          <div>
            <span className="product-eyebrow">LATEST SAVED REPORT</span>
            <h2 id="latest-report-heading">{verdictLabel(latest.status)}</h2>
            <p>
              <code>{latest.previous_sha.slice(0, 12)}</code> →{" "}
              <code>{latest.proposed_sha.slice(0, 12)}</code> · {latest.finding_count}{" "}
              {latest.finding_count === 1 ? "finding" : "findings"} ·{" "}
              <time dateTime={latest.created_at}>
                {new Date(latest.created_at).toLocaleDateString()}
              </time>
            </p>
          </div>
          <Link
            className="button primary compact"
            href={`/team/repositories/${repo.id}?scan=${latest.id}`}
          >
            Review latest report <ArrowRight size={15} aria-hidden="true" />
            <NavigationStatus />
          </Link>
        </section>
      )}
      {report?.success && selected?.data && (
        <div id="selected-report">
          <nav className="report-downloads" aria-label="Export saved report">
            <Link className="button primary compact" href={`/workspace?scan=${selected.data.id}`}>
              Open in dashboard
            </Link>
            <a
              className="button secondary compact"
              href={`/api/scans/${selected.data.id}?format=json`}
            >
              <Download size={16} aria-hidden="true" /> Download JSON
            </a>
            <a
              className="button secondary compact"
              href={`/api/scans/${selected.data.id}?format=sarif`}
            >
              <Download size={16} aria-hidden="true" /> Download SARIF
            </a>
            <Link className="text-link" href="/help#exports">
              Export help
            </Link>
            <a className="text-link" href="#scan-history">
              Scan history
            </a>
          </nav>
          <CompatibilityPanel
            key={selected.data.id}
            report={{
              previous: report.data.previous,
              proposed: report.data.proposed,
              status: report.data.status,
              coverage: report.data.coverage,
              findings: report.data.findings,
              dependencies: { previous: { queries: report.data.dependencies.previous.queries } },
            }}
            imported={!selectedJob?.data}
            github={!!selectedJob?.data}
          />
        </div>
      )}
      <section className="dashboard-card team-card" id="scan-jobs">
        <h2>
          <GitPullRequest size={18} aria-hidden="true" /> GitHub scan jobs
        </h2>
        {jobs.error ? (
          <p className="form-error" role="alert">
            GitHub job status is temporarily unavailable. Reload this page to retry.
          </p>
        ) : !jobs.data?.length ? (
          <p>
            No pull request jobs yet. Eligible pull request events queue a scan for processing.{" "}
            <Link className="text-link" href="/help#troubleshooting">
              See why a scan might be missing
            </Link>
            .
          </p>
        ) : (
          <>
            <p>Refresh to see the latest recorded status. Queued jobs can take time to process.</p>
            <ul className="workspace-list job-list">
              {jobs.data.map((job) => (
                <li key={job.id}>
                  <div className="job-heading">
                    <GitPullRequest size={16} aria-hidden="true" />
                    {githubUrl ? (
                      <a className="text-link" href={`${githubUrl}/pull/${job.pull_number}`}>
                        PR #{job.pull_number}
                      </a>
                    ) : (
                      <>PR #{job.pull_number}</>
                    )}
                    {" · "}
                    <code title={job.head_sha}>{job.head_sha.slice(0, 12)}</code>
                    {" · "}
                    <strong className="neutral-pill">{jobStatus(job.status, job.scan_id)}</strong>
                    {" · Attempt "}
                    {job.attempts}
                  </div>
                  {job.status === "failed" && (
                    <p className="form-error">
                      This scan failed. Check the repository’s saved paths and release reference.{" "}
                      <Link className="text-link" href="/help#troubleshooting">
                        Troubleshooting
                      </Link>
                    </p>
                  )}
                  <p>
                    GitHub Check{" · "}
                    {(
                      job.check_state ?? (job.check_id ? "legacy record" : "not recorded")
                    ).replaceAll("_", " ")}
                    {job.check_conclusion && ` · ${job.check_conclusion.replaceAll("_", " ")}`}
                    {githubUrl && job.check_id && (
                      <>
                        {" · "}
                        <a className="text-link" href={`${githubUrl}/runs/${job.check_id}`}>
                          Open Check
                        </a>
                      </>
                    )}
                  </p>
                  {job.check_error && (
                    <p className="form-error">
                      {checkMessages[job.check_error] ?? "Check publication needs review."}
                    </p>
                  )}
                  {job.scan_id && (
                    <Link
                      className="text-link"
                      href={`/team/repositories/${repo.id}?scan=${job.scan_id}`}
                    >
                      Open saved report <NavigationStatus />
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
      {canWrite && (
        <section className="dashboard-card team-card">
          <h2>Import a Git scan</h2>
          <p>Choose a CLI report to store it and its source references in this organization.</p>
          <UploadScan repositoryId={repo.id} />
        </section>
      )}
      <section className="dashboard-card table-card" id="scan-history">
        <div className="card-title">
          <div>
            <h2>Persistent scan history</h2>
            <p>Reports saved for this repository</p>
          </div>
        </div>
        <section className="table-scroll" aria-label="Saved scan history">
          {/* biome-ignore lint/a11y/noNoninteractiveTabindex: The focusable table supports keyboard scrolling on narrow screens. */}
          <table className="scan-history" tabIndex={0}>
            <thead>
              <tr>
                <th scope="col">Saved</th>
                <th scope="col">Previous</th>
                <th scope="col">Proposed</th>
                <th scope="col">Findings</th>
                <th scope="col">Compatibility verdict</th>
              </tr>
            </thead>
            <tbody>
              {history?.scans.map((scan) => (
                <tr key={scan.id}>
                  <td>
                    <Link
                      className="text-link"
                      href={`/team/repositories/${repo.id}?scan=${scan.id}`}
                      prefetch={false}
                      aria-current={
                        selectedId.success && selectedId.data === scan.id ? "page" : undefined
                      }
                    >
                      {new Date(scan.created_at).toLocaleString()}
                      <NavigationStatus />
                    </Link>
                  </td>
                  <td>
                    <code>{scan.previous_sha.slice(0, 12)}</code>
                  </td>
                  <td>
                    <code>{scan.proposed_sha.slice(0, 12)}</code>
                  </td>
                  <td>{scan.finding_count}</td>
                  <td>{verdictLabel(scan.status)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        {!history?.scans.length && (
          <p className="compatibility-note">
            {history
              ? "No saved scans on this page. A report appears when processing finishes or someone imports a CLI scan."
              : "Scan history is temporarily unavailable. Reload this page to retry."}
          </p>
        )}
        {history?.next && (
          <p className="compatibility-note">
            <Link
              className="text-link"
              href={`/team/repositories/${repo.id}?cursor=${encodeURIComponent(history.next)}`}
            >
              Older scans
            </Link>
          </p>
        )}
      </section>
      {search.scan && !report?.success && (
        <p className="form-error" role="alert">
          {selected?.error
            ? "The selected report couldn’t be loaded. Reload this page to retry."
            : "This report is unavailable. Select another saved report from the history above."}
        </p>
      )}
      {report?.success && selected?.data && (
        <>
          <section className="dashboard-card team-card">
            <h2>Scan review</h2>
            <p>{review?.data ? review.data.decision.replaceAll("_", " ") : "Awaiting review"}</p>
            {search.notice && (
              <p className="auth-notice" role="status">
                {search.notice === "reviewed" ? "Review saved." : "Review could not be saved."}
              </p>
            )}
            {canWrite && (
              <form className="scan-form inline-form" action={reviewScan}>
                <input type="hidden" name="repositoryId" value={repo.id} />
                <input type="hidden" name="scanId" value={selected.data.id} />
                <label>
                  Review decision
                  <select name="decision">
                    <option value="reviewed">Reviewed</option>
                    <option value="needs_review">Needs review</option>
                  </select>
                </label>
                <SubmitButton className="button secondary compact">Save review</SubmitButton>
              </form>
            )}
          </section>
          <AiExplanation
            key={selected.data.id}
            scanId={selected.data.id}
            enabled={!!geminiSettings()}
            findings={report.data.findings
              .slice(0, 100)
              .map(({ id, ruleId, title }) => ({ id, ruleId, title }))}
          />
        </>
      )}
    </main>
  );
}

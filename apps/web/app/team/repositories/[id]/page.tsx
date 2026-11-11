import Link from "next/link";
import { notFound } from "next/navigation";
import { Brand } from "@/components/brand";
import { CompatibilityPanel } from "@/components/compatibility-panel";
import { compatibilityReportSchema } from "@/lib/compatibility-report";
import { geminiSettings } from "@/lib/gemini";
import { idSchema, repositoryFor, scanCursor, scanPage } from "@/lib/supabase/scans";
import { requireIdentity } from "@/lib/supabase/server";
import { reviewScan } from "../../actions";
import { AiExplanation } from "./ai-explanation";
import { UploadScan } from "./upload-scan";

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
  const [history, membership, selected, review, jobs, selectedJob] = await Promise.all([
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
      .select("id,pull_number,head_sha,status,attempts,error,scan_id,created_at")
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
  ]);
  const canWrite = !!membership.data && membership.data.role !== "viewer";
  const report = selected?.data ? compatibilityReportSchema.safeParse(selected.data.report) : null;
  return (
    <main className="container team-layout">
      <header className="team-header">
        <Brand />
        <Link className="text-link" href="/team">
          Team workspace
        </Link>
      </header>
      <h1>{repo.name}</h1>
      <Link className="text-link" href={`/team/github?organization=${repo.organization_id}`}>
        GitHub connection and scan settings
      </Link>
      {!jobs.error && !!jobs.data?.length && (
        <section className="dashboard-card team-card">
          <h2>GitHub scan jobs</h2>
          <p>Refresh this page to see worker progress.</p>
          <ul>
            {jobs.data.map((job) => (
              <li key={job.id}>
                PR #{job.pull_number} · <code>{job.head_sha.slice(0, 12)}</code> · {job.status} ·
                Attempt {job.attempts}
                {job.error && <p className="form-error">{job.error}</p>}
                {job.scan_id && (
                  <Link
                    className="text-link"
                    href={`/team/repositories/${repo.id}?scan=${job.scan_id}`}
                  >
                    Open report
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      {canWrite && (
        <section className="dashboard-card team-card">
          <h2>Import a Git scan</h2>
          <p>Choose a CLI report to store it and its source references in this organization.</p>
          <UploadScan repositoryId={repo.id} />
        </section>
      )}
      <section className="dashboard-card table-card">
        <div className="card-title">
          <div>
            <h2>Persistent scan history</h2>
            <p>Reports saved for this repository</p>
          </div>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Saved</th>
                <th>Previous</th>
                <th>Proposed</th>
                <th>Findings</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {history?.scans.map((scan) => (
                <tr key={scan.id}>
                  <td>
                    <Link
                      className="text-link"
                      href={`/team/repositories/${repo.id}?scan=${scan.id}`}
                    >
                      {new Date(scan.created_at).toLocaleString()}
                    </Link>
                  </td>
                  <td>
                    <code>{scan.previous_sha.slice(0, 12)}</code>
                  </td>
                  <td>
                    <code>{scan.proposed_sha.slice(0, 12)}</code>
                  </td>
                  <td>{scan.finding_count}</td>
                  <td>{scan.status.replaceAll("_", " ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!history?.scans.length && (
          <p className="compatibility-note">
            {history ? "No saved scans on this page." : "Scan history is temporarily unavailable."}
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
          The selected report is unavailable.
        </p>
      )}
      {report?.success && selected?.data && (
        <>
          <CompatibilityPanel
            report={report.data}
            imported={!selectedJob?.data}
            github={!!selectedJob?.data}
          />
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
                <button className="button secondary compact" type="submit">
                  Save review
                </button>
              </form>
            )}
          </section>
          <AiExplanation
            key={selected.data.id}
            scanId={selected.data.id}
            enabled={!!geminiSettings()}
          />
        </>
      )}
    </main>
  );
}

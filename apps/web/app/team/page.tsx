import { ArrowRight, Check, Circle, Github, GitPullRequest, Layers3 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { signOut } from "@/app/auth/actions";
import { Brand } from "@/components/brand";
import { NavigationStatus } from "@/components/navigation-status";
import { SubmitButton } from "@/components/submit-button";
import { supabaseSettings } from "@/lib/supabase/config";
import { requireIdentity } from "@/lib/supabase/server";
import { canManageGitHub, jobStatus, setupProgress, verdictLabel } from "@/lib/team-experience";
import { addRepository, createOrganization, setMember } from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Team workspace",
  robots: { index: false, follow: false },
};

const notices: Record<string, string> = {
  invalid: "Check the form values and try again.",
  failed: "The change could not be saved. Check your role and the submitted values.",
  organization: "Organization created. You can now connect GitHub.",
  membership: "Membership saved.",
  github_failed:
    "GitHub authorization could not be verified. Reopen GitHub connections and try again.",
};

const date = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" });

function OrganizationForm() {
  return (
    <form className="scan-form inline-form" action={createOrganization}>
      <label>
        Organization name
        <input name="name" required maxLength={100} placeholder="Your team name" />
      </label>
      <SubmitButton className="button primary compact" pendingLabel="Creating organization…">
        Create organization
      </SubmitButton>
    </form>
  );
}

export default async function TeamPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; organization?: string }>;
}) {
  if (!supabaseSettings())
    return (
      <main className="container team-layout">
        <Brand />
        <section className="dashboard-card team-card">
          <h1>Team workspace unavailable</h1>
          <p>
            Team sign-in requires a configured RollbackIQ instance. You can still scan SQL locally.
          </p>
          <Link className="button secondary" href="/workspace">
            Open local workspace
          </Link>
        </section>
      </main>
    );
  const { client, user } = await requireIdentity();
  const { notice, organization } = await searchParams;
  const { data: organizations, error: organizationError } = await client
    .from("organizations")
    .select("id,name")
    .order("name")
    .limit(100);
  const org =
    organizations?.find(({ id }) => id === organization) ??
    (organization ? null : organizations?.[0]);
  const [membership, repositories, connections, githubRepos, scans, jobs, members] = org
    ? await Promise.all([
        client
          .from("organization_members")
          .select("role")
          .eq("organization_id", org.id)
          .eq("user_id", user.id)
          .maybeSingle(),
        client
          .from("repositories")
          .select("id,name")
          .eq("organization_id", org.id)
          .order("name")
          .limit(200),
        client
          .from("github_connections")
          .select("installation_id,status")
          .eq("organization_id", org.id)
          .limit(200),
        client
          .from("github_repositories")
          .select("repository_id,installation_id,status,enabled,configuration")
          .eq("organization_id", org.id)
          .limit(200),
        client
          .from("scans")
          .select("id,repository_id,created_at,status,finding_count")
          .eq("organization_id", org.id)
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .limit(6),
        client
          .from("github_jobs")
          .select("id,repository_id,pull_number,head_sha,status,scan_id")
          .eq("organization_id", org.id)
          .order("created_at", { ascending: false })
          .limit(6),
        client
          .from("organization_members")
          .select("user_id,role")
          .eq("organization_id", org.id)
          .limit(100),
      ])
    : [];
  const role = membership?.data?.role;
  const canManage = canManageGitHub(role);
  const setupUnavailable = !!(connections?.error || githubRepos?.error);
  const progress = setupProgress({
    organization: !!org,
    connections: connections?.data ?? [],
    repositories: githubRepos?.data ?? [],
  });
  const steps = [
    { title: "Account ready", done: true },
    { title: "Organization ready", done: !!org },
    { title: "GitHub connected", done: progress.github },
    { title: "Repository connected", done: progress.repository },
    { title: "Scan settings saved", done: progress.configuration },
  ];
  const githubHref = `/team/github?organization=${org?.id}`;
  const repoNames = new Map(repositories?.data?.map(({ id, name }) => [id, name]));
  const activeInstallations = new Set(
    connections?.data
      ?.filter(({ status }) => status === "connected")
      .map(({ installation_id }) => installation_id),
  );
  const linkedRepos = new Set(
    githubRepos?.data
      ?.filter(
        (repo) => repo.status === "connected" && activeInstallations.has(repo.installation_id),
      )
      .map(({ repository_id }) => repository_id),
  );
  const nextStep = !org
    ? "Create an organization to keep your repositories and reports together."
    : !progress.github
      ? "Install the GitHub App and grant access to the repositories you want to scan."
      : !progress.repository
        ? "Select a repository that you administer in GitHub."
        : !progress.configuration
          ? "Save a previous release reference and the paths to your migrations and application code."
          : progress.automatic
            ? "Eligible pull request events queue scans. Open a repository to follow job status or view saved reports."
            : "Enable automatic pull request scans in repository settings when you’re ready.";

  return (
    <main className="container team-layout product-team" id="main-content">
      <header className="team-header">
        <Brand />
        <nav className="product-nav" aria-label="Workspace navigation">
          <Link className="text-link" href="/help">
            Help
          </Link>
          <Link className="text-link" href="/workspace">
            Local scanner
          </Link>
          <form action={signOut}>
            <SubmitButton className="button secondary compact" pendingLabel="Signing out…">
              Sign out
            </SubmitButton>
          </form>
        </nav>
      </header>
      <div className="workspace-intro">
        <div>
          <h1>Team workspace</h1>
          <p>Connect repositories and review PostgreSQL migration risks with your team.</p>
        </div>
        <p className="workspace-account">
          Signed in as <strong>{user.email ?? user.id}</strong>
        </p>
      </div>
      {notice && Object.hasOwn(notices, notice) && (
        <p
          className={
            ["invalid", "failed", "github_failed"].includes(notice) ? "form-error" : "auth-notice"
          }
          role={["invalid", "failed", "github_failed"].includes(notice) ? "alert" : "status"}
        >
          {notices[notice]}
        </p>
      )}
      {organizationError ? (
        <section className="dashboard-card team-card">
          <h2>Organizations unavailable</h2>
          <p role="alert">
            We couldn’t load your organizations. Reopen the workspace to try again.
          </p>
          <Link className="text-link" href="/team">
            Reopen workspace
          </Link>
        </section>
      ) : (
        <>
          {!!organizations?.length && (
            <nav className="workspace-switcher" aria-label="Select organization">
              {organizations.map(({ id, name }) => (
                <Link
                  key={id}
                  href={`/team?organization=${id}`}
                  prefetch={false}
                  aria-current={org?.id === id ? "page" : undefined}
                  className="organization-link"
                >
                  <Layers3 size={15} aria-hidden="true" /> {name}
                  <NavigationStatus />
                </Link>
              ))}
            </nav>
          )}
          {organization && !org && (
            <p className="form-error" role="alert">
              That organization is unavailable. Select an organization you can access.
            </p>
          )}
          {(!organization || org || !organizations?.length) && (
            <section
              className="dashboard-card team-card setup-card"
              aria-labelledby="setup-heading"
            >
              <div className="team-heading">
                <h2 id="setup-heading">Workspace setup{org ? ` · ${org.name}` : ""}</h2>
                <Link className="text-link" href="/help#getting-started">
                  Setup guide <ArrowRight size={15} aria-hidden="true" />
                </Link>
              </div>
              <ol className="setup-steps">
                {steps.map(({ title, done }, index) => {
                  const state =
                    index >= 2 && setupUnavailable ? "Unavailable" : done ? "Complete" : "Pending";
                  const Icon = done ? Check : Circle;
                  return (
                    <li key={title} data-complete={state === "Complete"}>
                      <Icon size={17} aria-hidden="true" />
                      <span>
                        {title}
                        <small>{state}</small>
                      </span>
                    </li>
                  );
                })}
              </ol>
              <p>
                {setupUnavailable
                  ? "GitHub setup status is temporarily unavailable."
                  : org && !canManage && !progress.automatic
                    ? "Ask an organization owner or admin to finish GitHub setup."
                    : nextStep}
              </p>
              {canManage && (
                <Link className="button primary compact" href={githubHref}>
                  <Github size={17} aria-hidden="true" />{" "}
                  {progress.github ? "GitHub settings" : "Connect GitHub"}
                </Link>
              )}
              {!organizations?.length && <OrganizationForm />}
            </section>
          )}
        </>
      )}

      {org && (
        <>
          <section className="dashboard-card team-card workspace-repositories">
            <div className="team-heading">
              <h2>Repositories</h2>
              {role && <span className="neutral-pill">{role}</span>}
            </div>
            {repositories?.error ? (
              <p role="alert">Repositories are temporarily unavailable.</p>
            ) : repositories?.data?.length ? (
              <ul className="workspace-list">
                {repositories.data.map(({ id, name }) => (
                  <li key={id}>
                    <Link className="text-link" href={`/team/repositories/${id}`} prefetch={false}>
                      {name}
                    </Link>
                    <span className="neutral-pill">
                      {setupUnavailable
                        ? "Connection unavailable"
                        : linkedRepos.has(id)
                          ? "GitHub connected"
                          : "GitHub not connected"}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p>
                {canManage
                  ? "No repositories yet. Connect GitHub or add a repository for CLI report imports in organization settings."
                  : "No repositories yet. Ask an owner or admin to connect one."}
              </p>
            )}
          </section>

          <div className="workspace-activity">
            <section className="dashboard-card team-card">
              <h2>Recent reports</h2>
              {scans?.error ? (
                <p role="alert">Saved reports are temporarily unavailable.</p>
              ) : scans?.data?.length ? (
                <ul className="workspace-list">
                  {scans.data.map((scan) => (
                    <li key={scan.id}>
                      <div>
                        <Link
                          className="text-link"
                          href={`/team/repositories/${scan.repository_id}?scan=${scan.id}`}
                          prefetch={false}
                        >
                          {repoNames.get(scan.repository_id) ?? "Saved repository"} ·{" "}
                          <time dateTime={scan.created_at}>
                            {date.format(new Date(scan.created_at))}
                          </time>
                        </Link>
                        <p>
                          {verdictLabel(scan.status)} · {scan.finding_count}{" "}
                          {scan.finding_count === 1 ? "finding" : "findings"}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>Saved reports appear after a scan finishes or a CLI report is imported.</p>
              )}
            </section>
            <section className="dashboard-card team-card">
              <h2>Recent pull request jobs</h2>
              {jobs?.error ? (
                <p role="alert">Job status is temporarily unavailable.</p>
              ) : jobs?.data?.length ? (
                <ul className="workspace-list">
                  {jobs.data.map((job) => (
                    <li key={job.id}>
                      <div>
                        <Link
                          className="text-link"
                          href={`/team/repositories/${job.repository_id}${job.scan_id ? `?scan=${job.scan_id}` : "#scan-jobs"}`}
                          prefetch={false}
                        >
                          <GitPullRequest size={15} aria-hidden="true" />{" "}
                          {repoNames.get(job.repository_id) ?? "Repository"} · PR #{job.pull_number}
                        </Link>
                        <p>
                          {jobStatus(job.status, job.scan_id)} ·{" "}
                          <code title={job.head_sha}>{job.head_sha.slice(0, 12)}</code>
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>
                  {progress.automatic
                    ? "No jobs have been recorded. Eligible pull request events queue a scan for processing."
                    : "No jobs have been recorded. Configure a connected repository to enable automatic scans."}
                </p>
              )}
            </section>
          </div>
          <details className="dashboard-card team-card workspace-settings">
            <summary>Organization settings</summary>
            <p>
              Account ID <code>{user.id}</code>
            </p>
            {canManage && (
              <form className="scan-form inline-form" action={addRepository}>
                <input type="hidden" name="organizationId" value={org.id} />
                <label>
                  Repository for CLI imports
                  <input name="name" placeholder="owner/repository" required maxLength={140} />
                </label>
                <SubmitButton className="button secondary compact">Add repository</SubmitButton>
              </form>
            )}
            <h3>
              Members
              {members?.data
                ? ` (${members.data.length}${members.data.length === 100 ? "+" : ""})`
                : ""}
            </h3>
            {members?.error ? (
              <p role="alert">Memberships are temporarily unavailable.</p>
            ) : (
              <ul>
                {members?.data?.map((member) => (
                  <li key={member.user_id}>
                    <code>{member.user_id}</code> · {member.role}
                    {member.user_id === user.id ? " (you)" : ""}
                  </li>
                ))}
              </ul>
            )}
            {role === "owner" && (
              <form className="scan-form inline-form" action={setMember}>
                <input type="hidden" name="organizationId" value={org.id} />
                <label>
                  Existing account ID
                  <input name="userId" required maxLength={36} />
                </label>
                <label>
                  Role
                  <select name="role">
                    <option value="viewer">Viewer</option>
                    <option value="developer">Developer</option>
                    <option value="admin">Admin</option>
                  </select>
                </label>
                <SubmitButton className="button secondary compact">Save membership</SubmitButton>
              </form>
            )}
          </details>
          <details className="dashboard-card team-card workspace-settings">
            <summary>Create another organization</summary>
            <OrganizationForm />
          </details>
        </>
      )}
    </main>
  );
}

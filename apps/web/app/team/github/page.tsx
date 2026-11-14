import type { Metadata } from "next";
import Link from "next/link";
import { z } from "zod";
import { Brand } from "@/components/brand";
import { PostForm } from "@/components/post-form";
import { githubReady } from "@/lib/github/config";
import { choices } from "@/lib/github/contracts";
import { githubStore } from "@/lib/github/store";
import { supabaseSettings } from "@/lib/supabase/config";
import { requireIdentity } from "@/lib/supabase/server";
import { canManageGitHub, setupProgress } from "@/lib/team-experience";
import { ConnectButton } from "./connect-button";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "GitHub connections", robots: { index: false } };
const dashboardSchema = z.object({
  choices: z.object({ id: z.uuid(), payload: choices }).nullable(),
  connections: z.array(
    z.object({
      installation_id: z.number(),
      account_login: z.string(),
      status: z.string(),
      synchronized_at: z.string(),
    }),
  ),
  repositories: z.array(
    z.object({
      repository_id: z.uuid(),
      github_id: z.number(),
      installation_id: z.number(),
      full_name: z.string(),
      status: z.string(),
      enabled: z.boolean(),
      configuration: z.record(z.string(), z.unknown()),
    }),
  ),
});
const messages: Record<string, string> = {
  pending:
    "Your GitHub organization must approve the installation. After approval, click Connect GitHub again.",
  cancelled: "GitHub authorization was cancelled. You can try again.",
  authorized: "Authorization verified. Select repositories below within five minutes.",
  saved: "Your changes were saved.",
  disconnected:
    "Disconnected in RollbackIQ. Your GitHub App installation and saved reports remain available.",
  failed:
    "The change could not be completed. Check your organization role, repository access and configuration, then reconnect if necessary.",
};
export default async function GithubPage({
  searchParams,
}: {
  searchParams: Promise<{ organization?: string; notice?: string }>;
}) {
  const query = await searchParams;
  if (!supabaseSettings() || !githubReady())
    return (
      <main className="container team-layout product-team">
        <Brand />
        <h1>Connect GitHub</h1>
        <section className="dashboard-card team-card">
          <h2>Finish connection setup</h2>
          <p>
            {!supabaseSettings()
              ? "Team sign-in is unavailable on this instance."
              : "GitHub connections are unavailable on this instance."}
          </p>
          <p>
            Ask your RollbackIQ administrator to check the GitHub App and team sign-in settings.
          </p>
          <p>Your local scanner remains available while you complete setup.</p>
          <Link className="button secondary" href="/workspace">
            Open local workspace
          </Link>
        </section>
        <Link className="text-link" href="/team">
          Team workspace
        </Link>
      </main>
    );
  const { client, user } = await requireIdentity();
  const organization = z.uuid().safeParse(query.organization);
  if (!organization.success) {
    const [organizations, memberships] = await Promise.all([
      client.from("organizations").select("id,name").order("name").limit(100),
      client
        .from("organization_members")
        .select("organization_id,role")
        .eq("user_id", user.id)
        .limit(100),
    ]);
    const allowed = new Set(
      memberships.data
        ?.filter(({ role }) => canManageGitHub(role))
        .map(({ organization_id }) => organization_id),
    );
    const data = organizations.data?.filter(({ id }) => allowed.has(id));
    return (
      <main className="container team-layout product-team">
        <Brand />
        <h1>Select an organization</h1>
        <p>Owners and admins can connect GitHub repositories.</p>
        {organizations.error || memberships.error ? (
          <p role="alert">Organizations are temporarily unavailable. Reopen this page to retry.</p>
        ) : (
          !data?.length && (
            <p>
              Create an organization in Team workspace or ask an owner or admin to manage the
              connection.
            </p>
          )
        )}
        <ul className="workspace-list">
          {data?.map((org) => (
            <li key={org.id}>
              <Link className="text-link" href={`/team/github?organization=${org.id}`}>
                {org.name}
              </Link>
            </li>
          ))}
        </ul>
        <Link className="text-link" href="/team">
          Create or manage organizations
        </Link>
      </main>
    );
  }
  let dashboard: z.infer<typeof dashboardSchema>;
  try {
    dashboard = dashboardSchema.parse(
      await githubStore()("dashboard", { actor: user.id, organization: organization.data }),
    );
  } catch {
    return (
      <main className="container team-layout product-team">
        <Brand />
        <h1>GitHub connection unavailable</h1>
        <p>
          Select an organization where you’re an owner or admin. If the connection is still
          unavailable, try again shortly.
        </p>
        <Link className="text-link" href="/team">
          Team workspace
        </Link>
      </main>
    );
  }
  const org = organization.data;
  const progress = setupProgress({
    organization: true,
    connections: dashboard.connections,
    repositories: dashboard.repositories,
  });
  return (
    <main className="container team-layout product-team">
      <header className="team-header">
        <Brand />
        <nav className="product-nav" aria-label="Workspace navigation">
          <Link className="text-link" href={`/team?organization=${org}`}>
            Team workspace
          </Link>
          <Link className="text-link" href="/help#getting-started">
            Setup guide
          </Link>
        </nav>
      </header>
      <h1>GitHub connections</h1>
      <p>
        Install the app, choose repositories you administer, then save the paths and release
        reference for each scan.
      </p>
      {query.notice && Object.hasOwn(messages, query.notice) && (
        <p
          className={query.notice === "failed" ? "form-error" : "auth-notice"}
          role={query.notice === "failed" ? "alert" : "status"}
        >
          {messages[query.notice]}
        </p>
      )}
      <section className="dashboard-card team-card">
        <h2>{progress.github ? "GitHub installations" : "Connect a GitHub installation"}</h2>
        <p>
          GitHub will ask which repositories RollbackIQ can access. You must also have
          administrative access to the repositories you connect here.
        </p>
        <ConnectButton organization={org} />
        <details>
          <summary>Already installed on GitHub?</summary>
          <PostForm
            action="/api/github/connect"
            className="scan-form"
            label="Continue with existing installation"
            pendingLabel="Opening GitHub…"
          >
            <input type="hidden" name="organization" value={org} />
            <label>
              Installation ID
              <input
                name="installation"
                inputMode="numeric"
                pattern="[1-9][0-9]*"
                maxLength={16}
                required
                aria-describedby="github-installation-help"
              />
            </label>
            <p id="github-installation-help">
              Copy the number at the end of the GitHub installation settings URL.
            </p>
          </PostForm>
        </details>
        {dashboard.connections.map((connection) => (
          <div className="github-connection" key={connection.installation_id}>
            <h3>{connection.account_login}</h3>
            <p>Status: {connection.status.replaceAll("_", " ")}</p>
            <p>Last synchronized: {new Date(connection.synchronized_at).toLocaleString()}</p>
            <ConnectButton organization={org} installation={connection.installation_id} />
          </div>
        ))}
        {dashboard.connections.length > 0 && (
          <PostForm
            action="/api/github/disconnect"
            label="Disconnect organization"
            pendingLabel="Disconnecting…"
          >
            <input type="hidden" name="organization" value={org} />
          </PostForm>
        )}
      </section>
      {dashboard.choices && (
        <section className="dashboard-card team-card">
          <div className="team-heading">
            <h2>Select repositories from {dashboard.choices.payload.installation.account.login}</h2>
            <ConnectButton
              organization={org}
              installation={dashboard.choices.payload.installation.id}
              label="Refresh repository list"
            />
          </div>
          <PostForm
            action="/api/github/repositories"
            className="scan-form"
            label="Connect selected repositories"
            pendingLabel="Connecting repositories…"
            variant="primary"
            disabled={!dashboard.choices.payload.repositories.length}
          >
            <input type="hidden" name="organization" value={org} />
            <input type="hidden" name="choice" value={dashboard.choices.id} />
            {dashboard.choices.payload.repositories.map((repo) => (
              <label className="github-checkbox" key={repo.id}>
                <input type="checkbox" name="repositories" value={repo.id} />
                {repo.full_name}
              </label>
            ))}
            {!dashboard.choices.payload.repositories.length && (
              <p>
                GitHub returned no repositories you can administer. Check the installation's
                repository access in GitHub, then refresh this list.
              </p>
            )}
          </PostForm>
        </section>
      )}
      {progress.github && !progress.repository && !dashboard.choices && (
        <section className="dashboard-card team-card">
          <h2>No repositories connected</h2>
          <p>
            Choose Refresh access above to select repositories you administer. If a repository is
            missing, check the GitHub installation’s repository access.
          </p>
        </section>
      )}
      {dashboard.repositories.map((repo) => {
        const state = setupProgress({
          organization: true,
          connections: dashboard.connections,
          repositories: [repo],
        });
        return (
          <section className="dashboard-card team-card" key={repo.repository_id}>
            <div className="team-heading">
              <h2>{repo.full_name}</h2>
              <span className="neutral-pill">{repo.status}</span>
            </div>
            <p>
              {state.automatic
                ? "Automatic pull request scans are enabled. Eligible events queue a job for processing."
                : !state.repository
                  ? "Reconnect access in GitHub to resume automatic scans."
                  : !state.configuration
                    ? "Save a previous release reference and paths to configure this repository."
                    : "Automatic scanning is disabled. Enable it when you’re ready to queue jobs."}
            </p>
            <Link className="text-link" href={`/team/repositories/${repo.repository_id}`}>
              Open saved scans and job status
            </Link>
            <PostForm
              action="/api/github/configure"
              className="scan-form github-settings"
              label="Save scan configuration"
              variant="primary"
            >
              <input type="hidden" name="organization" value={org} />
              <input type="hidden" name="repository" value={repo.repository_id} />
              <label>
                Migration directory
                <input
                  name="migrations"
                  required
                  maxLength={200}
                  aria-describedby={`migration-help-${repo.repository_id}`}
                  defaultValue={String(repo.configuration.migrations ?? "migrations")}
                />
                <small id={`migration-help-${repo.repository_id}`}>
                  Path relative to the repository root, such as <code>supabase/migrations</code>.
                </small>
              </label>
              <label>
                Source directories, separated by commas
                <input
                  name="sources"
                  required
                  maxLength={2010}
                  defaultValue={
                    Array.isArray(repo.configuration.sources)
                      ? repo.configuration.sources.join(",")
                      : "src"
                  }
                />
              </label>
              <label>
                Previous release tag, branch or commit
                <input
                  name="previous"
                  required
                  maxLength={200}
                  placeholder="v1.0.0"
                  defaultValue={String(repo.configuration.previous ?? "")}
                />
                <small>Use the release currently deployed, such as a tag or commit SHA.</small>
              </label>
              <label>
                Prisma schema path (optional)
                <input name="prisma" defaultValue={String(repo.configuration.prisma ?? "")} />
              </label>
              <label>
                SQL schema baseline path (optional)
                <input name="baseline" defaultValue={String(repo.configuration.baseline ?? "")} />
              </label>
              <label>
                Default PostgreSQL schema
                <input
                  name="defaultSchema"
                  required
                  defaultValue={String(repo.configuration.defaultSchema ?? "public")}
                />
              </label>
              <label className="github-checkbox">
                <input
                  type="checkbox"
                  name="publishChecks"
                  defaultChecked={repo.configuration.publishChecks !== false}
                />
                Publish GitHub Checks
              </label>
              <label>
                Fail the Check at this severity or higher
                <select
                  name="checkFailOn"
                  defaultValue={String(
                    (repo.configuration.checkPolicy as { failOn?: string } | undefined)?.failOn ??
                      "high",
                  )}
                >
                  <option value="critical">Critical</option>
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                  <option value="info">Info</option>
                  <option value="none">Only confirmed incompatibilities</option>
                </select>
              </label>
              <label>
                Incomplete analysis
                <select
                  name="checkIncomplete"
                  defaultValue={String(
                    (repo.configuration.checkPolicy as { incomplete?: string } | undefined)
                      ?.incomplete ?? "action_required",
                  )}
                >
                  <option value="action_required">Require action</option>
                  <option value="failure">Fail the Check</option>
                </select>
              </label>
              <label className="github-checkbox">
                <input type="checkbox" name="enabled" defaultChecked={repo.enabled} />
                Enable automatic pull-request scans
              </label>
              <p>
                The configured previous release is compared with the exact pull request head.
                Confirmed incompatibilities always fail the Check.
              </p>
            </PostForm>
            <PostForm
              action="/api/github/disconnect"
              label="Disconnect repository"
              pendingLabel="Disconnecting…"
            >
              <input type="hidden" name="organization" value={org} />
              <input type="hidden" name="repository" value={repo.repository_id} />
            </PostForm>
          </section>
        );
      })}
    </main>
  );
}

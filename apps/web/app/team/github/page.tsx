import Link from "next/link";
import { z } from "zod";
import { Brand } from "@/components/brand";
import { githubReady } from "@/lib/github/config";
import { choices } from "@/lib/github/contracts";
import { githubStore } from "@/lib/github/store";
import { supabaseSettings } from "@/lib/supabase/config";
import { requireIdentity } from "@/lib/supabase/server";
import { ConnectButton } from "./connect-button";

export const dynamic = "force-dynamic";
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
      <main className="container team-layout">
        <Brand />
        <h1>Connect GitHub</h1>
        <section className="dashboard-card team-card">
          <h2>Finish connection setup</h2>
          <p>
            {!supabaseSettings()
              ? "Supabase is not configured. Connect it to sign in and save your organization's GitHub connection."
              : "The GitHub App is not configured. Add the server settings before connecting a repository."}
          </p>
          <p>
            Configure Supabase, register your GitHub App, and add the settings from .env.example to
            apps/web/.env.local. Restart the app afterward.
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
    const { data } = await client.from("organizations").select("id,name").order("name");
    return (
      <main className="container team-layout">
        <Brand />
        <h1>Select an organization</h1>
        <p>Owners and admins can connect GitHub repositories.</p>
        <ul>
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
      <main className="container team-layout">
        <Brand />
        <h1>GitHub connection unavailable</h1>
        <p>
          You need owner or admin access. If you have that role, check the Supabase connection and
          apply the GitHub migration.
        </p>
        <Link className="text-link" href="/team">
          Team workspace
        </Link>
      </main>
    );
  }
  const org = organization.data;
  return (
    <main className="container team-layout">
      <header className="team-header">
        <Brand />
        <Link className="text-link" href="/team">
          Team workspace
        </Link>
      </header>
      <h1>GitHub connections</h1>
      <p>Connect selected repositories and analyze their pull requests.</p>
      {query.notice && messages[query.notice] && (
        <p className="auth-notice" role="status">
          {messages[query.notice]}
        </p>
      )}
      <section className="dashboard-card team-card">
        <h2>
          {dashboard.connections.length ? "Your GitHub installations" : "No GitHub connection yet"}
        </h2>
        <p>
          GitHub will ask which repositories RollbackIQ can access. You must also have
          administrative access to the repositories you connect here.
        </p>
        <ConnectButton organization={org} />
        <details>
          <summary>Already installed on GitHub?</summary>
          <form action="/api/github/connect" method="post" className="scan-form">
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
            <button className="button secondary compact" type="submit">
              Continue with existing installation
            </button>
          </form>
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
          <form action="/api/github/disconnect" method="post">
            <input type="hidden" name="organization" value={org} />
            <button className="button secondary compact" type="submit">
              Disconnect organization
            </button>
          </form>
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
          <form action="/api/github/repositories" method="post" className="scan-form">
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
            <button
              className="button primary compact"
              disabled={!dashboard.choices.payload.repositories.length}
              type="submit"
            >
              Connect selected repositories
            </button>
          </form>
        </section>
      )}
      {dashboard.repositories.map((repo) => (
        <section className="dashboard-card team-card" key={repo.repository_id}>
          <div className="team-heading">
            <h2>{repo.full_name}</h2>
            <span className="neutral-pill">{repo.status}</span>
          </div>
          <p>
            {repo.enabled
              ? "Automatic pull-request scanning enabled"
              : "Automatic scanning is disabled. Set your previous release and paths to enable it."}
          </p>
          <Link className="text-link" href={`/team/repositories/${repo.repository_id}`}>
            Open saved scans and job status
          </Link>
          <form action="/api/github/configure" method="post" className="scan-form github-settings">
            <input type="hidden" name="organization" value={org} />
            <input type="hidden" name="repository" value={repo.repository_id} />
            <label>
              Migration directory
              <input
                name="migrations"
                required
                defaultValue={String(repo.configuration.migrations ?? "migrations")}
              />
            </label>
            <label>
              Source directories, separated by commas
              <input
                name="sources"
                required
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
                placeholder="v1.0.0"
                defaultValue={String(repo.configuration.previous ?? "")}
              />
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
            <button className="button primary compact" type="submit">
              Save scan configuration
            </button>
          </form>
          <form action="/api/github/disconnect" method="post">
            <input type="hidden" name="organization" value={org} />
            <input type="hidden" name="repository" value={repo.repository_id} />
            <button className="button secondary compact" type="submit">
              Disconnect repository
            </button>
          </form>
        </section>
      ))}
    </main>
  );
}

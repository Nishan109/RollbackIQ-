import Link from "next/link";
import { signOut } from "@/app/auth/actions";
import { Brand } from "@/components/brand";
import { supabaseSettings } from "@/lib/supabase/config";
import { requireIdentity } from "@/lib/supabase/server";
import { addRepository, createOrganization, setMember } from "./actions";

export const dynamic = "force-dynamic";

const notices: Record<string, string> = {
  invalid: "Check the form values and try again.",
  failed: "The change could not be saved. Check your role and the submitted values.",
  organization: "Organization created.",
  membership: "Membership saved.",
  github_failed:
    "GitHub authorization could not be verified. Reopen GitHub connections and try again.",
};

export default async function TeamPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string }>;
}) {
  if (!supabaseSettings())
    return (
      <main className="container team-layout">
        <Brand />
        <h1>Team workspace</h1>
        <p>Connect Supabase to manage organizations and save scan history.</p>
        <Link className="text-link" href="/team/github">
          GitHub connection setup
        </Link>
        <Link className="button secondary" href="/workspace">
          Open local workspace
        </Link>
      </main>
    );
  const { client, user } = await requireIdentity();
  const [organizations, repositories, memberships] = await Promise.all([
    client.from("organizations").select("id,name").order("name").limit(100),
    client.from("repositories").select("id,organization_id,name").order("name").limit(200),
    client.from("organization_members").select("organization_id,user_id,role").limit(500),
  ]);
  const { notice } = await searchParams;
  return (
    <main className="container team-layout">
      <header className="team-header">
        <Brand />
        <Link href="/workspace" className="text-link">
          Local workspace
        </Link>
        <form action={signOut}>
          <button className="button secondary compact" type="submit">
            Sign out
          </button>
        </form>
      </header>
      <h1>Team workspace</h1>
      <p>Signed in as {user.email ?? user.id}</p>
      <p>
        Account ID <code>{user.id}</code>
      </p>
      {notice && Object.hasOwn(notices, notice) && (
        <p className="auth-notice" role="status">
          {notices[notice]}
        </p>
      )}
      {(organizations.error || repositories.error || memberships.error) && (
        <p className="form-error" role="alert">
          Team data is unavailable. Check the Supabase connection and migration status.
        </p>
      )}
      <section className="dashboard-card team-card">
        <h2>Create an organization</h2>
        <form className="scan-form inline-form" action={createOrganization}>
          <label>
            Organization name
            <input name="name" required maxLength={100} />
          </label>
          <button className="button primary compact" type="submit">
            Create organization
          </button>
        </form>
      </section>
      {organizations.data?.map((org) => {
        const members =
          memberships.data?.filter(({ organization_id }) => organization_id === org.id) ?? [];
        const role = members.find(({ user_id }) => user_id === user.id)?.role;
        const repos =
          repositories.data?.filter(({ organization_id }) => organization_id === org.id) ?? [];
        return (
          <section className="dashboard-card team-card" key={org.id}>
            <div className="team-heading">
              <h2>{org.name}</h2>
              <span className="neutral-pill">{role ?? "Member"}</span>
            </div>
            <h3>Repositories</h3>
            {(role === "owner" || role === "admin") && (
              <Link className="text-link" href={`/team/github?organization=${org.id}`}>
                Manage GitHub connection
              </Link>
            )}
            {repos.length ? (
              <ul>
                {repos.map((repo) => (
                  <li key={repo.id}>
                    <Link className="text-link" href={`/team/repositories/${repo.id}`}>
                      {repo.name}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p>No repositories have been added.</p>
            )}
            {(role === "owner" || role === "admin") && (
              <form className="scan-form inline-form" action={addRepository}>
                <input type="hidden" name="organizationId" value={org.id} />
                <label>
                  Repository name
                  <input name="name" placeholder="owner/repository" required maxLength={140} />
                </label>
                <button className="button secondary compact" type="submit">
                  Add repository
                </button>
              </form>
            )}
            <details>
              <summary>Members ({members.length})</summary>
              <ul>
                {members.map((member) => (
                  <li key={member.user_id}>
                    <code>{member.user_id}</code> · {member.role}
                    {member.user_id === user.id ? " (you)" : ""}
                  </li>
                ))}
              </ul>
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
                  <button className="button secondary compact" type="submit">
                    Save membership
                  </button>
                </form>
              )}
            </details>
          </section>
        );
      })}
    </main>
  );
}

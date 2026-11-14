import Link from "next/link";
import { Brand } from "@/components/brand";

export default function RepositoryNotFound() {
  return (
    <main className="container team-layout product-team">
      <header className="team-header">
        <Brand />
      </header>
      <section className="dashboard-card team-card">
        <h1>Repository unavailable</h1>
        <p>
          Open a repository from your workspace. If you expected access, ask an organization owner
          or admin to check your membership.
        </p>
        <Link className="button secondary" href="/team">
          Back to Team workspace
        </Link>
      </section>
    </main>
  );
}

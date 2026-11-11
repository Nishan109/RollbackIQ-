import {
  ArrowDown,
  ArrowRight,
  Braces,
  CircleHelp,
  Database,
  FileCode2,
  Github,
  GitPullRequest,
  LayoutDashboard,
  ListFilter,
  ScanLine,
  ShieldAlert,
  Terminal,
} from "lucide-react";
import Link from "next/link";
import { Brand } from "@/components/brand";
import { SeverityBadge } from "@/components/report-ui";
import { getDemo } from "@/lib/demo";

const steps = [
  {
    icon: FileCode2,
    title: "Select a migration",
    detail:
      "Analyze SQL files locally or compare changed migrations against a baseline in GitHub Actions.",
  },
  {
    icon: ScanLine,
    title: "Inspect the schema changes",
    detail:
      "PostgreSQL’s parser identifies destructive DDL, constraint changes, and statements that need manual review.",
  },
  {
    icon: GitPullRequest,
    title: "Review before you merge",
    detail:
      "Open the rule evidence, test rollback assumptions, and enforce a severity threshold in CI.",
  },
];

const plans = [
  {
    name: "Community",
    price: "Free",
    detail: "Local PostgreSQL CLI, basic rules and JSON reports.",
  },
  {
    name: "Startup",
    price: "₹1,999",
    term: "/ month",
    detail: "Hosted dashboard, scan history and AI explanations.",
  },
  {
    name: "Business",
    price: "₹5,999",
    term: "/ month",
    detail: "Team approvals, advanced policies and audit history.",
  },
  {
    name: "Enterprise",
    price: "Custom",
    detail: "Private deployments, enterprise authentication and governance.",
  },
];

export default async function Home() {
  const { report } = await getDemo();

  return (
    <div className="marketing">
      <header className="site-header">
        <div className="site-nav container">
          <Brand />
          <nav aria-label="Main navigation">
            <a href="#how-it-works">How it works</a>
            <a href="#integration">GitHub Actions</a>
            <a href="#pricing">Pricing</a>
          </nav>
          <Link className="button secondary compact" href="/workspace">
            Open workspace <ArrowRight size={15} />
          </Link>
        </div>
      </header>

      <main>
        <section className="hero">
          <div className="hero-grid" aria-hidden="true" />
          <div className="container hero-inner">
            <span className="tech-tag">
              <Database size={13} /> PostgreSQL migration analysis
            </span>
            <h1>
              Deploy With Confidence.
              <br />
              <span>Roll Back With Evidence.</span>
            </h1>
            <p>
              Detect database migration hazards and application
              <br className="desktop-break" /> compatibility risks before your next release.
            </p>
            <div className="hero-actions">
              <Link className="button primary" href="/workspace">
                Start Free <ArrowRight size={17} />
              </Link>
              <a className="button secondary" href="#platform">
                Explore the Platform <ArrowDown size={16} />
              </a>
            </div>
            <div className="hero-integrations">
              <Database size={14} /> PostgreSQL <span /> <Github size={14} /> GitHub Actions{" "}
              <span /> <Braces size={14} /> JSON &amp; SARIF
            </div>
          </div>
          <div className="container preview-container" id="platform">
            <div className="app-preview">
              <div className="preview-bar">
                <div className="window-dots" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </div>
                <span>ROLLBACKIQ / RELEASE PREFLIGHT</span>
                <span className="demo-dot">Demo workspace</span>
              </div>
              <div className="preview-body">
                <div className="preview-nav" aria-hidden="true">
                  <span className="preview-workspace">
                    <b>AC</b> Acme Commerce
                  </span>
                  <span className="selected">
                    <LayoutDashboard size={15} /> Overview
                  </span>
                  <span>
                    <FileCode2 size={15} /> Migrations
                  </span>
                  <span>
                    <ShieldAlert size={15} /> Risk findings
                  </span>
                  <span>
                    <ListFilter size={15} /> Scan history
                  </span>
                </div>
                <div className="preview-content">
                  <div className="preview-title">
                    <div>
                      <span className="mono eyebrow">ACME COMMERCE / MIGRATIONS</span>
                      <h2>Release overview</h2>
                    </div>
                    <Link href="/workspace/demo" className="button primary compact">
                      <ScanLine size={15} /> Open demo
                    </Link>
                  </div>
                  <div className="preview-metrics">
                    <div>
                      <span>
                        <FileCode2 size={15} /> Files analyzed
                      </span>
                      <strong>{report.summary.files}</strong>
                    </div>
                    <div>
                      <span>
                        <ShieldAlert size={15} /> High &amp; critical
                      </span>
                      <strong>
                        {report.summary.bySeverity.high + report.summary.bySeverity.critical}
                      </strong>
                    </div>
                    <div>
                      <span>
                        <CircleHelp size={15} /> Incomplete files
                      </span>
                      <strong>{report.summary.incompleteFiles}</strong>
                    </div>
                  </div>
                  <div className="preview-findings">
                    <div className="preview-findings-title">
                      Migration findings <span>{report.findings.length} findings</span>
                    </div>
                    {report.findings.slice(0, 3).map((finding) => (
                      <div className="preview-finding" key={finding.id}>
                        <SeverityBadge severity={finding.severity} />
                        <span>{finding.title}</span>
                        <code>{finding.object ?? finding.ruleId}</code>
                        <span className="mono">{finding.ruleId}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="container section" id="how-it-works">
          <div className="section-intro">
            <span className="eyebrow mono">WORKFLOW</span>
            <h2>From migration to review.</h2>
            <p>Trace each finding to the operation and source line that triggered it.</p>
          </div>
          <div className="marketing-cards">
            {steps.map(({ icon: Icon, title, detail }) => (
              <article className="marketing-card" key={title}>
                <span className="feature-icon">
                  <Icon size={21} />
                </span>
                <h3>{title}</h3>
                <p>{detail}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="container section integration" id="integration">
          <div>
            <span className="eyebrow mono">CI INTEGRATION</span>
            <h2>
              Catch migration risks
              <br /> in the pull request.
            </h2>
            <p>
              Compare migration files with a Git baseline. RollbackIQ reports source locations,
              produces SARIF and applies your policy in GitHub Actions.
            </p>
            <p>Connect the GitHub App to save pull-request scans in your team workspace.</p>
            <Link className="button secondary compact" href="/team/github">
              Connect GitHub
            </Link>
            <Link className="text-link" href="/workspace/demo">
              Inspect a sample report <ArrowRight size={15} />
            </Link>
          </div>
          <div className="terminal">
            <div>
              <Terminal size={16} /> Local CLI
            </div>
            <pre>
              <code>
                <span>$</span> pnpm scan:git \{"\n"} --base main --head HEAD \{"\n"} --path
                prisma/migrations \{"\n"} --fail-on high --fail-incomplete
              </code>
            </pre>
          </div>
        </section>

        <section className="container section" id="pricing">
          <div className="section-intro">
            <span className="eyebrow mono">PRICING</span>
            <h2>Start with the local scanner.</h2>
            <p>Proposed hosted pricing. Community scanning is available in this build.</p>
          </div>
          <div className="plan-grid">
            {plans.map(({ name, price, term, detail }) => (
              <article className="marketing-card" key={name}>
                <h3>{name}</h3>
                <strong>
                  {price} <small>{term}</small>
                </strong>
                <p>{detail}</p>
                {name === "Community" && (
                  <Link className="text-link" href="/workspace">
                    Try the scanner <ArrowRight size={14} />
                  </Link>
                )}
              </article>
            ))}
          </div>
        </section>

        <section className="container section faq" aria-labelledby="faq-heading">
          <div className="section-intro">
            <h2 id="faq-heading">Frequently asked questions</h2>
          </div>
          <details>
            <summary>Does a clean scan prove my deployment is safe?</summary>
            <p>
              Static analysis covers specific operations. Review uncovered statements and rehearse
              both deployment and rollback with representative data.
            </p>
          </details>
          <details>
            <summary>Do I need to connect my database?</summary>
            <p>
              The scanner reads migration text using PostgreSQL’s parser. You can run it locally
              without a database connection.
            </p>
          </details>
          <details>
            <summary>Can I try it without a GitHub account?</summary>
            <p>
              Paste your own SQL in the local workspace or try the examples in the demo. The
              workspace keeps scan history in memory for this browser tab.
            </p>
          </details>
        </section>
      </main>

      <footer className="site-footer">
        <div className="container">
          <Brand />
          <p>Know Your Rollback Risk Before You Deploy.</p>
          <Link href="/workspace">
            Open workspace <ArrowRight size={15} />
          </Link>
        </div>
      </footer>
    </div>
  );
}

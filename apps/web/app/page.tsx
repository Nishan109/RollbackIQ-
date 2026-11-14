import {
  ArrowDown,
  ArrowRight,
  Braces,
  Check,
  CheckCheck,
  ChevronRight,
  Database,
  FileCode2,
  FileJson2,
  GitBranch,
  Github,
  GitPullRequest,
  Layers3,
  Plus,
  ScanLine,
  ShieldCheck,
  Terminal,
  TriangleAlert,
} from "lucide-react";
import Link from "next/link";
import { Brand } from "@/components/brand";
import { getCompatibilityDemo } from "@/lib/compatibility-demo";
import { getDemo } from "@/lib/demo";
import { verdictLabel } from "@/lib/team-experience";
import styles from "./landing.module.css";
import { HeroMotionToggle, LandingNavigation, ProductPreview } from "./landing-experience";

const heroHeadlines = [
  ["Ship forward.", "Think backward."],
  ["Change schema.", "Check old code."],
  ["Spot the risk.", "Before you merge."],
];

const workflow = [
  {
    icon: Github,
    title: "Connect your repository.",
    description:
      "Choose the repositories the GitHub App can access. Point RollbackIQ at your migrations, source code, and previous release.",
    detail: "Your repository. Your scope.",
  },
  {
    icon: GitPullRequest,
    title: "Open a pull request.",
    description:
      "Eligible PR events queue a scan of the exact head commit. Proposed schema changes are compared with the previous application release.",
    detail: "A precise commit comparison.",
  },
  {
    icon: CheckCheck,
    title: "Make an informed call.",
    description:
      "Review source evidence and coverage gaps. Apply your severity policy to GitHub Checks and keep the report for your team.",
    detail: "Evidence before the merge.",
  },
];

const questions = [
  {
    title: "What does previous-release compatibility mean?",
    answer:
      "After a database migration, an older application version may still need to run. RollbackIQ compares migration changes with supported queries from that previous release, so you can see which database objects its code still depends on.",
  },
  {
    title: "Do I need to connect my production database?",
    answer:
      "No. Static analysis reads migration SQL and repository source files. You can also supply a SQL baseline or Prisma schema to improve schema context. Your migration is analyzed, not executed against your database.",
  },
  {
    title: "Does a clean report guarantee a safe deployment?",
    answer:
      "A report is limited to the supplied inputs and supported operations. RollbackIQ shows incomplete coverage explicitly. Review those gaps and rehearse deployment and rollback with representative data before making a release decision.",
  },
  {
    title: "Can I try it before connecting GitHub?",
    answer:
      "Yes. Explore the interactive sample or paste your own PostgreSQL migration into the local scanner. Manual scans and file imports stay in that browser tab. Connected team reports are saved and reload in your signed-in dashboard.",
  },
  {
    title: "Where do my team’s reports live?",
    answer:
      "Completed GitHub scans are saved to your organization. Open them from Team workspace or your dashboard, revisit scan history, and download JSON or SARIF. Access follows your organization membership.",
  },
];

export default async function Home() {
  const [{ report }, compatibility] = await Promise.all([getDemo(), getCompatibilityDemo()]);
  const lead = compatibility.findings.find(({ ruleId }) => ruleId === "COMPAT001");
  const evidence = lead?.previousEvidence[0];
  const criticalCount = compatibility.findings.filter(
    ({ severity }) => severity === "critical",
  ).length;

  return (
    <div className={styles.page}>
      <LandingNavigation />
      <main id="main-content">
        <section className={styles.hero} id="landing-hero" aria-labelledby="hero-heading">
          <div className={styles.heroTexture} aria-hidden="true" />
          <div className={`${styles.container} ${styles.heroGrid}`}>
            <div className={styles.heroCopy}>
              <a className={styles.announcement} href="#product">
                <span className={styles.statusDot} />
                Meet previous-release compatibility
                <ChevronRight size={14} aria-hidden="true" />
              </a>
              <h1 id="hero-heading">
                {heroHeadlines.map(([firstLine, secondLine], index) => (
                  <span
                    className={styles.headlineFrame}
                    aria-hidden={index > 0 ? true : undefined}
                    key={firstLine}
                  >
                    <span className={styles.headlineForward}>{firstLine}</span>{" "}
                    <span className={styles.headlineBackward}>{secondLine}</span>
                  </span>
                ))}
              </h1>
              <div className={styles.headlineProgress} aria-hidden="true">
                {heroHeadlines.map(([firstLine]) => (
                  <span className={styles.headlineProgressSegment} key={firstLine} />
                ))}
              </div>
              <p className={styles.heroDescription}>
                Your next migration shouldn’t break your last release. Find the PostgreSQL changes
                that could, with evidence from the code you already ship.
              </p>
              <div className={styles.actions}>
                <Link className={styles.primaryButton} href="/auth?mode=signup">
                  Get started <ArrowRight size={17} aria-hidden="true" />
                </Link>
                <Link className={styles.secondaryButton} href="/workspace/demo">
                  <ScanLine size={17} aria-hidden="true" /> Explore the demo
                </Link>
              </div>
              <p className={styles.heroNote}>
                <Check size={14} aria-hidden="true" /> Static analysis. No database connection
                needed.
              </p>
              <div className={styles.heroLinks}>
                <a className={styles.heroProductLink} href="#product">
                  See what’s inside <ArrowDown size={14} aria-hidden="true" />
                </a>
                <HeroMotionToggle />
              </div>
            </div>
            <figure
              className={styles.heroVisual}
              aria-label="Sample column removal and previous-release query"
            >
              <div className={styles.visualGrid} aria-hidden="true">
                <span className={styles.visualRail} />
                <span className={styles.visualRail} />
              </div>
              <div className={styles.visualTopline}>
                <span className={styles.smallLabel}>ONE CHANGE. TWO RELEASES.</span>
                <span>Sample analysis</span>
              </div>
              <div className={styles.releaseCard}>
                <div className={styles.releaseCardHeader}>
                  <span className={styles.releaseIcon}>
                    <GitBranch size={16} aria-hidden="true" />
                  </span>
                  <div>
                    <strong>Previous application</strong>
                    <span>demo-v1 · still in the rollback window</span>
                  </div>
                  <span className={styles.versionPill}>v1</span>
                </div>
                <code className={styles.queryLine}>
                  <span>SELECT</span> id, <mark>legacy_tier</mark>
                  <br />
                  <span>FROM</span> public.accounts;
                </code>
              </div>
              <div className={styles.connectionTrack} aria-hidden="true">
                <span className={styles.trackLine} />
                <span className={styles.databaseNode}>
                  <Database size={22} />
                </span>
                <span className={styles.trackLabel}>Same database. Changed schema.</span>
              </div>
              <div className={styles.migrationCard}>
                <div className={styles.releaseCardHeader}>
                  <span className={styles.migrationIcon}>
                    <FileCode2 size={16} aria-hidden="true" />
                  </span>
                  <div>
                    <strong>Proposed migration</strong>
                    <span>002_drop_legacy_tier.sql</span>
                  </div>
                  <span className={styles.changePill}>− column</span>
                </div>
                <code className={styles.queryLine}>
                  <span>ALTER TABLE</span> public.accounts
                  <br />
                  <em>DROP COLUMN legacy_tier;</em>
                </code>
              </div>
              <div className={styles.conflictNotice}>
                <TriangleAlert size={17} aria-hidden="true" />
                <div>
                  <strong>That column is still in use.</strong>
                  <span>Critical · High confidence · COMPAT001</span>
                </div>
                <span className={styles.conflictDot} />
              </div>
            </figure>
          </div>
        </section>

        <div className={`${styles.container} ${styles.stackStrip}`}>
          <span>
            Built around your
            <br />
            <strong>existing workflow.</strong>
          </span>
          <div>
            <Database size={20} aria-hidden="true" /> PostgreSQL
          </div>
          <div>
            <Github size={21} aria-hidden="true" /> GitHub
          </div>
          <div>
            <Layers3 size={20} aria-hidden="true" /> Prisma
          </div>
          <div>
            <Braces size={21} aria-hidden="true" /> SQL · JSON · SARIF
          </div>
        </div>

        <section
          className={`${styles.container} ${styles.productSection}`}
          id="product"
          aria-labelledby="product-heading"
        >
          <div className={styles.centeredHeading}>
            <span className={styles.eyebrow}>
              <span /> THE RELEASE, IN FOCUS
            </span>
            <h2 id="product-heading">
              A finding is just the beginning.
              <br />
              <span>The evidence is what matters.</span>
            </h2>
            <p>
              Follow a schema change to the code it affects. Understand the risk, the confidence,
              and the limits of what was checked.
            </p>
          </div>
          <ProductPreview
            data={{
              previous: compatibility.previous.ref,
              proposed: compatibility.proposed.ref,
              verdictLabel: verdictLabel(compatibility.status),
              criticalCount,
              findingCount: compatibility.findings.length,
              queryCount: compatibility.dependencies.previous.queries,
              gapCount: compatibility.coverage.gaps.length,
              migrationCount: report.summary.files,
              lead: lead
                ? {
                    title: lead.title,
                    rule: lead.ruleId,
                    severity: lead.severity,
                    object: lead.object ?? "public.accounts.legacy_tier",
                    confidence: lead.confidence,
                    source: evidence
                      ? `${evidence.location.path}:${evidence.location.line}`
                      : "src/customers.ts",
                    migration: lead.location
                      ? `${lead.location.path}:${lead.location.line}`
                      : "migrations/002_drop_legacy_tier.sql",
                  }
                : null,
              migrationFindings: report.findings.map(({ id, title, severity, object, ruleId }) => ({
                id,
                title,
                severity,
                object,
                ruleId,
              })),
            }}
          />
          <p className={styles.previewCaption}>
            <ShieldCheck size={14} aria-hidden="true" />
            Interactive sample data. Your organization’s reports stay private.
            <Link href="/workspace/demo">
              Open the full demo <ArrowRight size={14} aria-hidden="true" />
            </Link>
          </p>
        </section>

        <section
          className={`${styles.container} ${styles.section}`}
          aria-labelledby="evidence-heading"
        >
          <div className={styles.splitHeading}>
            <div>
              <span className={styles.eyebrow}>BUILT FOR THE DETAILS</span>
              <h2 id="evidence-heading">
                Less guesswork.
                <br />
                <span>More context.</span>
              </h2>
            </div>
            <p>
              Database changes deserve more than a green check. Get the context you need to review
              the way you work.
            </p>
          </div>
          <div className={styles.featureGrid}>
            <article className={styles.evidenceFeature}>
              <span className={styles.featureIcon}>
                <GitBranch size={22} aria-hidden="true" />
              </span>
              <h3>
                The change. The query.
                <br />
                The connection between them.
              </h3>
              <p>
                See which supported queries in your previous release reference a changed table or
                column, down to the file and line.
              </p>
              <div className={styles.evidenceTree}>
                <div className={styles.treeFile}>
                  <FileCode2 size={15} aria-hidden="true" />
                  <span>src/customers.ts</span>
                  <span>:4</span>
                </div>
                <div className={styles.treeBranch}>
                  <span />
                  <code>accountPlan(id)</code>
                  <span className={styles.referencePill}>SELECT</span>
                </div>
                <div className={styles.treeObject}>
                  <Database size={16} aria-hidden="true" />
                  <code>
                    public.accounts.<strong>legacy_tier</strong>
                  </code>
                  <span>removed</span>
                </div>
              </div>
              <div className={styles.featureFooter}>
                <Check size={14} aria-hidden="true" /> SQL references <span /> Prisma references{" "}
                <span /> Source locations
              </div>
            </article>
            <div className={styles.featureColumn}>
              <article className={styles.coverageFeature}>
                <span className={styles.featureIcon}>
                  <ScanLine size={21} aria-hidden="true" />
                </span>
                <h3>Honest about its blind spots.</h3>
                <p>
                  Unsupported operations and unresolved inputs stay visible. Incomplete coverage is
                  a reason to look closer.
                </p>
                <div className={styles.coverageVisual}>
                  <div>
                    <span className={styles.coverageTick}>
                      <Check size={13} aria-hidden="true" />
                    </span>
                    <span>Previous-release queries</span>
                    <strong>{compatibility.dependencies.previous.queries} analyzed</strong>
                  </div>
                  <div>
                    <span className={styles.coverageWarning}>
                      <TriangleAlert size={13} aria-hidden="true" />
                    </span>
                    <span>Coverage gaps</span>
                    <strong>{compatibility.coverage.gaps.length} to review</strong>
                  </div>
                </div>
              </article>
              <article className={styles.exportFeature}>
                <div>
                  <span className={styles.featureIcon}>
                    <FileJson2 size={21} aria-hidden="true" />
                  </span>
                  <h3>Built to leave the dashboard.</h3>
                  <p>Keep JSON for your tooling. Share SARIF with your code review workflow.</p>
                  <Link className={styles.inlineLink} href="/help#exports">
                    Explore report exports <ArrowRight size={14} aria-hidden="true" />
                  </Link>
                </div>
                <div className={styles.fileStack} aria-hidden="true">
                  <div>
                    <Braces size={27} />
                    <span>.json</span>
                  </div>
                  <div>
                    <FileCode2 size={27} />
                    <span>.sarif</span>
                  </div>
                </div>
              </article>
            </div>
          </div>
        </section>

        <section
          className={`${styles.workflowSection} ${styles.section}`}
          id="how-it-works"
          aria-labelledby="workflow-heading"
        >
          <div className={styles.container}>
            <div className={styles.centeredHeading}>
              <span className={styles.eyebrow}>A SMALL ADDITION TO YOUR WORKFLOW</span>
              <h2 id="workflow-heading">
                From pull request
                <br />
                <span>to a clearer release decision.</span>
              </h2>
            </div>
            <div className={styles.workflowGrid}>
              {workflow.map(({ icon: Icon, title, description, detail }, index) => (
                <article className={styles.workflowStep} key={title}>
                  <div className={styles.stepTop}>
                    <span className={styles.stepNumber}>0{index + 1}</span>
                    <Icon size={24} aria-hidden="true" />
                  </div>
                  <h3>{title}</h3>
                  <p>{description}</p>
                  <span className={styles.stepDetail}>{detail}</span>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section
          className={`${styles.container} ${styles.integrationSection} ${styles.section}`}
          id="integration"
          aria-labelledby="integration-heading"
        >
          <div className={styles.integrationCopy}>
            <span className={styles.eyebrow}>
              <Github size={15} aria-hidden="true" /> MEET YOUR EXISTING TOOLCHAIN
            </span>
            <h2 id="integration-heading">
              In the pull request.
              <br />
              <span>Before the production incident.</span>
            </h2>
            <p>
              Publish findings as GitHub Checks, with annotations that point to the migration line.
              Choose a severity threshold and how to handle incomplete analysis.
            </p>
            <ul className={styles.integrationList}>
              <li>
                <Check size={16} aria-hidden="true" /> Compare the exact pull-request head
              </li>
              <li>
                <Check size={16} aria-hidden="true" /> Link every Check to its saved report
              </li>
              <li>
                <Check size={16} aria-hidden="true" /> Review with your team, in your workflow
              </li>
            </ul>
            <Link className={styles.secondaryButton} href="/help#github-checks">
              Explore the GitHub integration <ArrowRight size={16} aria-hidden="true" />
            </Link>
          </div>
          <div className={styles.terminalCard}>
            <div className={styles.terminalHeader}>
              <div className={styles.windowDots} aria-hidden="true">
                <i />
                <i />
                <i />
              </div>
              <span>
                <Terminal size={14} aria-hidden="true" /> Prefer the command line?
              </span>
              <span className={styles.terminalLanguage}>CLI</span>
            </div>
            <div className={styles.terminalBody}>
              <p className={styles.terminalComment}># Inspect a release from your terminal</p>
              <pre>
                <code>
                  <span>$</span> pnpm compatibility \{"\n"} --repo . \{"\n"} --previous v1.0.0 \
                  {"\n"} --proposed HEAD \{"\n"} --migrations supabase/migrations \{"\n"} --sources
                  src
                </code>
              </pre>
            </div>
            <div className={styles.terminalFooter}>
              <Braces size={15} aria-hidden="true" />
              <span>Repository analysis. Structured output.</span>
              <Link href="/help">
                Read the guide <ArrowRight size={13} aria-hidden="true" />
              </Link>
            </div>
          </div>
        </section>

        <section
          className={`${styles.container} ${styles.faqSection} ${styles.section}`}
          id="faq"
          aria-labelledby="faq-heading"
        >
          <div>
            <span className={styles.eyebrow}>BEFORE YOU GET STARTED</span>
            <h2 id="faq-heading">
              Good questions.
              <br />
              <span>Clear answers.</span>
            </h2>
            <p>Have a look under the hood.</p>
            <Link className={styles.inlineLink} href="/help">
              Visit the help center <ArrowRight size={15} aria-hidden="true" />
            </Link>
          </div>
          <div className={styles.faqList}>
            {questions.map(({ title, answer }, index) => (
              <details key={title} name="landing-questions" open={index === 0}>
                <summary>
                  {title}
                  <Plus size={18} aria-hidden="true" />
                </summary>
                <p>{answer}</p>
              </details>
            ))}
          </div>
        </section>

        <section className={styles.container} aria-labelledby="start-heading">
          <div className={styles.finalCta}>
            <div className={styles.ctaOrbit} aria-hidden="true">
              <span />
              <span />
              <span />
              <GitBranch size={50} strokeWidth={1} />
            </div>
            <span className={styles.eyebrow}>YOUR NEXT RELEASE STARTS HERE</span>
            <h2 id="start-heading">
              A little more evidence.
              <br />
              <span>A better release decision.</span>
            </h2>
            <p>Know what your migration changes. And what your previous release still needs.</p>
            <div className={styles.actions}>
              <Link className={styles.primaryButton} href="/auth?mode=signup">
                Get started with RollbackIQ <ArrowRight size={17} aria-hidden="true" />
              </Link>
              <Link className={styles.ctaSecondary} href="/workspace/demo">
                Take a look around <ArrowRight size={16} aria-hidden="true" />
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className={`${styles.container} ${styles.footer}`}>
        <div className={styles.footerMain}>
          <div>
            <Brand />
            <p>
              Evidence for the release ahead.
              <br />
              And the one behind.
            </p>
          </div>
          <nav aria-label="Product links">
            <span>PRODUCT</span>
            <Link href="/workspace">Dashboard</Link>
            <Link href="/workspace/demo">Sample report</Link>
            <Link href="/team">Team workspace</Link>
          </nav>
          <nav aria-label="Resource links">
            <span>RESOURCES</span>
            <Link href="/help">Help center</Link>
            <Link href="/help#github-checks">GitHub Checks</Link>
            <Link href="/help#exports">Report exports</Link>
          </nav>
        </div>
        <div className={styles.footerBottom}>
          <span>© {new Date().getFullYear()} RollbackIQ</span>
          <span>
            <Database size={13} aria-hidden="true" /> Built for PostgreSQL.
          </span>
          <Link href="/auth">
            Sign in <ArrowRight size={13} aria-hidden="true" />
          </Link>
        </div>
      </footer>
    </div>
  );
}

"use client";

import type { Severity } from "@rollbackiq/scanner-core";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronRight,
  CircleX,
  Database,
  FileCode2,
  GitBranch,
  Github,
  GitPullRequest,
  Menu,
  Pause,
  Play,
  ScanLine,
  ShieldAlert,
  TriangleAlert,
  X,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { Brand } from "@/components/brand";
import { SeverityBadge } from "@/components/report-ui";
import styles from "./landing.module.css";

export function LandingNavigation() {
  const [open, setOpen] = useState(false);
  const header = useRef<HTMLElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    function dismiss(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      }
    }
    function outside(event: PointerEvent) {
      if (event.target instanceof Node && !header.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener("keydown", dismiss);
    document.addEventListener("pointerdown", outside);
    return () => {
      document.removeEventListener("keydown", dismiss);
      document.removeEventListener("pointerdown", outside);
    };
  }, [open]);
  return (
    <header className={styles.header} ref={header}>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <div className={`${styles.container} ${styles.navigation}`}>
        <Brand />
        <nav
          className={styles.navLinks}
          id="landing-navigation"
          aria-label="Main navigation"
          data-open={open}
        >
          <Link href="#product" onClick={() => setOpen(false)}>
            Product
          </Link>
          <Link href="#how-it-works" onClick={() => setOpen(false)}>
            How it works
          </Link>
          <Link href="#integration" onClick={() => setOpen(false)}>
            GitHub
          </Link>
          <Link href="/help" onClick={() => setOpen(false)}>
            Resources <ArrowUpRight size={12} aria-hidden="true" />
          </Link>
          <Link className={styles.mobileSignIn} href="/auth" onClick={() => setOpen(false)}>
            Sign in
          </Link>
        </nav>
        <div className={styles.navActions}>
          <Link className={styles.signIn} href="/auth">
            Sign in
          </Link>
          <Link className={styles.navCta} href="/auth?mode=signup">
            Get started <ArrowRight size={14} aria-hidden="true" />
          </Link>
          <button
            type="button"
            className={styles.menuButton}
            ref={trigger}
            aria-expanded={open}
            aria-controls="landing-navigation"
            aria-label={open ? "Close navigation" : "Open navigation"}
            onClick={() => setOpen(!open)}
          >
            {open ? <X size={21} /> : <Menu size={21} />}
          </button>
        </div>
      </div>
    </header>
  );
}

export function HeroMotionToggle() {
  const [paused, setPaused] = useState(false);
  return (
    <button
      type="button"
      className={styles.heroMotionToggle}
      aria-label="Pause hero animation"
      aria-pressed={paused}
      aria-controls="landing-hero"
      title={paused ? "Resume hero animation" : "Pause hero animation"}
      onClick={() => setPaused((wasPaused) => !wasPaused)}
    >
      {paused ? <Play size={13} aria-hidden="true" /> : <Pause size={13} aria-hidden="true" />}
    </button>
  );
}

type PreviewData = {
  previous: string;
  proposed: string;
  verdictLabel: string;
  criticalCount: number;
  findingCount: number;
  queryCount: number;
  gapCount: number;
  migrationCount: number;
  lead: {
    title: string;
    rule: string;
    severity: Severity;
    object: string;
    confidence: string;
    source: string;
    migration: string;
  } | null;
  migrationFindings: {
    id: string;
    title: string;
    severity: Severity;
    object: string | null;
    ruleId: string;
  }[];
};
const tabs = [
  { label: "Compatibility", icon: GitBranch },
  { label: "Migrations", icon: FileCode2 },
  { label: "GitHub Check", icon: Github },
] as const;

export function ProductPreview({ data }: { data: PreviewData }) {
  const [active, setActive] = useState(0);
  const [compact, setCompact] = useState(false);
  const id = useId();
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 900px)");
    const update = () => setCompact(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return (
    <div className={styles.productWindow}>
      <div className={styles.productToolbar}>
        <div className={styles.windowDots} aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
        <span className={styles.productAddress}>
          <ShieldAlert size={12} aria-hidden="true" /> RollbackIQ / release preflight
        </span>
        <span className={styles.samplePill}>
          <span /> Sample data
        </span>
      </div>
      <div className={styles.productLayout}>
        <aside className={styles.productSidebar}>
          <div className={styles.sampleWorkspace}>
            <span>AC</span>
            <div>
              <strong>Acme Commerce</strong>
              <small>Sample workspace</small>
            </div>
            <ChevronRight size={13} aria-hidden="true" />
          </div>
          <span className={styles.sidebarLabel}>RELEASE PREFLIGHT</span>
          <div
            className={styles.previewTabs}
            role="tablist"
            aria-label="Sample report views"
            aria-orientation={compact ? "horizontal" : "vertical"}
          >
            {tabs.map(({ label, icon: Icon }, index) => (
              <button
                key={label}
                type="button"
                role="tab"
                id={`${id}-tab-${index}`}
                aria-selected={active === index}
                aria-controls={`${id}-panel-${index}`}
                tabIndex={active === index ? 0 : -1}
                ref={(element) => {
                  buttons.current[index] = element;
                }}
                onClick={() => setActive(index)}
                onKeyDown={(event) => {
                  const next =
                    event.key === "ArrowDown" || event.key === "ArrowRight"
                      ? (index + 1) % tabs.length
                      : event.key === "ArrowUp" || event.key === "ArrowLeft"
                        ? (index + tabs.length - 1) % tabs.length
                        : event.key === "Home"
                          ? 0
                          : event.key === "End"
                            ? tabs.length - 1
                            : null;
                  if (next === null) return;
                  event.preventDefault();
                  setActive(next);
                  buttons.current[next]?.focus();
                }}
              >
                <Icon size={15} aria-hidden="true" />
                {label}
              </button>
            ))}
          </div>
          <div className={styles.sidebarScope}>
            <Database size={16} aria-hidden="true" />
            <span>
              PostgreSQL<strong>Static analysis</strong>
            </span>
            <span className={styles.statusDot} />
          </div>
        </aside>
        <div className={styles.productMain}>
          <div className={styles.reportBreadcrumb}>
            acme / commerce <ChevronRight size={11} aria-hidden="true" />
            <span>Release comparison</span>
          </div>
          <div className={styles.reportHeading}>
            <div>
              <h3>
                {active === 0
                  ? "Previous-release compatibility"
                  : active === 1
                    ? "Migration findings"
                    : "Your policy. In the pull request."}
              </h3>
              <p>
                <GitBranch size={12} aria-hidden="true" /> {data.previous}{" "}
                <ArrowRight size={12} aria-hidden="true" /> {data.proposed}
              </p>
            </div>
            <Link
              href="/workspace/demo"
              className={styles.reportOpen}
              aria-label="Open the full sample report"
            >
              <ArrowUpRight size={17} aria-hidden="true" />
            </Link>
          </div>
          {tabs.map((tab, index) => (
            <div
              key={tab.label}
              role="tabpanel"
              id={`${id}-panel-${index}`}
              aria-labelledby={`${id}-tab-${index}`}
              hidden={active !== index}
              className={styles.previewPanel}
            >
              {index === 0 && (
                <>
                  <div className={styles.previewStats}>
                    <div>
                      <span>Compatibility verdict</span>
                      <strong className={styles.incompatible}>
                        <span />
                        {data.verdictLabel}
                      </strong>
                    </div>
                    <div>
                      <span>Critical findings</span>
                      <strong>
                        {data.criticalCount.toString().padStart(2, "0")}
                        <small>need attention</small>
                      </strong>
                    </div>
                    <div>
                      <span>Previous-release queries</span>
                      <strong>
                        {data.queryCount.toString().padStart(2, "0")}
                        <small>analyzed</small>
                      </strong>
                    </div>
                  </div>
                  {data.lead && (
                    <>
                      <div className={styles.leadFinding}>
                        <div>
                          <SeverityBadge severity={data.lead.severity} />
                          <code>{data.lead.rule}</code>
                          <span>{data.lead.confidence} confidence</span>
                        </div>
                        <h4>{data.lead.title}</h4>
                        <p>
                          <Database size={13} aria-hidden="true" />
                          <code>{data.lead.object}</code>
                        </p>
                      </div>
                      <div className={styles.codeComparison}>
                        <div>
                          <div className={styles.codeHeader}>
                            <FileCode2 size={13} aria-hidden="true" />
                            <span>Proposed migration</span>
                            <span>SQL</span>
                          </div>
                          <pre>
                            <code>
                              <span className={styles.codeMuted}>01</span>{" "}
                              <span className={styles.codeKeyword}>ALTER TABLE</span>{" "}
                              public.accounts
                              {"\n"}
                              <span className={styles.codeMuted}>02</span>{" "}
                              <span className={styles.codeRemoved}>DROP COLUMN legacy_tier;</span>
                            </code>
                          </pre>
                          <p>{data.lead.migration}</p>
                        </div>
                        <div>
                          <div className={styles.codeHeader}>
                            <GitBranch size={13} aria-hidden="true" />
                            <span>Previous-release query</span>
                            <span>v1</span>
                          </div>
                          <pre>
                            <code>
                              <span className={styles.codeMuted}>01</span>{" "}
                              <span className={styles.codeKeyword}>SELECT</span> id,{" "}
                              <span className={styles.codeRemoved}>legacy_tier</span>
                              {"\n"}
                              <span className={styles.codeMuted}>02</span>{" "}
                              <span className={styles.codeKeyword}>FROM</span> public.accounts;
                            </code>
                          </pre>
                          <p>{data.lead.source}</p>
                        </div>
                      </div>
                    </>
                  )}
                  <div className={styles.scopeNote}>
                    <TriangleAlert size={14} aria-hidden="true" />
                    <span>
                      {data.gapCount} coverage {data.gapCount === 1 ? "gap" : "gaps"}. Review the
                      limits alongside the findings.
                    </span>
                    <Link href="/workspace/demo">
                      Inspect evidence <ArrowRight size={13} aria-hidden="true" />
                    </Link>
                  </div>
                </>
              )}
              {index === 1 && (
                <>
                  <div className={styles.migrationSummary}>
                    <span>
                      <FileCode2 size={17} aria-hidden="true" /> {data.migrationCount} migration
                      files
                    </span>
                    <span>{data.migrationFindings.length} findings</span>
                  </div>
                  <div className={styles.migrationTable}>
                    <table>
                      <thead>
                        <tr>
                          <th>Finding</th>
                          <th>Severity</th>
                          <th>Rule</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.migrationFindings.map((finding) => (
                          <tr key={finding.id}>
                            <td>
                              <strong>{finding.title}</strong>
                              <code>{finding.object ?? "Review statement coverage"}</code>
                            </td>
                            <td>
                              <SeverityBadge severity={finding.severity} />
                            </td>
                            <td>
                              <code>{finding.ruleId}</code>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className={styles.scopeNote}>
                    <ScanLine size={14} aria-hidden="true" />
                    <span>Findings from the PostgreSQL parser and supported static rules.</span>
                  </div>
                </>
              )}
              {index === 2 && (
                <div className={styles.githubPreview}>
                  <div className={styles.mockPr}>
                    <GitPullRequest size={19} aria-hidden="true" />
                    <div>
                      <strong>Refactor account plans</strong>
                      <span>acme/commerce · Sample pull request</span>
                    </div>
                    <span className={styles.prBadge}>Open</span>
                  </div>
                  <div className={styles.checkOutput}>
                    <div className={styles.checkOutputTitle}>
                      <CircleX size={22} aria-hidden="true" />
                      <div>
                        <strong>RollbackIQ / Release preflight</strong>
                        <span>Sample Check output</span>
                      </div>
                      <Github size={23} aria-hidden="true" />
                    </div>
                    <div className={styles.checkOutputBody}>
                      <h4>Changes require review</h4>
                      <p>
                        The previous release still references objects changed by this migration
                        plan.
                      </p>
                      <dl>
                        <div>
                          <dt>Compatibility</dt>
                          <dd>{data.verdictLabel}</dd>
                        </div>
                        <div>
                          <dt>Compatibility findings</dt>
                          <dd>{data.findingCount}</dd>
                        </div>
                        <div>
                          <dt>Policy threshold</dt>
                          <dd>High and above</dd>
                        </div>
                      </dl>
                      <Link href="/workspace/demo">
                        View the evidence <ArrowUpRight size={14} aria-hidden="true" />
                      </Link>
                    </div>
                  </div>
                  <p className={styles.checkFootnote}>
                    <Check size={14} aria-hidden="true" /> A completed scan can fail a Check when
                    the configured policy requires review.
                  </p>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

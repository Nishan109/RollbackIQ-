"use client";

import type { Finding, MigrationFile, ScanReport, Severity } from "@rollbackiq/scanner-core";
import type { CompatibilityReport } from "@rollbackiq/scanner-core/compatibility/contracts";
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  ChevronRight,
  CircleHelp,
  Database,
  FileCode2,
  History,
  GitCompareArrows,
  Upload,
  UsersRound,
  LayoutDashboard,
  LoaderCircle,
  PanelLeftClose,
  PanelLeftOpen,
  ScanLine,
  Search,
  ShieldAlert,
  X,
} from "lucide-react";
import Link from "next/link";
import { type ChangeEvent, type FormEvent, useRef, useState } from "react";
import { Brand } from "@/components/brand";
import { CompatibilityBadge, CompatibilityPanel } from "@/components/compatibility-panel";
import { migrationSummary, parseCompatibilityReport } from "@/lib/compatibility-report";
import { CoverageBadge, SeverityBadge } from "@/components/report-ui";
import type { DemoSample } from "@/lib/demo";

const views = [
  { name: "Overview", icon: LayoutDashboard },
  { name: "Migrations", icon: FileCode2 },
  { name: "Compatibility", icon: GitCompareArrows },
  { name: "Risk findings", icon: ShieldAlert },
  { name: "Scan history", icon: History },
] as const;
type View = (typeof views)[number]["name"];
const severityOrder: Severity[] = ["critical", "high", "medium", "low", "info"];

type Run = {
  id: string;
  origin: "demo" | "sql" | "import";
  label: string;
  report: ScanReport;
  files: MigrationFile[];
  time: number | null;
  durationMs: number | null;
  compatibility?: CompatibilityReport;
};

type DemoData = { samples: DemoSample[]; report: ScanReport; compatibility: CompatibilityReport };

function downloadReport(report: ScanReport | CompatibilityReport) {
  const url = URL.createObjectURL(
    new Blob([`${JSON.stringify(report, null, 2)}\n`], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = "rollbackiq-report.json";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function SqlCode({ sql }: { sql: string }) {
  const keyword =
    /\b(?:alter|table|drop|column|add|rename|to|type|set|not|null|constraint|sequence|with|restart|index|on|concurrently|unique|text)\b/gi;
  let lineOffset = 0;
  return (
    <pre className="sql-code">
      <code>
        {sql
          .trimEnd()
          .split("\n")
          .map((line, index) => {
            const start = lineOffset;
            lineOffset += line.length + 1;
            const comment = line.trimStart().startsWith("--");
            const parts: React.ReactNode[] = [];
            let offset = 0;
            if (!comment) {
              for (const match of line.matchAll(keyword)) {
                parts.push(
                  line.slice(offset, match.index),
                  <span className="sql-keyword" key={match.index}>
                    {match[0]}
                  </span>,
                );
                offset = match.index + match[0].length;
              }
              parts.push(line.slice(offset));
            }
            return (
              <span className="code-line" key={start}>
                <span className="line-number" aria-hidden="true">
                  {index + 1}
                </span>
                <span className={comment ? "sql-comment" : undefined}>
                  {comment ? line : parts}
                </span>
              </span>
            );
          })}
      </code>
    </pre>
  );
}

function FindingTable({
  findings,
  onSelect,
}: {
  findings: Finding[];
  onSelect: (finding: Finding) => void;
}) {
  if (!findings.length)
    return (
      <div className="empty">
        <ShieldAlert size={25} />
        <strong>No matching findings</strong>
        <p>Findings appear when an implemented rule matches.</p>
      </div>
    );
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Finding</th>
            <th>Severity</th>
            <th>Database object</th>
            <th>Rule</th>
            <th aria-label="Details" />
          </tr>
        </thead>
        <tbody>
          {findings.map((finding) => (
            <tr key={finding.id}>
              <td>
                <button className="row-button" type="button" onClick={() => onSelect(finding)}>
                  {finding.title}
                </button>
                <span className="row-subtitle mono">
                  {finding.location.path.split("/").at(-1)}:{finding.location.line}
                </span>
              </td>
              <td>
                <SeverityBadge severity={finding.severity} />
              </td>
              <td>
                <code>{finding.object ?? "—"}</code>
              </td>
              <td>
                <code className="rule-code">{finding.ruleId}</code>
              </td>
              <td>
                <button
                  className="icon-button row-arrow"
                  type="button"
                  aria-label={`Open ${finding.title}`}
                  onClick={() => onSelect(finding)}
                >
                  <ChevronRight size={16} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Workspace({ demo }: { demo?: DemoData }) {
  const [view, setView] = useState<View>("Overview");
  const [collapsed, setCollapsed] = useState(false);
  const [runs, setRuns] = useState<Run[]>(() =>
    demo
      ? [
          {
            id: "demo",
            origin: "demo",
            label: "Acme Commerce fixtures",
            report: demo.report,
            files: demo.samples,
            time: null,
            durationMs: null,
            compatibility: demo.compatibility,
          },
        ]
      : [],
  );
  const [runId, setRunId] = useState(demo ? "demo" : "");
  const [selectedPath, setSelectedPath] = useState("");
  const [severity, setSeverity] = useState<Severity | "all">("all");
  const [search, setSearch] = useState("");
  const [finding, setFinding] = useState<Finding | null>(null);
  const [preset, setPreset] = useState(demo ? "all" : "custom");
  const [draftPath, setDraftPath] = useState("migration.sql");
  const [sql, setSql] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const [reportError, setReportError] = useState("");
  const importInput = useRef<HTMLInputElement>(null);
  const scanDialog = useRef<HTMLDialogElement>(null);
  const findingDialog = useRef<HTMLDialogElement>(null);
  const activeScan = useRef<AbortController | null>(null);

  const run = runs.find(({ id }) => id === runId) ?? runs[0];
  const report = run?.report;
  const selectedFile = report?.files.find(({ path }) => path === selectedPath) ?? report?.files[0];
  const fileSql = run?.files.find(({ path }) => path === selectedFile?.path)?.sql ?? "";
  const fileFindings =
    report?.findings.filter(({ location }) => location.path === selectedFile?.path) ?? [];
  const searchText = search.trim().toLowerCase();
  const filtered =
    report?.findings.filter(
      (item) =>
        (severity === "all" || item.severity === severity) &&
        `${item.title} ${item.ruleId} ${item.object ?? ""} ${item.location.path}`
          .toLowerCase()
          .includes(searchText),
    ) ?? [];
  const metrics = report
    ? [
        { label: "Scans this session", value: runs.length, icon: History, tone: "violet" },
        {
          label: "Migrations analyzed",
          value: report.summary.files,
          icon: FileCode2,
          tone: "blue",
        },
        {
          label: "High & critical findings",
          value: report.summary.bySeverity.high + report.summary.bySeverity.critical,
          icon: ShieldAlert,
          tone: "red",
        },
        {
          label: "Files needing review",
          value: report.summary.incompleteFiles,
          icon: CircleHelp,
          tone: "amber",
        },
      ]
    : [];

  function choosePreset(value: string) {
    setPreset(value);
    const sample = demo?.samples.find(({ path }) => path === value);
    setDraftPath(sample?.path ?? "migration.sql");
    setSql(sample?.sql ?? "");
    setError("");
  }

  function openScan() {
    setError("");
    scanDialog.current?.showModal();
  }

  function inspect(item: Finding) {
    setFinding(item);
    findingDialog.current?.showModal();
  }

  function openRun(item: Run) {
    setRunId(item.id);
    setSelectedPath("");
    setView("Overview");
  }

  async function importReport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setReportError("");
    try {
      if (file.size > 8 * 1024 * 1024) throw new Error("Reports must be smaller than 8 MiB.");
      const compatibility = parseCompatibilityReport(JSON.parse(await file.text()));
      const item: Run = {
        id: crypto.randomUUID(),
        label: `${compatibility.previous.ref} → ${compatibility.proposed.ref}`,
        compatibility,
        origin: "import",
        report: migrationSummary(compatibility),
        files: [],
        time: Date.now(),
        durationMs: null,
      };
      setRuns((previous) => [item, ...previous].slice(0, 20));
      openRun(item);
      setView("Compatibility");
      setAnnouncement("Compatibility report imported into this browser tab.");
    } catch (cause) {
      setReportError(cause instanceof Error ? cause.message : "The report could not be imported.");
    }
  }

  async function submitScan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (activeScan.current) return;
    const compareDemo = !!demo && preset === "compatibility";
    const files =
      demo && preset === "all"
        ? demo.samples.map(({ path, sql }) => ({ path, sql }))
        : [{ path: draftPath.trim(), sql }];
    const controller = new AbortController();
    activeScan.current = controller;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(compareDemo ? "/api/compatibility/demo" : "/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: compareDemo ? undefined : JSON.stringify({ files }),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
      });
      const data = (await response.json()) as {
        report?: unknown;
        durationMs?: number;
        error?: string;
      };
      if (!response.ok || !data.report)
        throw new Error(data.error ?? "The scan could not complete.");
      if (controller.signal.aborted) return;
      const compatibility = compareDemo ? parseCompatibilityReport(data.report) : undefined;
      const item: Run = {
        id: crypto.randomUUID(),
        origin: demo && preset !== "custom" ? "demo" : "sql",
        label: compareDemo
          ? "Demo release comparison"
          : demo && preset === "all"
            ? "Acme Commerce fixtures"
            : (draftPath.trim().split("/").at(-1) ?? "Custom migration"),
        report: compatibility ? migrationSummary(compatibility) : (data.report as ScanReport),
        compatibility,
        files: compareDemo && demo ? demo.samples : files,
        time: Date.now(),
        durationMs: data.durationMs ?? null,
      };
      setRuns((previous) => [item, ...previous].slice(0, 20));
      openRun(item);
      setAnnouncement(`Scan completed with ${item.report.findings.length} findings.`);
      scanDialog.current?.close();
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : "The scan could not complete.");
    } finally {
      activeScan.current = null;
      setBusy(false);
    }
  }

  function showMigration(path: string) {
    setSelectedPath(path);
    setView("Migrations");
    findingDialog.current?.close();
  }

  return (
    <div className={`workspace ${collapsed ? "sidebar-collapsed" : ""}`}>
      <aside className="sidebar">
        <div className="sidebar-brand">
          <Brand />
          <Link href="/team" className="button secondary compact mobile-team">
            Team workspace
          </Link>
          <button
            type="button"
            className="icon-button collapse-button"
            aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
            onClick={() => setCollapsed(!collapsed)}
          >
            {collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
          </button>
        </div>
        <div className="workspace-identity">
          <span className="workspace-avatar">{demo ? "AC" : <Database size={15} />}</span>
          <div>
            <strong>{demo ? "Acme Commerce" : "Local workspace"}</strong>
            <small>{demo ? "Demo workspace" : "Reports in this tab"}</small>
          </div>
        </div>
        <nav className="sidebar-nav" aria-label="Workspace navigation">
          <p>WORKSPACE</p>
          {views.map(({ name, icon: Icon }) => (
            <button
              type="button"
              key={name}
              onClick={() => setView(name)}
              className={name === view ? "active" : undefined}
              aria-current={name === view ? "page" : undefined}
              title={name}
            >
              <Icon size={18} />
              <span>{name}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <Link href="/team" className="sidebar-link" aria-label="Team workspace">
            <UsersRound size={17} />
            <span>Team workspace</span>
          </Link>
          <Link href="/" className="sidebar-link">
            <ArrowUpRight size={17} />
            <span>Product home</span>
          </Link>
          <span className="engine-status">
            <i />
            <span>PostgreSQL scanner</span>
          </span>
        </div>
      </aside>

      <div className="workspace-main">
        <header className="topbar">
          <div className="breadcrumbs">
            <span>Workspace</span>
            <ChevronRight size={15} />
            <strong>{view}</strong>
          </div>
          <div className="topbar-actions">
            <input
              hidden
              type="file"
              accept="application/json,.json"
              aria-label="Import compatibility report"
              ref={importInput}
              onChange={importReport}
            />
            <button
              className="button secondary compact"
              type="button"
              onClick={() => importInput.current?.click()}
            >
              <Upload size={15} /> Import report
            </button>
            <button className="button primary compact" type="button" onClick={openScan}>
              <ScanLine size={16} /> New scan
            </button>
          </div>
        </header>
        <main className="dashboard">
          <div className="screen-reader" role="status">
            {announcement}
          </div>
          {reportError && (
            <p className="form-error" role="alert">
              {reportError}
            </p>
          )}
          <div className="dashboard-heading">
            <div>
              <div className="workspace-context">
                <Database size={14} /> PostgreSQL <span />{" "}
                <span className="demo-dot">{demo ? "Demo workspace" : "Local workspace"}</span>
                <Link
                  className="workspace-mode-link"
                  href={demo ? "/workspace" : "/workspace/demo"}
                >
                  {demo ? "Open local workspace" : "View demo"}
                </Link>
              </div>
              <h1>{view === "Overview" ? (run ? "Release overview" : "Local workspace") : view}</h1>
              {run && (
                <p>
                  {view === "Overview"
                    ? "Inspect migration risks and plan your rollback review."
                    : view === "Migrations"
                      ? "Trace schema operations back to the migration source."
                      : view === "Risk findings"
                        ? "Review deterministic findings for the selected scan."
                        : view === "Compatibility"
                          ? "Review evidence from a Git release comparison."
                          : "Open reports from scans in this browser tab."}
                </p>
              )}
            </div>
            {run && report && view !== "Scan history" && (
              <button
                className="button secondary compact"
                type="button"
                onClick={() => downloadReport(run.compatibility ?? report)}
              >
                <ArrowDownToLine size={16} /> Export JSON
              </button>
            )}
          </div>

          {!run && (
            <section
              className="dashboard-card workspace-empty"
              aria-labelledby="workspace-empty-title"
            >
              <span className="metric-icon violet">
                <GitCompareArrows size={18} />
              </span>
              <h2 id="workspace-empty-title">No reports yet</h2>
              <p>
                Use <strong>New scan</strong> to analyze your PostgreSQL migration, or use{" "}
                <strong>Import report</strong> to open a compatibility report from your Git
                repository.
              </p>
              <p>
                Run <code>pnpm compatibility --help</code> from the RollbackIQ folder for Git
                comparison options.
              </p>
            </section>
          )}

          {view === "Overview" && run && report && (
            <>
              {run.compatibility && (
                <section className="dashboard-card release-status-card">
                  <div>
                    <h2>Previous-release compatibility</h2>
                    <p>
                      <code>{run.compatibility.previous.ref}</code> →{" "}
                      <code>{run.compatibility.proposed.ref}</code> ·{" "}
                      {run.compatibility.findings.length} compatibility findings
                      {run.time
                        ? ` · ${new Date(run.time).toLocaleString()}`
                        : " · Synthetic demo release snapshots"}
                    </p>
                  </div>
                  <CompatibilityBadge status={run.compatibility.status} />
                  <button
                    className="text-link"
                    type="button"
                    onClick={() => setView("Compatibility")}
                  >
                    Review evidence <ArrowRight size={15} />
                  </button>
                </section>
              )}
              <div className="metric-grid">
                {metrics.map(({ label, value, icon: Icon, tone }) => (
                  <article className="metric-card" key={label}>
                    <span className={`metric-icon ${tone}`}>
                      <Icon size={17} />
                    </span>
                    <strong>{value}</strong>
                    <p>{label}</p>
                  </article>
                ))}
              </div>
              <div className="analysis-grid">
                <section className="dashboard-card">
                  <div className="card-title">
                    <div>
                      <h2>Findings by severity</h2>
                      <p>
                        {report.findings.length} findings in {run.label}
                      </p>
                    </div>
                    <ShieldAlert size={18} />
                  </div>
                  <div className="severity-track" aria-hidden="true">
                    {severityOrder.map(
                      (level) =>
                        report.summary.bySeverity[level] > 0 && (
                          <span
                            className={`bar-${level}`}
                            key={level}
                            style={{ flexGrow: report.summary.bySeverity[level] }}
                          />
                        ),
                    )}
                  </div>
                  <div className="severity-legend">
                    {severityOrder.map((level) => (
                      <button
                        className="legend-item"
                        type="button"
                        key={level}
                        onClick={() => {
                          setSeverity(level);
                          setSearch("");
                          setView("Risk findings");
                        }}
                      >
                        <span className={`bar-${level}`} />
                        {level}
                        <strong>{report.summary.bySeverity[level]}</strong>
                      </button>
                    ))}
                  </div>
                </section>
                <section className="dashboard-card coverage-card">
                  <div className="card-title">
                    <div>
                      <h2>Analysis coverage</h2>
                      <p>PostgreSQL static analysis</p>
                    </div>
                    <ScanLine size={18} />
                  </div>
                  <div className="coverage-row">
                    <span>Statements parsed</span>
                    <strong>{report.summary.statements}</strong>
                  </div>
                  <div className="coverage-row">
                    <span>Files needing review</span>
                    <strong>{report.summary.incompleteFiles}</strong>
                  </div>
                  <div className="coverage-row">
                    <span>Application compatibility</span>
                    <CompatibilityBadge status={run.compatibility?.status ?? "unknown"} />
                  </div>
                </section>
              </div>
              <section className="dashboard-card table-card">
                <div className="card-title">
                  <div>
                    <h2>Migration findings</h2>
                    <p>
                      {run.origin === "demo"
                        ? "Generated from synthetic Acme Commerce migrations."
                        : run.label}
                    </p>
                  </div>
                  <button
                    className="text-link"
                    type="button"
                    onClick={() => {
                      setSeverity("all");
                      setSearch("");
                      setView("Risk findings");
                    }}
                  >
                    View findings <ArrowRight size={15} />
                  </button>
                </div>
                <FindingTable findings={report.findings.slice(0, 5)} onSelect={inspect} />
              </section>
            </>
          )}

          {view === "Migrations" && run && report && (
            <div className="migration-grid">
              <section className="dashboard-card file-list">
                <div className="card-title">
                  <div>
                    <h2>Migration files</h2>
                    <p>{report.files.length} in this scan</p>
                  </div>
                </div>
                {report.files.map((file) => (
                  <button
                    type="button"
                    className={file.path === selectedFile?.path ? "selected" : undefined}
                    key={file.path}
                    onClick={() => setSelectedPath(file.path)}
                  >
                    <FileCode2 size={17} />
                    <span>
                      <strong>{file.path.split("/").at(-1)}</strong>
                      <CoverageBadge coverage={file.coverage} />
                    </span>
                  </button>
                ))}
              </section>
              {selectedFile && (
                <div className="migration-detail">
                  <section className="dashboard-card">
                    <div className="card-title">
                      <div>
                        <h2 className="file-heading">{selectedFile.path.split("/").at(-1)}</h2>
                        <p>{selectedFile.path}</p>
                      </div>
                      <CoverageBadge coverage={selectedFile.coverage} />
                    </div>
                    {fileSql ? (
                      <SqlCode sql={fileSql} />
                    ) : (
                      <p className="compatibility-note">
                        Open this migration in the reported Git revision to inspect its SQL source.
                      </p>
                    )}
                  </section>
                  <section className="dashboard-card table-card">
                    <div className="card-title">
                      <div>
                        <h2>Affected objects</h2>
                        <p>{selectedFile.changes.length} operations recorded</p>
                      </div>
                    </div>
                    {selectedFile.changes.length ? (
                      <ul className="changes-list">
                        {selectedFile.changes.map((change) => (
                          <li key={change.id}>
                            <code>{change.detail}</code>
                            <span>Line {change.location.line}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="empty">No supported operations recorded.</p>
                    )}
                  </section>
                  <section className="dashboard-card table-card">
                    <div className="card-title">
                      <div>
                        <h2>Findings in this file</h2>
                      </div>
                    </div>
                    <FindingTable findings={fileFindings} onSelect={inspect} />
                  </section>
                  {run.compatibility && (
                    <CompatibilityPanel
                      report={run.compatibility}
                      migrationPath={selectedFile.path}
                      imported={run.origin === "import"}
                    />
                  )}
                </div>
              )}
            </div>
          )}

          {view === "Risk findings" && run && report && (
            <>
              <section className="dashboard-card table-card">
                <div className="card-title filter-bar">
                  <label className="search-field">
                    <Search size={17} />
                    <input
                      placeholder="Search findings…"
                      aria-label="Search findings"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                    />
                  </label>
                  <div className="select-field">
                    <label htmlFor="finding-severity">Severity</label>
                    <select
                      id="finding-severity"
                      value={severity}
                      onChange={(event) => setSeverity(event.target.value as Severity | "all")}
                    >
                      <option value="all">All severities</option>
                      {severityOrder.map((level) => (
                        <option key={level} value={level}>
                          {level}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <FindingTable findings={filtered} onSelect={inspect} />
              </section>
              {run.compatibility && (
                <CompatibilityPanel
                  report={run.compatibility}
                  imported={run.origin === "import"}
                  onOpenMigration={showMigration}
                />
              )}
            </>
          )}

          {view === "Compatibility" &&
            run &&
            (run.compatibility ? (
              <CompatibilityPanel
                report={run.compatibility}
                imported={run.origin === "import"}
                onOpenMigration={showMigration}
              />
            ) : (
              <section className="dashboard-card empty">
                <GitCompareArrows size={24} />
                <strong>Compare application releases</strong>
                <p>Run the compatibility CLI and import its JSON report.</p>
              </section>
            ))}

          {view === "Scan history" && run && (
            <section className="dashboard-card table-card">
              <div className="card-title">
                <div>
                  <h2>Session scans</h2>
                  <p>
                    Showing the last {runs.length} {runs.length === 1 ? "scan" : "scans"}. History
                    clears on refresh.
                  </p>
                </div>
              </div>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Scan</th>
                      <th>Trigger</th>
                      <th>Findings</th>
                      <th>Compatibility</th>
                      <th>Duration</th>
                      <th>Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {runs.map((item) => (
                      <tr key={item.id}>
                        <td>
                          <button
                            className="row-button"
                            type="button"
                            onClick={() => openRun(item)}
                          >
                            {item.label}
                          </button>
                        </td>
                        <td>
                          {item.origin === "import"
                            ? "Report import"
                            : item.id === "demo"
                              ? "Demo load"
                              : item.origin === "demo"
                                ? "Demo scan"
                                : "Manual"}
                        </td>
                        <td>{item.compatibility?.findings.length ?? item.report.findings.length}</td>
                        <td>
                          <CompatibilityBadge status={item.compatibility?.status ?? "unknown"} />
                        </td>
                        <td>{item.durationMs === null ? "—" : `${item.durationMs} ms`}</td>
                        <td>
                          {item.time ? new Date(item.time).toLocaleTimeString() : "Workspace load"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </main>
      </div>

      <dialog
        ref={scanDialog}
        className="modal"
        aria-labelledby="scan-title"
        onClose={() => activeScan.current?.abort()}
      >
        <div className="modal-heading">
          <div>
            <h2 id="scan-title">Run a migration scan</h2>
            <p>
              {demo
                ? "Analyze an example or paste a PostgreSQL migration."
                : "Paste your PostgreSQL migration for analysis."}
            </p>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="Close scan"
            onClick={() => scanDialog.current?.close()}
          >
            <X size={20} />
          </button>
        </div>
        <form onSubmit={submitScan} className="scan-form">
          {demo && (
            <label>
              <span id="scan-input-label">Scan input</span>
              <select
                aria-labelledby="scan-input-label"
                value={preset}
                onChange={(event) => choosePreset(event.target.value)}
                disabled={busy}
              >
                <option value="all">Acme Commerce · all demo migrations</option>
                <option value="compatibility">Compare demo releases · demo-v1 → demo-v2</option>
                {demo.samples.map((sample) => (
                  <option value={sample.path} key={sample.path}>
                    {sample.title}
                  </option>
                ))}
                <option value="custom">Paste my own SQL</option>
              </select>
            </label>
          )}
          {!demo || (preset !== "all" && preset !== "compatibility") ? (
            <>
              <label>
                Migration path
                <input
                  required
                  maxLength={512}
                  value={draftPath}
                  onChange={(event) => setDraftPath(event.target.value)}
                  disabled={busy}
                />
              </label>
              <label>
                PostgreSQL SQL
                <textarea
                  rows={8}
                  required
                  maxLength={32768}
                  spellCheck={false}
                  value={sql}
                  onChange={(event) => setSql(event.target.value)}
                  disabled={busy}
                  placeholder="ALTER TABLE public.accounts …"
                />
              </label>
            </>
          ) : (
            <div className="scan-note">
              <Database size={19} />
              <span>
                {preset === "compatibility"
                  ? "Compare static queries in two synthetic application releases against the five demo migrations."
                  : `${demo.samples.length} synthetic migrations are ready to analyze.`}
              </span>
            </div>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="modal-actions">
            <button
              className="button secondary"
              type="button"
              onClick={() => scanDialog.current?.close()}
            >
              Cancel
            </button>
            <button className="button primary" type="submit" disabled={busy}>
              {busy ? <LoaderCircle className="spinner" size={17} /> : <ScanLine size={17} />}
              {busy ? "Analyzing…" : "Run scan"}
            </button>
          </div>
        </form>
      </dialog>

      <dialog ref={findingDialog} className="modal" aria-labelledby="finding-title">
        <div className="modal-heading">
          <div>
            {finding && (
              <div className="finding-meta">
                <SeverityBadge severity={finding.severity} />
                <code>{finding.ruleId}</code>
                <span className="neutral-pill">{finding.confidence}</span>
              </div>
            )}
            <h2 id="finding-title">{finding?.title ?? "Finding details"}</h2>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="Close finding"
            onClick={() => findingDialog.current?.close()}
          >
            <X size={20} />
          </button>
        </div>
        {finding && (
          <div className="finding-body">
            <p>{finding.description}</p>
            <h3>AST evidence</h3>
            <code className="evidence">{finding.evidence}</code>
            <button
              className="text-link source-link"
              type="button"
              onClick={() => showMigration(finding.location.path)}
            >
              {finding.location.path}:{finding.location.line} <ArrowUpRight size={14} />
            </button>
            <h3>Recommended verification</h3>
            <p>{finding.mitigation}</p>
          </div>
        )}
      </dialog>
    </div>
  );
}

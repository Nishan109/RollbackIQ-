"use client";

import type {
  CompatibilityReport,
  CompatibilityStatus,
  EvidenceConfidence,
} from "@rollbackiq/scanner-core/compatibility/contracts";
import { ArrowRight, GitCompareArrows } from "lucide-react";
import { useState } from "react";
import { SeverityBadge } from "./report-ui";

type CompatibilityView = Pick<
  CompatibilityReport,
  "previous" | "proposed" | "status" | "coverage" | "findings"
> & {
  dependencies: { previous: { queries: number } };
  migrationReport?: { files: readonly { path: string }[] } | null;
};

export const compatibilityLabels: Record<CompatibilityStatus, string> = {
  incompatible: "Incompatible",
  potentially_incompatible: "Potentially incompatible",
  compatible_within_analyzed_scope: "Compatible within analyzed scope",
  unknown: "Unknown",
};

export function CompatibilityBadge({ status }: { status: CompatibilityStatus }) {
  return (
    <span className={`compatibility-badge compatibility-${status}`}>
      {compatibilityLabels[status]}
    </span>
  );
}

export function CompatibilityPanel({
  report,
  migrationPath,
  imported = false,
  github = false,
  saved = false,
  onOpenMigration,
}: {
  report: CompatibilityView;
  migrationPath?: string;
  imported?: boolean;
  github?: boolean;
  saved?: boolean;
  onOpenMigration?: (path: string) => void;
}) {
  const [confidence, setConfidence] = useState<EvidenceConfidence | "all">("all");
  const [query, setQuery] = useState("");
  const filtered = query.trim() !== "" || confidence !== "all";
  const coverageReasons = [...new Set(report.coverage.gaps.map(({ message }) => message))];
  const findings = report.findings.filter(
    (finding) =>
      (!migrationPath || finding.location?.path === migrationPath) &&
      (confidence === "all" || finding.confidence === confidence) &&
      `${finding.title} ${finding.object ?? ""} ${finding.ruleId}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  return (
    <section className="dashboard-card compatibility-panel">
      <div className="card-title">
        <div>
          <h2>
            {migrationPath ? "Previous-release dependencies" : "Previous-release compatibility"}
          </h2>
          <p>
            <code>{report.previous.ref}</code> → <code>{report.proposed.ref}</code>
            {github
              ? " · GitHub pull request scan"
              : saved
                ? " · Saved report"
                : imported
                  ? " · Imported report"
                  : " · Synthetic demo releases"}
          </p>
        </div>
        <GitCompareArrows size={18} />
      </div>
      {!migrationPath && (
        <div className="compatibility-overview">
          <CompatibilityBadge status={report.status} />
          <span>{report.findings.length} compatibility findings</span>
          <span>{report.coverage.gaps.length} coverage gaps</span>
          <span>{report.dependencies.previous.queries} previous-release queries</span>
        </div>
      )}
      {!migrationPath && report.status === "unknown" && (
        <div className="compatibility-note">
          <p>
            <strong>Why compatibility is unknown</strong>
          </p>
          <ul>
            {coverageReasons.slice(0, 4).map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
          {coverageReasons.length > 4 && (
            <p>See the findings below for the remaining coverage gaps.</p>
          )}
        </div>
      )}
      {!migrationPath && report.status === "potentially_incompatible" && (
        <p className="compatibility-note">
          Review the evidence and test the affected behavior with your deployed schema and
          application roles.
        </p>
      )}
      {imported && (
        <p className="compatibility-note">
          Verify the imported report’s source and commit references before relying on its
          conclusions.
        </p>
      )}
      <div className="compatibility-filters">
        <label>
          Database object or rule
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter compatibility evidence…"
          />
        </label>
        <label>
          Evidence confidence
          <select
            value={confidence}
            onChange={(event) => setConfidence(event.target.value as EvidenceConfidence | "all")}
          >
            <option value="all">All confidence levels</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </label>
      </div>
      {findings.map((finding) => (
        <details className="compatibility-finding" key={finding.id}>
          <summary>
            <SeverityBadge severity={finding.severity} />
            <span>{finding.title}</span>
            <code>{finding.ruleId}</code>
          </summary>
          <div className="compatibility-finding-body">
            <div className="finding-meta">
              <CompatibilityBadge status={finding.status} />
              <span className="neutral-pill">{finding.confidence} confidence</span>
            </div>
            {finding.object && <code className="evidence">{finding.object}</code>}
            {finding.location && (
              <p className="finding-location">
                <strong>Migration</strong>{" "}
                <code>
                  {finding.location.path}:{finding.location.line}:{finding.location.column}
                </code>
              </p>
            )}
            <p>{finding.message}</p>
            <h3>Previous-release evidence</h3>
            {finding.previousEvidence.length ? (
              <ul>
                {finding.previousEvidence.map((evidence) => (
                  <li key={JSON.stringify(evidence)}>
                    <code>
                      {evidence.location.path}:{evidence.location.line}:{evidence.location.column}
                    </code>
                    <span>
                      {evidence.kind} · {evidence.statement} · {evidence.confidence} confidence
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p>
                No previous-release query reference was resolved for this finding. Review its
                limitations and verify the affected database behavior.
              </p>
            )}
            {finding.proposedEvidence.length > 0 && (
              <p>
                {finding.proposedEvidence.length} related references also appear in the proposed
                release.
              </p>
            )}
            <h3>Recommended mitigation</h3>
            <p>{finding.recommendation}</p>
            {finding.limitations.map((limitation) => (
              <p key={limitation}>{limitation}</p>
            ))}
            {finding.location &&
              onOpenMigration &&
              report.migrationReport?.files.some(({ path }) => path === finding.location?.path) && (
                <button
                  type="button"
                  className="text-link"
                  onClick={() => {
                    if (finding.location) onOpenMigration(finding.location.path);
                  }}
                >
                  Open {finding.location.path}:{finding.location.line} <ArrowRight size={14} />
                </button>
              )}
          </div>
        </details>
      ))}
      {!findings.length && (
        <p className="compatibility-note" role="status">
          {filtered
            ? "No findings match these filters. Clear the search or choose another confidence level."
            : "No findings for this view within the analyzed scope. Review coverage and limitations before relying on the result."}
        </p>
      )}
      {!migrationPath && (
        <details className="compatibility-limits">
          <summary>Analysis scope and limitations</summary>
          <ul>
            {report.coverage.limitations.map((limitation) => (
              <li key={limitation}>{limitation}</li>
            ))}
          </ul>
          <p>
            Previous commit <code>{report.previous.commit ?? "Synthetic snapshot"}</code>
          </p>
          <p>
            Proposed commit <code>{report.proposed.commit ?? "Synthetic snapshot"}</code>
          </p>
        </details>
      )}
    </section>
  );
}

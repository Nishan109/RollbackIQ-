import type { Coverage, Severity } from "@rollbackiq/scanner-core";
import { CircleAlert, CircleCheck, TriangleAlert } from "lucide-react";

export function SeverityBadge({ severity }: { severity: Severity }) {
  return (
    <span className={`severity severity-${severity}`}>
      <i />
      {severity}
    </span>
  );
}

export function CoverageBadge({ coverage }: { coverage: Coverage }) {
  if (coverage === "covered") {
    return (
      <span className="coverage covered">
        <CircleCheck size={14} /> Analyzed
      </span>
    );
  }
  if (coverage === "parse-error") {
    return (
      <span className="coverage failed">
        <CircleAlert size={14} /> Parse error
      </span>
    );
  }
  return (
    <span className="coverage partial">
      <TriangleAlert size={14} /> Manual review
    </span>
  );
}

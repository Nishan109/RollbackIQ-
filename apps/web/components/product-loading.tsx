import { GitCompareArrows } from "lucide-react";
import { Brand } from "./brand";

function Skeleton({ className = "" }: { className?: string }) {
  return <span className={`loading-skeleton ${className}`} />;
}

export function ReportLoading() {
  return (
    <section className="report-loading" aria-busy="true" aria-label="Loading saved report">
      <div className="loading-caption" role="status">
        <span className="loading-orbit">
          <GitCompareArrows size={20} aria-hidden="true" />
        </span>
        <div>
          <strong>Opening your release report</strong>
          <p>Loading saved evidence and analysis coverage…</p>
        </div>
      </div>
      <div aria-hidden="true" className="loading-report-preview">
        <div className="loading-panel">
          <Skeleton className="skeleton-heading" />
          <Skeleton className="skeleton-wide" />
          <Skeleton className="skeleton-short" />
        </div>
        <div className="loading-metrics">
          {[1, 2, 3, 4].map((id) => (
            <div className="loading-panel" key={id}>
              <Skeleton className="skeleton-icon" />
              <Skeleton className="skeleton-number" />
              <Skeleton />
            </div>
          ))}
        </div>
        <div className="loading-panel">
          <Skeleton className="skeleton-heading" />
          {[1, 2, 3].map((id) => (
            <Skeleton className="skeleton-row" key={id} />
          ))}
        </div>
      </div>
    </section>
  );
}

export function ProductLoading({
  variant = "team",
}: {
  variant?: "auth" | "team" | "repository" | "dashboard";
}) {
  return (
    <main className={`product-loading loading-${variant}`} id="main-content" aria-busy="true">
      <header className="loading-header">
        <Brand />
        <span className="loading-caption" role="status">
          <span className="navigation-spinner" aria-hidden="true" /> Loading{" "}
          {variant === "auth"
            ? "your account"
            : variant === "repository"
              ? "repository"
              : "workspace"}
          …
        </span>
      </header>
      <div className="route-progress" aria-hidden="true" />
      <div className="loading-content" aria-hidden="true">
        <Skeleton className="skeleton-short" />
        <Skeleton className="skeleton-title" />
        <Skeleton className="skeleton-wide" />
        <div className="loading-metrics">
          {[1, 2, 3].map((id) => (
            <div className="loading-panel" key={id}>
              <Skeleton className="skeleton-icon" />
              <Skeleton className="skeleton-number" />
              <Skeleton />
            </div>
          ))}
        </div>
        <div className="loading-panel">
          <Skeleton className="skeleton-heading" />
          {[1, 2, 3].map((id) => (
            <Skeleton className="skeleton-row" key={id} />
          ))}
        </div>
        <div className="loading-columns">
          <div className="loading-panel">
            <Skeleton className="skeleton-heading" />
            <Skeleton className="skeleton-row" />
            <Skeleton className="skeleton-row" />
          </div>
          <div className="loading-panel">
            <Skeleton className="skeleton-heading" />
            <Skeleton className="skeleton-row" />
            <Skeleton className="skeleton-row" />
          </div>
        </div>
      </div>
    </main>
  );
}

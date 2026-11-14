"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useRef, useState } from "react";
import { parseCompatibilityReport } from "@/lib/compatibility-report";

export function UploadScan({ repositoryId }: { repositoryId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submitting = useRef(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const file = new FormData(event.currentTarget).get("report");
    if (!(file instanceof File) || !file.size) {
      setError("Choose a compatibility JSON report.");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setError("Stored reports must be smaller than 2 MiB.");
      return;
    }
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      let report: ReturnType<typeof parseCompatibilityReport>;
      try {
        report = parseCompatibilityReport(JSON.parse(await file.text()));
      } catch {
        setError(
          "This file isn’t a valid RollbackIQ compatibility JSON report. Choose a report from the CLI or a saved JSON export.",
        );
        return;
      }
      const response = await fetch("/api/scans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repositoryId, report }),
        signal: AbortSignal.timeout(15000),
      });
      if (response.status === 401) {
        setError("Your session has ended. Sign in again before importing the report.");
        return;
      }
      const data = (await response.json()) as { id?: string; error?: string };
      if (!response.ok || !data.id) {
        setError(
          response.status === 429
            ? "Too many imports are in progress. Wait a moment before trying again."
            : (data.error ?? "The report could not be stored."),
        );
        return;
      }
      router.push(`/team/repositories/${repositoryId}?scan=${data.id}`);
    } catch {
      setError("The report couldn’t be saved. Check your connection and try again.");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  return (
    <form className="scan-form inline-form" onSubmit={submit}>
      <label>
        Compatibility JSON report
        <input type="file" name="report" accept=".json,application/json" required disabled={busy} />
      </label>
      <button className="button primary compact" type="submit" disabled={busy}>
        {busy ? "Saving…" : "Save report"}
      </button>
      <span className="screen-reader" role="status">
        {busy ? "Saving report…" : ""}
      </span>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

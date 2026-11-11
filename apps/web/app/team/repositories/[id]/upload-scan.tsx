"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { parseCompatibilityReport } from "@/lib/compatibility-report";

export function UploadScan({ repositoryId }: { repositoryId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const file = new FormData(event.currentTarget).get("report");
    if (!(file instanceof File) || !file.size) {
      setError("Choose a compatibility JSON report.");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setError("Stored reports must be smaller than 2 MiB.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const report = parseCompatibilityReport(JSON.parse(await file.text()));
      const response = await fetch("/api/scans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repositoryId, report }),
        signal: AbortSignal.timeout(15000),
      });
      const data = (await response.json()) as { id?: string; error?: string };
      if (!response.ok || !data.id)
        throw new Error(data.error ?? "The report could not be stored.");
      router.push(`/team/repositories/${repositoryId}?scan=${data.id}`);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The report could not be stored.");
    } finally {
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
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

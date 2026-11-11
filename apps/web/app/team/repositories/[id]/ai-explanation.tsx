"use client";

import { useState } from "react";
import type { Explanation } from "@/lib/gemini";

export function AiExplanation({ scanId, enabled }: { scanId: string; enabled: boolean }) {
  const [busy, setBusy] = useState(false);
  const [explanation, setExplanation] = useState<Explanation | null>(null);
  const [error, setError] = useState("");
  async function request() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/scans/${scanId}/explain`, {
        method: "POST",
        signal: AbortSignal.timeout(15000),
      });
      const data = (await response.json()) as { explanation?: Explanation; error?: string };
      if (!response.ok || !data.explanation)
        throw new Error(data.error ?? "Gemini is unavailable.");
      setExplanation(data.explanation);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Gemini is unavailable.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="dashboard-card team-card">
      <h2>Gemini explanation</h2>
      {enabled ? (
        <>
          <p>Send rule categories and evidence counts for an explanation.</p>
          <button
            className="button secondary compact"
            type="button"
            disabled={busy}
            onClick={request}
          >
            {busy ? "Generating…" : "Explain this scan"}
          </button>
        </>
      ) : (
        <p>Gemini explanations are disabled.</p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {explanation && (
        <div className="ai-explanation">
          <span className="neutral-pill">Generated guidance</span>
          <p>{explanation.summary}</p>
          <p>{explanation.potentialImpact}</p>
          {[
            ["Recommendations", explanation.recommendations],
            ["Verification steps", explanation.verificationSteps],
            ["Limitations", explanation.limitations],
          ].map(([title, list]) => (
            <div key={String(title)}>
              <h3>{title}</h3>
              <ul>
                {(list as string[]).map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

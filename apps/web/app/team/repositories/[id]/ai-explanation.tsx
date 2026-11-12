"use client";

import { useState } from "react";
import type { Explanation } from "@/lib/gemini";

type ExplanationResult = {
  explanation: Explanation;
  finding?: { ruleId: string; object?: string; confidence: string };
};

export function AiExplanation({
  scanId,
  enabled,
  findings,
}: {
  scanId: string;
  enabled: boolean;
  findings: readonly { id: string; ruleId: string; title: string }[];
}) {
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState("");
  const [result, setResult] = useState<ExplanationResult | null>(null);
  const [error, setError] = useState("");
  async function request() {
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const params = selected ? `?${new URLSearchParams({ finding: selected }).toString()}` : "";
      const response = await fetch(`/api/scans/${scanId}/explain${params}`, {
        method: "POST",
        signal: AbortSignal.timeout(30000),
      });
      const data = (await response.json()) as Partial<ExplanationResult> & { error?: string };
      if (!response.ok || !data.explanation)
        throw new Error(data.error ?? "Gemini is unavailable.");
      setResult({ explanation: data.explanation, finding: data.finding });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Gemini is unavailable.");
    } finally {
      setBusy(false);
    }
  }
  const explanation = result?.explanation;
  return (
    <section className="dashboard-card team-card">
      <h2>Gemini explanation</h2>
      {enabled ? (
        <>
          {!!findings.length && (
            <label className="scan-form">
              Explain
              <select
                disabled={busy}
                value={selected}
                onChange={(event) => {
                  setSelected(event.target.value);
                  setResult(null);
                  setError("");
                }}
              >
                <option value="">Entire scan</option>
                {findings.map(({ id, ruleId, title }) => (
                  <option key={id} value={id}>
                    {ruleId} · {title}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button
            className="button secondary compact"
            type="button"
            disabled={busy}
            onClick={request}
          >
            {busy ? "Generating…" : "Generate AI explanation"}
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
          <h3>AI-generated explanation</h3>
          {result.finding && (
            <p>
              Evidence for {result.finding.ruleId} · {result.finding.confidence} confidence
              {result.finding.object && (
                <>
                  {" "}
                  · <code>{result.finding.object}</code>
                </>
              )}
            </p>
          )}
          <p>{explanation.summary}</p>
          <h4>What changed</h4>
          <p>{explanation.whatChanged}</p>
          <h4>Previous release</h4>
          <p>{explanation.previousReleaseImpact}</p>
          <h4>Potential application impact</h4>
          <p>{explanation.potentialImpact}</p>
          {[
            ["Investigation", explanation.investigation],
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

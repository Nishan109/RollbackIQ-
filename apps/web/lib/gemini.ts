import { setTimeout as delay } from "node:timers/promises";
import { GoogleGenAI } from "@google/genai";
import type { CompatibilityReport } from "@rollbackiq/scanner-core/compatibility/contracts";
import { z } from "zod";

const line = z.string().trim().min(1).max(1200);
const steps = z.array(line).min(1).max(6);
const explanationSchema = z.strictObject({
  summary: line,
  potentialImpact: line,
  recommendations: steps,
  verificationSteps: steps,
  limitations: steps,
});
export type Explanation = z.infer<typeof explanationSchema>;

const listJson = { type: "array", minItems: 1, maxItems: 6, items: { type: "string" } };
const jsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string" },
    potentialImpact: { type: "string" },
    recommendations: listJson,
    verificationSteps: listJson,
    limitations: listJson,
  },
  required: ["summary", "potentialImpact", "recommendations", "verificationSteps", "limitations"],
};

export function geminiSettings() {
  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL;
  return process.env.GEMINI_ENABLED === "true" &&
    apiKey &&
    model &&
    /^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,127}$/.test(model)
    ? { apiKey, model }
    : null;
}

export function minimizedEvidence(report: CompatibilityReport) {
  const gapCounts: Record<string, number> = {};
  for (const { kind } of report.coverage.gaps) gapCounts[kind] = (gapCounts[kind] ?? 0) + 1;
  return {
    status: report.status,
    postgresMajor: report.postgresMajor,
    findingCount: report.findings.length,
    gapCounts,
    findings: report.findings
      .slice(0, 30)
      .map(({ ruleId, severity, status, confidence, previousEvidence, proposedEvidence }) => ({
        ruleId,
        severity,
        status,
        confidence,
        previousReferences: previousEvidence.length,
        proposedReferences: proposedEvidence.length,
      })),
  };
}

type Evidence = ReturnType<typeof minimizedEvidence>;
type Usage = { inputTokens?: number; outputTokens?: number; totalTokens?: number };
type Generate = (
  evidence: Evidence,
  signal: AbortSignal,
) => Promise<{ text?: string; usage: Usage }>;

export function geminiProvider(settings: NonNullable<ReturnType<typeof geminiSettings>>): Generate {
  const ai = new GoogleGenAI({
    apiKey: settings.apiKey,
    httpOptions: { retryOptions: { attempts: 1 } },
  });
  return async (evidence, signal) => {
    const result = await ai.models.generateContent({
      model: settings.model,
      contents: [{ role: "user", parts: [{ text: JSON.stringify(evidence) }] }],
      config: {
        abortSignal: signal,
        automaticContinuation: false,
        automaticFunctionCalling: { disable: true },
        maxOutputTokens: 1400,
        responseMimeType: "application/json",
        responseJsonSchema: jsonSchema,
        systemInstruction: [
          "Explain deterministic PostgreSQL migration compatibility evidence for a developer. Use the report status verbatim as an input and preserve all uncertainty.",
          "COMPAT001 is column removal, COMPAT002 table removal, COMPAT003 column rename, COMPAT004 type changes, COMPAT005 NOT NULL, COMPAT006 constraint changes, COMPAT007 dynamic SQL, COMPAT008 unsupported DDL, and COMPAT009–010 missing or incomplete evidence.",
          "Recommend staged changes only when applicable and suggest tests against a migrated test database. Do not claim deployment safety or issue approval. Do not invent database names, source files, query references, credentials or exact SQL. Return plain-text JSON fields only.",
        ].join(" "),
      },
    });
    return {
      text: result.text,
      usage: {
        inputTokens: result.usageMetadata?.promptTokenCount,
        outputTokens: result.usageMetadata?.candidatesTokenCount,
        totalTokens: result.usageMetadata?.totalTokenCount,
      },
    };
  };
}

function retryable(error: unknown) {
  if (!(error instanceof Error)) return false;
  const status = "status" in error ? Number(error.status) : 0;
  return (
    status === 429 ||
    status >= 500 ||
    error.name === "TimeoutError" ||
    error.name === "AbortError" ||
    error instanceof TypeError
  );
}

export async function explainCompatibility(
  report: CompatibilityReport,
  generate: Generate,
  backoff: () => Promise<unknown> = () => delay(250),
) {
  const context = minimizedEvidence(report);
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await generate(context, AbortSignal.timeout(6000));
      if (!response.text || response.text.length > 16000)
        return {
          ok: false as const,
          reason: "invalid_output",
          attempts: attempt,
          usage: response.usage,
        };
      let parsed: unknown;
      try {
        parsed = JSON.parse(response.text);
      } catch {
        return {
          ok: false as const,
          reason: "invalid_output",
          attempts: attempt,
          usage: response.usage,
        };
      }
      const explanation = explanationSchema.safeParse(parsed);
      return explanation.success
        ? {
            ok: true as const,
            explanation: explanation.data,
            usage: response.usage,
            attempts: attempt,
          }
        : {
            ok: false as const,
            reason: "invalid_output",
            attempts: attempt,
            usage: response.usage,
          };
    } catch (error) {
      if (attempt === 2 || !retryable(error))
        return { ok: false as const, reason: "provider_unavailable", attempts: attempt, usage: {} };
      await backoff();
    }
  }
  return { ok: false as const, reason: "provider_unavailable", attempts: 2, usage: {} };
}

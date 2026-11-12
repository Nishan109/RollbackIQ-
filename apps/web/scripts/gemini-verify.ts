import { analyzeCompatibility } from "@rollbackiq/scanner-core/compatibility";
import {
  explainCompatibility,
  geminiProvider,
  geminiSettings,
  verifyGeminiModel,
} from "../lib/gemini";

async function main() {
  const settings = geminiSettings();
  if (
    !settings ||
    process.env.ROLLBACKIQ_GEMINI_STAGING !== "true" ||
    !process.argv.includes("--live")
  ) {
    console.error(
      JSON.stringify({
        event: "gemini_staging_blocked",
        reason: "staging_configuration_or_live_flag_required",
      }),
    );
    process.exitCode = 1;
    return;
  }
  if (!(await verifyGeminiModel(settings))) throw new Error("model_incompatible");
  const sources = [
    { path: "src/example.ts", text: 'db.query("SELECT id FROM public.other_table")' },
  ];
  const report = await analyzeCompatibility({
    previous: { release: { ref: "qa-old" }, sources },
    proposed: { release: { ref: "qa-new" }, sources },
    migrations: [
      {
        path: "migrations/001.sql",
        sql: "CREATE TABLE IF NOT EXISTS public.example (id integer); ALTER TABLE public.example ENABLE ROW LEVEL SECURITY;",
      },
    ],
  });
  const finding = report.findings.find(
    ({ ruleId, confidence, object }) =>
      ruleId === "COMPAT010" && confidence === "low" && object === "public.example",
  );
  if (!finding) throw new Error("row_security_fixture_missing");
  const result = await explainCompatibility(
    report,
    geminiProvider(settings),
    undefined,
    finding,
    1,
  );
  console.info(
    JSON.stringify({ event: "gemini_staging_verified", ok: result.ok, attempts: result.attempts }),
  );
  if (!result.ok) process.exitCode = 1;
}

void main().catch(() => {
  console.error(
    JSON.stringify({ event: "gemini_staging_failed", reason: "model_or_provider_unavailable" }),
  );
  process.exitCode = 1;
});

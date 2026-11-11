import { apiJson, sameOrigin } from "@/lib/bounded-json";
import { compatibilityReportSchema } from "@/lib/compatibility-report";
import { explainCompatibility, geminiProvider, geminiSettings } from "@/lib/gemini";
import { requestLimit } from "@/lib/rate-limit";
import { appOrigin, supabaseSettings } from "@/lib/supabase/config";
import { idSchema } from "@/lib/supabase/scans";
import { supabaseIdentity } from "@/lib/supabase/server";

const admit = requestLimit({ perIdentity: 3, total: 20, concurrent: 3 });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!supabaseSettings()) return apiJson({ error: "Supabase is unconfigured." }, 503);
  if (!sameOrigin(request, appOrigin()))
    return apiJson({ error: "The request origin is invalid." }, 403);
  const identity = await supabaseIdentity();
  if (!identity) return apiJson({ error: "Sign in to request an explanation." }, 401);
  const id = idSchema.safeParse((await context.params).id);
  if (!id.success) return apiJson({ error: "Invalid scan ID." }, 400);
  const settings = geminiSettings();
  if (!settings) return apiJson({ error: "Gemini explanations are disabled." }, 409);
  const release = admit(identity.user.id);
  if (!release)
    return apiJson({ error: "Gemini explanations are temporarily rate limited." }, 429, {
      "Retry-After": "60",
    });
  try {
    const { data, error } = await identity.client
      .from("scans")
      .select("report")
      .eq("id", id.data)
      .maybeSingle();
    if (error) return apiJson({ error: "Scan storage is temporarily unavailable." }, 503);
    if (!data) return apiJson({ error: "Scan unavailable." }, 404);
    const report = compatibilityReportSchema.safeParse(data.report);
    if (!report.success)
      return apiJson(
        { error: "The stored report does not match the explanation input contract." },
        422,
      );
    const result = await explainCompatibility(report.data, geminiProvider(settings));
    console.info(
      JSON.stringify({
        event: "gemini_explanation",
        outcome: result.ok ? "complete" : result.reason,
        attempts: result.attempts,
        usage: result.usage,
      }),
    );
    return result.ok
      ? apiJson({ explanation: result.explanation, usage: result.usage })
      : apiJson(
          {
            error:
              "Gemini could not provide an explanation. The deterministic report is available above.",
          },
          503,
        );
  } finally {
    release();
  }
}

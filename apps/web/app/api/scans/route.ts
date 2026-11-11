import { z } from "zod";
import { apiJson, readJsonBody, sameOrigin } from "@/lib/bounded-json";
import { compatibilityReportSchema } from "@/lib/compatibility-report";
import { requestLimit } from "@/lib/rate-limit";
import { appOrigin, supabaseSettings } from "@/lib/supabase/config";
import { idSchema, repositoryFor, saveReport, scanCursor, scanPage } from "@/lib/supabase/scans";
import { supabaseIdentity } from "@/lib/supabase/server";

const input = z.object({ repositoryId: idSchema, report: compatibilityReportSchema });
const MAX_BODY = 2 * 1024 * 1024;
const admit = requestLimit({ perIdentity: 10, total: 50, concurrent: 6 });

export async function GET(request: Request) {
  if (!supabaseSettings()) return apiJson({ error: "Supabase is unconfigured." }, 503);
  const identity = await supabaseIdentity();
  if (!identity) return apiJson({ error: "Sign in to list repository scans." }, 401);
  const params = new URL(request.url).searchParams;
  const id = idSchema.safeParse(params.get("repositoryId"));
  const cursor = scanCursor(params.get("cursor"));
  if (!id.success || (params.has("cursor") && !cursor))
    return apiJson({ error: "Provide a repository ID and a valid pagination cursor." }, 400);
  const repository = await repositoryFor(identity.client, id.data);
  if (!repository) return apiJson({ error: "Repository unavailable." }, 404);
  const page = await scanPage(identity.client, repository, cursor);
  return page ? apiJson(page) : apiJson({ error: "Scan history is temporarily unavailable." }, 503);
}

export async function POST(request: Request) {
  if (!supabaseSettings()) return apiJson({ error: "Supabase is unconfigured." }, 503);
  if (!sameOrigin(request, appOrigin()))
    return apiJson({ error: "The request origin is invalid." }, 403);
  const identity = await supabaseIdentity();
  if (!identity) return apiJson({ error: "Sign in to save scans." }, 401);
  const release = admit(identity.user.id);
  if (!release)
    return apiJson({ error: "Scan imports are temporarily rate limited." }, 429, {
      "Retry-After": "60",
    });
  try {
    const body = await readJsonBody(request, MAX_BODY);
    if (body instanceof Response) return body;
    const data = input.safeParse(body);
    if (!data.success || !data.data.report.previous.commit || !data.data.report.proposed.commit)
      return apiJson(
        { error: "Provide a valid compatibility report with both Git commit IDs." },
        400,
      );
    const result = await saveReport(identity.client, data.data.repositoryId, data.data.report);
    if (!result.error && result.data) return apiJson({ id: result.data }, 200);
    if (result.error?.code === "42501")
      return apiJson({ error: "Repository write access is required." }, 403);
    if (result.error?.code === "23505")
      return apiJson({ error: "The report conflicts with an existing scan." }, 409);
    if (result.error?.code?.startsWith("22") || result.error?.code === "23514")
      return apiJson(
        { error: "The report exceeds storage limits or violates report constraints." },
        400,
      );
    console.error(
      JSON.stringify({ event: "scan_persistence_failed", code: result.error?.code ?? "unknown" }),
    );
    return apiJson({ error: "Scan storage is temporarily unavailable." }, 503);
  } finally {
    release();
  }
}

import { apiJson } from "@/lib/bounded-json";
import { supabaseSettings } from "@/lib/supabase/config";
import { idSchema } from "@/lib/supabase/scans";
import { supabaseIdentity } from "@/lib/supabase/server";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  if (!supabaseSettings()) return apiJson({ error: "Supabase is unconfigured." }, 503);
  const identity = await supabaseIdentity();
  if (!identity) return apiJson({ error: "Sign in to open reports." }, 401);
  const id = idSchema.safeParse((await context.params).id);
  if (!id.success) return apiJson({ error: "Invalid scan ID." }, 400);
  const { data, error } = await identity.client
    .from("scans")
    .select("id,repository_id,created_at,status,report")
    .eq("id", id.data)
    .maybeSingle();
  if (error) return apiJson({ error: "Scan storage is temporarily unavailable." }, 503);
  return data ? apiJson(data) : apiJson({ error: "Scan unavailable." }, 404);
}

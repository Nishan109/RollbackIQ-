import { NextResponse } from "next/server";
import { appOrigin } from "@/lib/supabase/config";
import { supabaseServer } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const client = await supabaseServer();
  const token_hash = params.get("token_hash");
  const type = params.get("type");
  const code = params.get("code");
  const recovery = type === "recovery" || params.get("flow") === "recovery";
  const redirect = (path: string) =>
    NextResponse.redirect(new URL(path, appOrigin()), {
      headers: { "Cache-Control": "private, no-store" },
    });
  if (
    client &&
    token_hash &&
    token_hash.length <= 512 &&
    (type === "email" || type === "recovery")
  ) {
    const { error } = await client.auth.verifyOtp({ token_hash, type });
    if (!error) return redirect(recovery ? "/auth?mode=reset" : "/team");
  } else if (client && code && code.length <= 512) {
    const { error } = await client.auth.exchangeCodeForSession(code);
    if (!error) return redirect(recovery ? "/auth?mode=reset" : "/team");
  }
  return redirect("/auth?notice=link");
}

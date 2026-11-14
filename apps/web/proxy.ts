import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import { appOrigin, supabaseSettings } from "@/lib/supabase/config";

export async function proxy(request: NextRequest) {
  const settings = supabaseSettings();
  let response = NextResponse.next({ request });
  if (!settings) return response;
  const supabase = createServerClient(settings.url, settings.key, {
    cookieOptions: { httpOnly: true, sameSite: "lax", secure: appOrigin().startsWith("https:") },
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet)
          response.cookies.set(name, value, options);
        for (const [key, value] of Object.entries(headers ?? {})) response.headers.set(key, value);
      },
    },
  });
  await supabase.auth.getClaims();
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const config = {
  matcher: [
    "/workspace",
    "/team/:path*",
    "/auth",
    "/api/scans/:path*",
    "/api/github/((?!webhook).*)",
  ],
};

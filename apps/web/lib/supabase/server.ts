import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { appOrigin, supabaseSettings } from "./config";
import type { Database } from "./database";

export async function supabaseServer() {
  const settings = supabaseSettings();
  if (!settings) return null;
  const jar = await cookies();
  return createServerClient<Database>(settings.url, settings.key, {
    cookieOptions: { httpOnly: true, sameSite: "lax", secure: appOrigin().startsWith("https:") },
    cookies: {
      getAll: () => jar.getAll(),
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) jar.set(name, value, options);
        } catch {
          /* Read-only Server Components rely on the request proxy for cookie refresh. */
        }
      },
    },
  });
}

export async function supabaseIdentity() {
  const client = await supabaseServer();
  if (!client) return null;
  const { data, error } = await client.auth.getUser();
  return !error && data.user && !data.user.is_anonymous ? { client, user: data.user } : null;
}

export async function requireIdentity() {
  const identity = await supabaseIdentity();
  if (!identity) redirect("/auth");
  return identity;
}

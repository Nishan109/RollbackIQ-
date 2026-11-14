"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { appOrigin } from "@/lib/supabase/config";
import { requireIdentity, supabaseServer } from "@/lib/supabase/server";

const emailSchema = z.string().trim().max(254).pipe(z.email());
const passwordSchema = z.string().min(8).max(256);

export async function submitCredentials(form: FormData) {
  const mode = form.get("mode") === "signup" ? "signup" : "login";
  const email = emailSchema.safeParse(form.get("email"));
  const password = passwordSchema.safeParse(form.get("password"));
  if (!email.success || !password.success) redirect(`/auth?mode=${mode}&notice=invalid`);
  const client = await supabaseServer();
  if (!client) redirect("/auth?notice=unconfigured");
  if (mode === "login") {
    const { error } = await client.auth.signInWithPassword({
      email: email.data,
      password: password.data,
    });
    if (error) {
      const notice =
        error.status === 429
          ? "slow-down"
          : error.code === "email_not_confirmed"
            ? "verify"
            : error.code === "invalid_credentials"
              ? "credentials"
              : "unavailable";
      redirect(`/auth?notice=${notice}`);
    }
    redirect("/team");
  }
  const { data, error } = await client.auth.signUp({
    email: email.data,
    password: password.data,
    options: { emailRedirectTo: `${appOrigin()}/auth/callback` },
  });
  if (error)
    redirect(`/auth?mode=signup&notice=${error.status === 429 ? "slow-down" : "unavailable"}`);
  redirect(data.session ? "/team" : "/auth?notice=verify");
}

export async function requestReset(form: FormData) {
  const email = emailSchema.safeParse(form.get("email"));
  if (!email.success) redirect("/auth?mode=forgot&notice=invalid");
  const client = await supabaseServer();
  if (!client) redirect("/auth?notice=unconfigured");
  const { error } = await client.auth.resetPasswordForEmail(email.data, {
    redirectTo: `${appOrigin()}/auth/callback?flow=recovery`,
  });
  if (error?.status === 0 || (error?.status && error.status >= 500))
    redirect("/auth?mode=forgot&notice=unavailable");
  redirect("/auth?notice=reset-sent");
}

export async function resetPassword(form: FormData) {
  const password = passwordSchema.safeParse(form.get("password"));
  if (!password.success || password.data !== form.get("confirmation"))
    redirect("/auth?mode=reset&notice=invalid");
  const { client } = await requireIdentity();
  const { error } = await client.auth.updateUser({ password: password.data });
  if (error) redirect("/auth?mode=reset&notice=unavailable");
  redirect("/team");
}

export async function signOut() {
  const client = await supabaseServer();
  if (client) await client.auth.signOut({ scope: "local" });
  redirect("/auth");
}

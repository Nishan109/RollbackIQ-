import Link from "next/link";
import { redirect } from "next/navigation";
import { Brand } from "@/components/brand";
import { supabaseSettings } from "@/lib/supabase/config";
import { supabaseIdentity } from "@/lib/supabase/server";
import { requestReset, resetPassword, submitCredentials } from "./actions";

const notices: Record<string, string> = {
  invalid: "Check the email and password fields. Passwords must have at least eight characters.",
  credentials: "Sign-in failed. Verify your email and password and try again.",
  unavailable: "The request could not complete. Try again shortly.",
  verify: "Check your email to verify your account.",
  "reset-sent": "If this email can receive a recovery link, check your inbox.",
  link: "The link could not be verified. Request a new sign-in or recovery link.",
};

export default async function AuthPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string; notice?: string }>;
}) {
  const params = await searchParams;
  const mode = ["signup", "forgot", "reset"].includes(params.mode ?? "") ? params.mode : "login";
  const title =
    mode === "signup"
      ? "Create an account"
      : mode === "forgot"
        ? "Request a password reset"
        : mode === "reset"
          ? "Choose a new password"
          : "Sign in";
  const configured = supabaseSettings();
  if (configured && mode === "reset" && !(await supabaseIdentity())) redirect("/auth?notice=link");
  const notice =
    params.notice && Object.hasOwn(notices, params.notice) ? notices[params.notice] : null;
  return (
    <main className="container auth-layout">
      <Brand />
      <section className="dashboard-card auth-card">
        <h1>{title}</h1>
        {!configured ? (
          <>
            <p>Team authentication is available after Supabase is configured.</p>
            <Link className="button secondary" href="/workspace">
              Open local workspace
            </Link>
          </>
        ) : (
          <>
            {notice && (
              <p className="auth-notice" role="status">
                {notice}
              </p>
            )}
            <form
              className="scan-form"
              action={
                mode === "forgot"
                  ? requestReset
                  : mode === "reset"
                    ? resetPassword
                    : submitCredentials
              }
            >
              <input type="hidden" name="mode" value={mode} />
              {mode !== "reset" && (
                <label>
                  Email
                  <input name="email" type="email" autoComplete="email" required maxLength={254} />
                </label>
              )}
              {mode !== "forgot" && (
                <label>
                  Password
                  <input
                    name="password"
                    type="password"
                    autoComplete={mode === "login" ? "current-password" : "new-password"}
                    required
                    minLength={8}
                    maxLength={256}
                  />
                </label>
              )}
              {mode === "reset" && (
                <label>
                  Confirm password
                  <input
                    name="confirmation"
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={8}
                    maxLength={256}
                  />
                </label>
              )}
              <button className="button primary" type="submit">
                {mode === "forgot"
                  ? "Send reset link"
                  : mode === "reset"
                    ? "Update password"
                    : title}
              </button>
            </form>
            <div className="auth-links">
              <Link href="/auth">Sign in</Link>
              <Link href="/auth?mode=signup">Create account</Link>
              <Link href="/auth?mode=forgot">Forgot password</Link>
            </div>
          </>
        )}
      </section>
    </main>
  );
}

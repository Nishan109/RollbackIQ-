import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Brand } from "@/components/brand";
import { SubmitButton } from "@/components/submit-button";
import { supabaseSettings } from "@/lib/supabase/config";
import { supabaseIdentity } from "@/lib/supabase/server";
import { requestReset, resetPassword, submitCredentials } from "./actions";

export const metadata: Metadata = {
  title: "Account",
  robots: { index: false, follow: false },
};

const notices: Record<string, string> = {
  invalid: "Check the email and password fields. Passwords must have at least eight characters.",
  credentials: "Sign-in failed. Verify your email and password and try again.",
  "preview-account-exists":
    "That test email is already in use. Sign in or choose a different test email.",
  unavailable: "The request could not complete. Check your connection and try again shortly.",
  "slow-down": "Too many requests. Wait a moment before trying again.",
  verify:
    "Check your inbox for the verification email. Open the link, then return here to sign in.",
  "reset-sent": "If this email can receive a recovery link, check your inbox.",
  link: "This link is invalid or expired. Sign in again, or request a new password reset link.",
  unconfigured: "Team sign-in is temporarily unavailable.",
};

export default async function AuthPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string; notice?: string }>;
}) {
  const params = await searchParams;
  const mode =
    params.mode === "signup" || params.mode === "forgot" || params.mode === "reset"
      ? params.mode
      : "login";
  const title =
    mode === "signup"
      ? "Create an account"
      : mode === "forgot"
        ? "Request a password reset"
        : mode === "reset"
          ? "Choose a new password"
          : "Sign in";
  const configured = supabaseSettings();
  const localPreview = process.env.ROLLBACKIQ_LOCAL_PREVIEW === "1";
  if (configured && mode === "reset" && !(await supabaseIdentity())) redirect("/auth?notice=link");
  const notice =
    params.notice && Object.hasOwn(notices, params.notice) ? notices[params.notice] : null;
  const informational = params.notice === "verify" || params.notice === "reset-sent";
  return (
    <main className="container auth-layout" id="main-content">
      <header className="team-header">
        <Brand />
        <Link className="text-link" href="/help">
          Help
        </Link>
      </header>
      <section className="dashboard-card auth-card">
        <h1>{title}</h1>
        {localPreview && (mode === "signup" || mode === "login") && (
          <p className="auth-notice">
            Local preview. Use a test email and password. New accounts last until the preview
            restarts, and no verification email is sent.
          </p>
        )}
        {configured && (
          <p>
            {
              {
                login: "Open your team workspace and saved scan reports.",
                signup: "Create your RollbackIQ account, then set up your team’s first repository.",
                forgot: "Enter your account email to request a password reset link.",
                reset: "Enter and confirm a new password for your account.",
              }[mode]
            }
          </p>
        )}
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
              <p
                className={informational ? "auth-notice" : "form-error"}
                role={informational ? "status" : "alert"}
              >
                {params.notice === "invalid" && mode === "forgot"
                  ? "Enter a valid email address."
                  : params.notice === "invalid" && mode === "reset"
                    ? "Use matching passwords with at least eight characters."
                    : notice}
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
              {mode === "signup" && (
                <p>
                  Use at least eight characters.
                  {!localPreview &&
                    " If email verification is required, check your inbox before signing in."}
                </p>
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
              <SubmitButton
                className="button primary"
                pendingLabel={mode === "login" ? "Signing in…" : "Submitting…"}
              >
                {mode === "forgot"
                  ? "Send reset link"
                  : mode === "reset"
                    ? "Update password"
                    : title}
              </SubmitButton>
            </form>
            <div className="auth-links">
              {mode !== "login" && <Link href="/auth">Sign in</Link>}
              {mode !== "signup" && <Link href="/auth?mode=signup">Create account</Link>}
              {mode !== "forgot" && <Link href="/auth?mode=forgot">Forgot password</Link>}
            </div>
          </>
        )}
      </section>
    </main>
  );
}

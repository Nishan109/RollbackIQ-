import { ArrowRight, Braces, Check, GitCompareArrows, GitPullRequest } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PasswordField } from "@/components/password-field";
import { ProductHeader } from "@/components/product-header";
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
      <ProductHeader active="auth" />
      <div className="auth-grid">
        <section className="dashboard-card auth-card">
          <span className="product-eyebrow">YOUR RELEASE WORKSPACE</span>
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
                  signup:
                    "Create your RollbackIQ account, then set up your team’s first repository.",
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
                    <input
                      name="email"
                      type="email"
                      autoComplete="email"
                      placeholder="you@company.com"
                      required
                      maxLength={254}
                    />
                  </label>
                )}
                {mode !== "forgot" && (
                  <PasswordField
                    key={mode}
                    autoComplete={mode === "login" ? "current-password" : "new-password"}
                    placeholder={mode === "login" ? "Enter your password" : "At least 8 characters"}
                  />
                )}
                {mode === "signup" && (
                  <p>
                    Use at least eight characters.
                    {!localPreview &&
                      " If email verification is required, check your inbox before signing in."}
                  </p>
                )}
                {mode === "reset" && (
                  <PasswordField
                    label="Confirm password"
                    name="confirmation"
                    autoComplete="new-password"
                    placeholder="Repeat your new password"
                  />
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
              <p className="auth-form-footer">
                Your repositories. Your evidence. A clearer release decision.
              </p>
            </>
          )}
        </section>
        <aside className="auth-story" aria-label="About RollbackIQ">
          <span className="product-eyebrow">
            <span className="accent-dot" /> RELEASE WITH CONTEXT
          </span>
          <h2>
            Ship forward.
            <br />
            <span>Think backward.</span>
          </h2>
          <p>Your next database change deserves a clear view of what came before.</p>
          <div className="auth-illustration">
            <div className="illustration-heading">
              <GitCompareArrows size={16} /> Previous release → proposed change <span>Example</span>
            </div>
            <div className="auth-code">
              <span>migration.sql</span>
              <code>
                <b>ALTER TABLE</b> accounts
                <br />
                <b>DROP COLUMN</b> legacy_tier;
              </code>
            </div>
            <div className="auth-evidence">
              <span className="evidence-mark">!</span>
              <div>
                <strong>A change worth reviewing</strong>
                <p>Does the previous release still use this column?</p>
              </div>
            </div>
            <div className="illustration-footer">
              <Check size={14} /> Evidence before you merge
            </div>
          </div>
          <ul className="auth-benefits">
            <li>
              <GitPullRequest size={17} />
              <span>Bring migration review into your pull request.</span>
            </li>
            <li>
              <Braces size={17} />
              <span>Keep findings, source references, and saved reports together.</span>
            </li>
          </ul>
          <Link className="text-link" href="/workspace/demo">
            Take a look inside <ArrowRight size={15} />
          </Link>
        </aside>
      </div>
      <footer className="auth-page-footer">
        <span>PostgreSQL migration intelligence</span>
        <Link href="/help#understanding-scans">
          Understand analysis coverage <ArrowRight size={13} />
        </Link>
      </footer>
    </main>
  );
}

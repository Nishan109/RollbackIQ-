# GitHub App connection

RollbackIQ can connect a GitHub App installation to a RollbackIQ organization, link selected repositories, and scan pull requests in a separate worker. The manual CLI, GitHub Action, local workspace and report import remain available.

## What you need

- Node 22.13 or later and pnpm 11.25.0.
- A Supabase project with password authentication configured. Follow [team workspace setup](team-workspace.md).
- Permission to register a GitHub App and install it on a test repository.
- An application URL reachable by GitHub for webhook delivery. Use HTTPS for hosted deployments. Local callbacks may use `http://localhost:3000`; local webhook delivery needs a development tunnel or equivalent forwarding. No tunnel is started by this application.
- A continuously running worker process with outbound HTTPS access to GitHub and Supabase. No candidate code, build scripts or migration SQL is executed.

## 1. Apply database migrations

Apply these files through your normal Supabase migration process, in order:

1. `supabase/migrations/20261111105615_rollbackiq_tenants.sql`
2. `supabase/migrations/20261111105623_github_app.sql`
3. `supabase/migrations/20261111110013_private_storage_hardening.sql`

For a linked Supabase CLI project, review the target project and then run `supabase db push`. For a local Supabase stack with a container runtime, use the normal local migration workflow. Do not reset an existing database to install the migration.

The GitHub migration adds connection metadata, repository settings, durable jobs, expiring authorization states, temporary selections and webhook delivery IDs. The hardening migration enables deny-by-default RLS for private storage and adds covering foreign-key indexes. Existing repositories and reports remain in place. Only the server's service-role client can invoke the GitHub RPC. User operations additionally check the user's current owner/admin membership inside PostgreSQL. Public connection/job reads use organization RLS. The service-role key is privileged: keep it on trusted app and worker hosts.

## 2. Register the GitHub App

Open GitHub **Settings → Developer settings → GitHub Apps → New GitHub App**.

For a deployment at `https://rollbackiq.example`, enter:

| Setting | Value |
| --- | --- |
| Homepage URL | `https://rollbackiq.example` |
| User authorization callback URL | `https://rollbackiq.example/api/github/callback` |
| Request user authorization during installation | **Off**; RollbackIQ starts a separate PKCE authorization after setup |
| Setup URL | `https://rollbackiq.example/api/github/setup` |
| Redirect on update | Optional; opening directly from GitHub settings without an active RollbackIQ authorization requires reconnecting from RollbackIQ |
| Webhook URL | `https://rollbackiq.example/api/github/webhook` |
| Webhooks active | On |
| Webhook secret | A securely generated, high-entropy secret; configure the same value on the server |

For local browser testing replace the callback/setup origin with `http://localhost:3000`. Set the webhook URL to your HTTPS development forwarder plus `/api/github/webhook`. Keep `APP_URL` equal to the browser-facing app origin. If using a tunnel for the whole site, use that HTTPS origin for APP_URL and the callback/setup URLs too. Do not use a public development relay for production or send private repository events through a relay you do not trust.

Set repository permissions:

- **Contents: Read-only** — read committed source and migrations.
- **Pull requests: Read-only** — inspect current PR state and subscribe to PR events.
- **Checks: Read and write** — publish the RollbackIQ Check. The per-repository setting can turn publication off.
- **Metadata: Read-only** — GitHub's implicit repository metadata permission.

No organization, workflow-write, repository-administration, issue-write or contents-write permissions are required.

Subscribe to **Pull request** and **Repository** events. Installation and installation-repository lifecycle events are handled as delivered by GitHub. Enable expiring user access tokens where available. User tokens are used only during authorization and are discarded, including any refresh token.

Choose an installation audience appropriate for your use. Installing for selected repositories is sufficient. Do not grant all-repository access unless you intend that scope.

## 3. Configure environment variables

Copy `.env.example` to `apps/web/.env.local` if that file does not already exist; otherwise add the missing settings without overwriting existing values.

```dotenv
APP_URL=http://localhost:3000
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVER_ONLY_SERVICE_ROLE_KEY
GITHUB_APP_ID=YOUR_NUMERIC_APP_ID
GITHUB_APP_SLUG=your-app-slug
GITHUB_CLIENT_ID=YOUR_APP_CLIENT_ID
GITHUB_CLIENT_SECRET=YOUR_APP_CLIENT_SECRET
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\nYOUR_KEY_CONTENTS\n-----END RSA PRIVATE KEY-----"
GITHUB_WEBHOOK_SECRET=YOUR_RANDOM_WEBHOOK_SECRET
```

Obtain the App ID, slug and client ID from the App registration. Generate an OAuth client secret and an RSA private key there. Use the PEM file contents in the environment value; literal `\n` separators are supported. Store production values through your deployment's secret manager. Do not paste secrets into chat or commit `.env.local` or PEM files.

## 4. Start the app and worker

From `F:\PreflightOPS`, use two terminals:

```powershell
pnpm install --frozen-lockfile
pnpm dev
```

```powershell
pnpm github:worker
```

The worker loads `apps/web/.env.local`. `pnpm github:worker --once` claims at most one job, useful for a controlled check. For production, run the built Next.js app and this worker under a process supervisor. Multiple workers can run; PostgreSQL leases and `SKIP LOCKED` prevent simultaneous claims. Restart workers when configuration changes.

## 5. Connect one repository

1. Open `/team`, sign in, and create an organization if necessary.
2. As its owner/admin, open **Manage GitHub connection**.
3. Click **Connect GitHub** to authorize an existing installation in a new tab. For a first installation, use **Install GitHub App** in GitHub settings and select a test repository on GitHub.
4. Complete GitHub authorization. If you can access multiple installations, choose **Already installed on GitHub?** and enter the ID from the installation settings URL. An installation can belong to one RollbackIQ organization at a time.
5. Select repositories in RollbackIQ and click **Connect selected repositories** within five minutes. Expired selection requires reconnecting.
6. An existing unlinked manual record with the exact same owner/repository name in this organization is reused; historical reports are retained.
7. Configure migrations (for example `migrations`), source directories (`src`), optional Prisma/baseline paths, and an explicit previous release tag/branch/SHA (`v1.0.0`).
8. Enable automatic scans and optionally GitHub Checks. Save configuration.

Each installation belongs to one RollbackIQ organization. Repository IDs are globally unique mappings, preventing the same provider repository from being claimed by another tenant. Refresh access repeats authorization; only newly selected repositories are added/reconnected. Existing connections remain unless explicitly disconnected or access is revoked. No tokens are retained for unattended user actions.

## 6. Test a pull request

1. Ensure the configured previous release exists and contains the expected application source. Prefer a release tag or exact SHA for reproducible comparisons.
2. Open or update a PR adding a migration in the configured directory.
3. In the App's webhook deliveries, verify a `202` response from `/api/github/webhook`.
4. Open the repository in RollbackIQ. **GitHub scan jobs** shows queued/running/completed/failed/cancelled jobs; refresh to update progress.
5. Once completed, open the saved report. Verify previous/proposed commit IDs and the finding's source evidence.
6. Inspect the RollbackIQ Check on the exact head commit. High/Critical findings or incomplete coverage produce `action_required`. A passing Check only describes the analyzed scope. Configure the Check as required through GitHub branch protection separately if desired.

Jobs snapshot repository settings when enqueued. Subsequent configuration changes affect subsequent PR events. A previous release is resolved to its exact commit when a job runs. This build compares the whole configured previous release to the PR head; it does not silently substitute the PR merge base. Fork heads are read through the base repository's accessible GitHub object network; inaccessible heads fail or remain incomplete, with no green success.

## 7. Refresh and disconnect

- **Refresh access** reauthorizes the installation and displays eligible repositories. Select repositories to reconnect them after approval or restoration.
- **Disconnect repository** disables its scanning and cancels pending/running jobs. Reports remain available.
- **Disconnect organization** disables its RollbackIQ connections and jobs. It does not uninstall the App.
- To revoke GitHub access, uninstall the App or remove repositories in GitHub's installation settings. Signed lifecycle events disable access in RollbackIQ. Unsuspending requires a refresh before processing resumes.
- Repository renames use stable IDs. Deleted, archived or transferred repositories require reauthorization before scans can resume.

## Processing limits and recovery

- Authorization state: ten minutes, user/organization/browser-bound, single-use, separate installation and OAuth phases; PKCE S256.
- Verified repository selection: five minutes; at most 1,000 discoverable repositories and 100 selections per submission.
- Webhooks: one MiB body limit and ten-second body-read timeout; raw-body HMAC SHA-256 comparison precedes JSON parsing. Delivery IDs are recorded transactionally with lifecycle changes/job creation, so a failed database operation can be retried.
- Worker: five-minute lease, two-minute provider-operation signal, up to three attempts, increasing 30-second retry delays. Expired leases are reclaimed; exhausted jobs fail. The worker also checks the live PR head before scanning/saving/publishing. Each Check is bound to its own commit.
- Repository trees must be complete; truncated trees fail. Inputs use the scanner's migration and source limits. Oversized, binary, unsupported and unavailable files become explicit gaps. No repository code or SQL is executed.
- Saved reports are reused if Check publication needs retrying. A crash between Check creation and ID persistence is recovered using the job's `external_id` where visible in the last 100 matching Checks for that commit.
- The connecting RollbackIQ account must retain scan-write membership for worker ingestion. If that account is removed or downgraded to viewer, another owner/admin should refresh and reconnect the installation; jobs fail closed until that authorization is restored.
- Update a PR to trigger a new head job after correcting a terminal failure. Retrying an identical webhook is deduplicated rather than creating duplicate scans. Jobs remain visible with safe error messages.
- Retain webhook delivery IDs for the lifetime of this integration to preserve replay protection. Expired authorization states and choices are removed during subsequent authorizations. Plan normal database retention and monitoring for job/audit history.

## Verification status

Automated tests exercise PostgreSQL policies/RPCs in PGlite, signed mocked GitHub requests, authorization and provider validation, and real compatibility analysis on mocked committed blobs. These are local tests. A real GitHub installation, hosted Supabase authentication and a GitHub-delivered PR event require configured credentials and must be verified separately; a fixture test does not establish live connectivity.

Implementation verification on 2026-11-11: `pnpm install --frozen-lockfile`, `pnpm check` (42 tests, lint and strict TypeScript), and `pnpm build` passed. Browser testing verified the new homepage connection link, the actual missing-configuration screen, navigation back to the local workspace, and an unchanged PG002 migration scan. Starting `pnpm github:worker --once` without credentials exits with a configuration message as intended. The current environment has no configured Supabase or GitHub App credentials, so repository selection, connection persistence and disconnect were tested through the mocked provider and PostgreSQL tests rather than a live browser installation.

## Official references

- [GitHub setup URL and installation verification](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/about-the-setup-url)
- [GitHub App user tokens and PKCE](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app)
- [App JWTs](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-json-web-token-jwt-for-a-github-app)
- [Validating webhook deliveries](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries)
- [Checks API](https://docs.github.com/en/rest/checks/runs)

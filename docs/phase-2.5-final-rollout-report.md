# RollbackIQ Phase 2.5 final rollout report

## Executive summary

The rollout started from the working tree on `main` at base commit `2e6cc205cea338013c2f3bbd60b0903192b382a6` on 11 November 2026. The previous Phase 2 and 2.5 work was present at baseline. Review the local `codex/phase-2.5-rollout` branch and use its CI-verified commit SHA for both services.

| Area | Status | Evidence |
| --- | --- | --- |
| Local implementation | VERIFIED | 63 automated tests passed. The optimized build started, exported a valid demo report and opened the existing saved QA report. |
| Hosted frontend and migrations | BLOCKED | The Vercel health response has no release or protocol. Both Phase 2.5 migrations are pending. Production rollout requires owner approval and Vercel project access. |
| GitHub Checks | BLOCKED | The App and installation have read-only access. RollbackIQ's QA repository has publishing disabled. The exact QA head has zero matching RollbackIQ Check runs. |
| Worker | VERIFIED | The runtime started from a clean production-only install with the Dockerfile's application layout. It exposed health, detected a queue outage and recovered. The Linux image build and actual host remain outstanding. |
| Hosted worker | BLOCKED | A host and deployment approval are required. |
| Gemini | BLOCKED | Local mocks passed, including the RLS regression. A staging key, supported model, budget migration and approval for one live request are required. |
| Security | VERIFIED | Read-only GitHub and Supabase audits, local authorization tests and the secret scan ran. The Supabase leaked-password control and credential rotation items are listed below. |
| Overall production readiness | BLOCKED | The candidate needs a coordinated rollout and one fresh draft-PR test with a live Check and a hosted worker. |

The QA comparison remains **Potentially incompatible**. Comparing `b70e3c9e234aa8237401867577917d77421d4b2b` to `c460157e16ab1eafbb28f1aeda650514d4d737ef` found five previous-release queries, zero detected coverage gaps and one High, low-confidence `COMPAT010` warning on `public.rollbackiq_webhook_qa`. The migration can restrict access if the table already exists. The static report leaves runtime roles, policies and the deployed catalog for review.

## 12 November 2026 verification

- **VERIFIED.** The full test suite passed again with 63 tests. The production build succeeded, and the production dependency audit reported no known vulnerabilities. Evidence is in `%LOCALAPPDATA%\RollbackIQ\phase25-rollout-20261112` under `check.log`, `build.log` and `audit.log`.
- **BLOCKED.** GitHub still reports that the App and installation lack Checks write access. The QA PR is open and draft at `c460157e16ab1eafbb28f1aeda650514d4d737ef`, with zero RollbackIQ Checks. The application SDK confirmed that automatic scans are enabled and Check publishing is disabled. Supabase migration history still lists the original three migrations. A read using the new job columns returned PostgreSQL `42703`, confirming the worker schema is pending. See `github.json` and `supabase-sdk.json` in the latest evidence directory.
- **BLOCKED.** Vercel health still returns `ok` without release or protocol fields. The local environment has no Vercel project credentials and Gemini is disabled with no model selected. A hosted worker, staging Gemini request and fresh QA event still require the approvals and configuration listed below.

## Automated tests and browser verification

The baseline was captured before edits. `pnpm check` passed all 62 tests and `pnpm build` succeeded. The rollout changes add a worker image smoke test to the existing CI workflow and supply the RLS operation to Gemini when a finding matches an RLS migration change. The scanner's rules and risk decision remain authoritative.

Evidence is in `%LOCALAPPDATA%\RollbackIQ\phase25-rollout`.

| Command or test | Status | Result and evidence file |
| --- | --- | --- |
| `pnpm check` | VERIFIED | Lint and TypeScript checks succeeded. 63 passed, 0 failed, 0 skipped. `final-check.log`. |
| `pnpm build` | VERIFIED | Next.js generated 19 pages and the production routes. `final-build.log`. |
| `pnpm audit --prod --audit-level high` | VERIFIED | The registry reported no known production dependency vulnerabilities. `audit.log`. |
| Focused GitHub, worker, Gemini and database tests | VERIFIED | 17 passed. Includes signed webhook validation, Check creation and completion, head and installation checks, idempotency, provider failures, release mismatch, shutdown, lease recovery, RLS, quotas and Gemini output validation. `focused.log`. |
| Exact QA comparison with `--fail-on high --strict` | VERIFIED | CLI exit `1` matched the risk policy. The local Check renderer produced `failure`, one migration annotation and the supplied report link. `exact-release.log`, `exact-release/rollbackiq-report.json` and `exact-qa-gates.json`. |
| Clean production dependency layout | VERIFIED | `pnpm --filter @rollbackiq/web... install --prod --frozen-lockfile` succeeded in an isolated copy. `node scripts/github-worker-smoke.mjs` exercised the real worker process. `isolated-worker-install.log` and `isolated-worker-smoke.log`. |
| Local optimized application | VERIFIED | `pnpm --filter @rollbackiq/web start --port 3012` served the build. Health returned protocol `2` and the assigned test SHA. An anonymous team request returned `307` to `/auth`, and anonymous scan creation returned `401`. `production-start.json`. |
| Browser history and JSON export | VERIFIED | A pre-existing session opened the QA repository and its saved report. Refresh retained the selected report, exact commit and five-query count. The demo browser export contained four compatibility findings and matched the API result after schema validation. `browser-export.json` and `production-start.json`. |
| Worker image on Linux and live hosted QA run | NOT TESTED | Docker and Podman were unavailable on this machine, and WSL was absent. The CI image job is ready to run after the candidate is submitted. A new hosted QA run depends on deployment and permission approval. |

The local production browser initially stalled on an existing session. The Node process reproduced `UNABLE_TO_VERIFY_LEAF_SIGNATURE` against Supabase while Windows validated the TLS chain. Supplying the issuing chain validated by Windows through `NODE_EXTRA_CA_CERTS` for the temporary test process restored TLS and browser access. The authenticated local preview displayed a job-status warning against the old schema. Its saved report history still loaded. Apply the queue migration before promoting the new frontend. [Node.js CA configuration](https://nodejs.org/download/release/v22.13.1/docs/api/cli.html#node_extra_ca_certsfile)

## GitHub integration

**VERIFIED** by authenticated read-only API calls. `rollback-iq` and its installation grant Contents, Metadata and Pull requests read access. The installation includes `Nishan109/Site_Audit_AI`. A short-lived installation token scoped to that repository read draft PR #1 and confirmed the head and base above. The App subscribes to pull-request events and its webhook points to `https://rollback-iq.vercel.app/api/github/webhook`. See `github-read-only.json` and `github-checks-deployment.json`.

**VERIFIED** by read-only Supabase queries. The QA repository is connected, automatic scanning is enabled and `publishChecks=false`. Its baseline is `b70e3c9e234aa8237401867577917d77421d4b2b`, migration path is `supabase/migrations` and source path is `src`. No explicit severity threshold is saved. The current code defaults to High and requires action for incomplete evidence. The existing job for `c460157e16ab…` completed in one attempt and persisted the expected report. It has no Check ID. The GitHub Checks API returned zero `RollbackIQ` runs for that head.

**BLOCKED** for live Check creation. The App owner must grant Checks **Read and write**, and the installation owner must approve the updated grant. RollbackIQ must then enable **Publish GitHub Checks** for the QA repository. Mocked tests and the rendered QA result verify the intended policy and output. A new draft event is still needed to observe the live Check lifecycle. [GitHub Checks API](https://docs.github.com/en/rest/checks/runs#create-a-check-run) · [GitHub App permission approval](https://docs.github.com/en/apps/maintaining-github-apps/modifying-a-github-app-registration#changing-the-permissions-of-a-github-app)

## Worker and hosting

**VERIFIED** locally. The production package layout loaded the scanner and worker with the pinned dependency set. The smoke script used a disposable HTTP queue. `/readyz` returned `200`, changed to `503` during an outage, and recovered to `200`. `/livez` stayed `200` during that outage. Unit and disposable database tests covered production release mismatch, graceful drain, expired lease recovery, stale-head cancellation, duplicate prevention and provider outages. The Linux CI job also asserts the non-root image user, build SHA, production defaults and graceful `SIGTERM` exit. This Windows smoke run verified process exit. The Linux container assertions are **NOT TESTED** until CI runs.

Run the CI job `worker-image` on an approved candidate branch. Its commands build `Dockerfile.worker` and run `apps/web/scripts/github-worker-smoke.mjs` inside the image with networking disabled apart from loopback. To rerun the process smoke test from the repository root without Docker, use `pnpm --filter @rollbackiq/web exec node scripts/github-worker-smoke.mjs`.

| Option | Cost and operational fit |
| --- | --- |
| Existing approved Linux VM | Use one supervised container if the VM has spare capacity. An initial staging allocation of 1 vCPU and 1 GiB is an estimate. The operator manages updates, logs, restart policy and private HTTP probes. |
| Render private service | A managed container with private networking. Use a paid instance sized for the scanner. Render's private-service health checks are TCP probes, so add an internal HTTP monitor for `/readyz`. A background worker also runs continuously and needs another way to monitor HTTP readiness. [Render pricing](https://render.com/pricing) · [Health checks](https://render.com/docs/health-checks) |
| Railway service | A private persistent container with injected secrets. Hobby starts at $5/month including $5 usage, with overages based on actual usage. Configure restart policy, disable sleeping for the worker and add continuous readiness monitoring since Railway's deploy health check runs at startup. [Railway pricing](https://docs.railway.com/pricing/plans) · [Health checks](https://docs.railway.com/deployments/healthchecks) |

For any host, use one replica initially, pin the tested image digest, keep health probes private and inject the GitHub App and Supabase server credentials through the host secret manager. Allow outbound HTTPS to Supabase, GitHub and the matching Vercel web deployment. Configure a 240-second stop grace and monitor `/livez` and `/readyz` separately. The queue remains in Supabase. Hosting and billable provisioning are **BLOCKED** pending a host decision and approval.

## Gemini staging and security

**VERIFIED** locally. The existing environment has an API key and leaves Gemini disabled with no model configured. The staging script failed closed without explicit live opt-in and made zero provider requests. Its synthetic live fixture now exercises a conditional RLS change with a low-confidence finding. The provider receives a fixed operation value when that finding matches an RLS migration change. Object names and migration text stay in the stored report. The browser uses that report to identify the object. Tests verified that a coverage gap sharing the same `COMPAT010` rule receives no RLS operation. The mock also verified discovery of a model supporting `generateContent`, timeouts, two-attempt limits, structured output and categorical input. The database tests covered the per-user and global budgets, and the deterministic scan verdict is preserved. [Gemini model discovery](https://aistudio.google.com/api-reference/models)

**BLOCKED** for live staging. Supply a dedicated staging key and supported model through the staging secret store, apply the budget migration to staging and authorize one smoke request. `GEMINI_ENABLED=true` and `ROLLBACKIQ_GEMINI_STAGING=true` are required in the staging test shell. Run `pnpm --filter @rollbackiq/web gemini:verify --live`. It checks model capabilities and performs one generation attempt. Verify in the staging UI that the explanation describes possible RLS impact, includes the evidence limits, and preserves **Potentially incompatible**. Provider error cases are verified by mocks. Live provider outcomes are **NOT TESTED**.

**VERIFIED** locally. The secret check scanned 148 repository files and 17 production client assets for the five configured server-secret categories. It found no matches, and `.env.local` is Git-ignored. The local GitHub App key validated as RSA of at least 2048 bits. Vercel production and preview variable scopes and the future worker secret store are **NOT TESTED**. The Vercel dashboard redirected to sign-in. [Vercel environment scopes](https://vercel.com/docs/environment-variables#environments)

**FAILED** for the leaked-password protection control. Supabase's read-only security advisor still reports it disabled. The three private-table RLS notices describe intentional default-deny storage. Before rollout, the Supabase owner should approve the password protection change if the project plan supports it. Verify advisor status after the change. The earlier chat exposed a Supabase server key, GitHub App signing key, GitHub OAuth client secret and webhook secret. Verify which values remain active and approve rotation and retirement of any exposed value. The existing security review records the reported earlier webhook rotation. [Supabase password security](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)

## Coordinated deployment and rollback

**VERIFIED** publicly. Vercel health responded `200` without `release` or `workerProtocol`. `/team` redirected to `/auth`, and a GET to the POST-only webhook returned `405`. GitHub had no production deployment record that confirmed the Vercel SHA. The deployed commit remains **NOT TESTED** through the Vercel dashboard. Current HTTP evidence is in `hosted-http.json`.

1. Review the local `codex/phase-2.5-rollout` commit and run CI on that SHA, including `worker-image`. Record the currently deployed Vercel deployment ID and worker image or checkout before promotion. Review variable names and scopes in the Vercel project and set separate staging values. Use `VERCEL_GIT_COMMIT_SHA` or set `ROLLBACKIQ_RELEASE` to the approved commit when the platform provides no SHA.
2. Review the Supabase migration plan for the correct project. After approval, apply `20261111154108_github_worker_operations.sql` and then `20261111155003_gemini_daily_budget.sql`. Confirm migration history and worker protocol `2`. Both passed in disposable PostgreSQL. The hosted project currently has the earlier three migrations.
3. Drain the legacy worker. Promote the approved Vercel build and start the tested worker image from that same SHA. Verify that web `/api/health` and worker `/readyz` agree on SHA and protocol `2`, then verify `/livez`. Verify that existing saved reports still open.
4. With App approval and Check publishing in place, obtain approval for a single comment-only update to [draft PR #1](https://github.com/Nishan109/Site_Audit_AI/pull/1). Record the new head, verify one HTTP `202` delivery and one completed job on that head, then verify the saved report and exactly one completed Check. Confirm the expected `failure` conclusion under the High gate, the annotation and the report URL. Open the report and refresh it. Leave the PR in draft.
5. If a rollout fails, stop new claims by draining the worker and restore the previous Vercel deployment and matching worker. Preserve queue data and the additive migrations. Confirm web health, queue recovery, the webhook and existing reports. Review an approved corrective migration if a schema change needs correction. [Vercel rollback controls](https://vercel.com/docs/deployments/managing-deployments#rolling-back-a-production-deployment)

See the [Phase 2.5 deployment guide](phase-2.5-deployment-guide.md) for environment variables, logs and operator recovery.

## Remaining actions and owners

| Status | Blocker | Owner and next action | Success evidence |
| --- | --- | --- | --- |
| BLOCKED | App and installation lack Checks write, and QA publishing is disabled. | App owner sets **Settings → Developer settings → GitHub Apps → RollbackIQ → Permissions & events → Checks → Read and write**. Installation owner approves the grant. RollbackIQ repository admin refreshes access and enables publishing with the High policy. | Installation API returns `checks:write` and the QA configuration shows publishing enabled. |
| BLOCKED | Two hosted migrations are pending. | Supabase owner approves the migration plan and applies the two named files in order to the intended environment. | Both entries appear in migration history, and the worker RPC reports protocol `2`. |
| BLOCKED | Vercel dashboard access, candidate CI and rollout approval are pending. | Repository and Vercel owners review the local release commit, run CI, inspect environment names and scopes, record the previous deployment, and promote the CI-verified SHA. | Public health returns the approved SHA and protocol `2`. An authenticated user can reopen the saved QA report. |
| BLOCKED | No approved persistent worker host. | Infrastructure owner selects an existing host or approves the managed plan and budget, then deploys the CI-tested image. | The hosted worker reports healthy liveness and readiness with the same SHA and protocol, and resumes after restart. |
| BLOCKED | Staging model, staging key and live test authorization are pending. | Gemini project owner configures staging credentials through the secret store and authorizes the one-request smoke test. | Model discovery confirms support, the staging script succeeds, and the UI preserves the scanner finding and confidence. |
| BLOCKED | Fresh hosted QA event requires separate approval after deployment. | QA repository owner approves one draft-branch update after the rollout prerequisites pass. | One delivery, one job, one saved report and one Check for the new head. Browser refresh retains the same report. |
| BLOCKED | Credential retirement and Auth control change need approval. | Supabase, GitHub App and deployment owners verify old credential status, rotate exposed active values and enable leaked-password protection if supported. | Old credentials are retired, the new credentials pass authorized connectivity checks, and the Auth advisor reflects the approved policy. |

# RollbackIQ Phase 2.5 test results

Tests were run on 11 November 2026 from the `F:\PreflightOPS` working tree with Node 22.13.1 and pnpm 11.25.0. The baseline had 57 passing automated tests. Phase 2.5 has 62 passing tests and no skipped or failed tests in the final full run.

| Command or check | Status and evidence |
| --- | --- |
| `pnpm install --frozen-lockfile` | **VERIFIED.** All four workspace projects installed against the frozen lockfile. The npm registry retried transient connection resets and the command exited 0. |
| `pnpm check` | **VERIFIED.** Lint, workspace type checks and 62 of 62 automated tests passed. |
| `pnpm build` | **VERIFIED.** Next.js compiled, checked TypeScript and generated 19 pages. Dynamic webhook, health and explanation routes were included. |
| `pnpm audit --prod --audit-level high` | **VERIFIED.** The registry reported no known vulnerabilities in the production dependency audit. |
| Exact-commit compatibility CLI | **VERIFIED.** Compared `b70e3c9e234aa8237401867577917d77421d4b2b` with `c460157e16ab1eafbb28f1aeda650514d4d737ef` using `supabase/migrations` and `src`. The report had one migration, five queries at each revision, zero detected gaps, and one High, low-confidence `COMPAT010` finding for `public.rollbackiq_webhook_qa`. Exit code 1 was the expected result under `--fail-on high --strict`. |
| GitHub provider and Check policy | **VERIFIED with mocks.** Tested raw signature validation, size and payload rejection, token expiry, missing permission, installation approval, disabled publishing, wrong repository and stale head, rate limits, partial reads, Check creation and completion failures, recovery after an ambiguous response, pagination, annotation limits and risk conclusions. |
| PostgreSQL queue and tenant policies | **VERIFIED in PGlite.** Applied the migrations and tested role boundaries, webhook deduplication, persistence, lease renewal and expiration, stale-worker rejection, rate-limit scheduling and publication failure with a retained report. Also tested per-user and global daily Gemini budgets and RLS access restrictions. |
| Worker health and shutdown | **VERIFIED locally.** The actual Node worker started with a synthetic queue and RSA key. Readiness went from HTTP 200 to 503 during a queue outage, liveness stayed HTTP 200, and readiness recovered after the fixture restarted. A production-mode process using an isolated transport fixture claimed only when the web release matched. Automated tests verified protocol mismatch detection and no new claim while draining. |
| Gemini transport and behavior | **VERIFIED with mocks.** Covered model capability checks, categorical metadata only, one-finding and scan-level requests, strict schema, malformed output, retry, abort and rate limits. The smoke command without staging opt-in exited before a network request. |
| Local source and client secret scan | **VERIFIED.** Checked 144 repository files and 17 client build assets against five configured secret categories. See the [security review](phase-2.5-security-review.md) for the scope. |

The exact-commit warning is a conditional access risk. The migration enables row-level security on a table created with `IF NOT EXISTS`. A disposable PostgreSQL test showed that enabling RLS on an already existing table can reduce visible rows for an ordinary role. The scan status and confidence reflect the evidence available from the repository. Zero detected coverage gaps describes this scan's inputs and supported patterns. [Earlier hosted Phase 2 report](https://rollback-iq.vercel.app/team/repositories/4cbe8820-30c8-4a49-b864-7b31fb59a0d7?scan=ae36c9ae-5ec7-4e3c-a98a-82a3e084d1d2)

## Local browser and HTTP verification

Playwright used the actual Next.js application and a disposable Supabase HTTP fixture. The fixture supplied authentication, repository settings, job rows and historical reports. The database authorization and queue tests used PostgreSQL separately.

| Flow | Status and evidence |
| --- | --- |
| Authentication | **VERIFIED.** Invalid sign-in showed an error. Valid sign-in opened the team page. The fixture recorded refresh. Sign-out redirected to the auth page. Direct access to `/team` redirected when unauthenticated. |
| Expired and invalid sessions | **VERIFIED.** An expired session with an invalid refresh token redirected `/team` to `/auth` and returned HTTP 401 on scan creation. A malformed cookie also returned HTTP 401. Cross-origin GitHub configuration returned HTTP 403. |
| GitHub repository and job UI | **VERIFIED.** Opened the connected repository, checked queued, running, completed, failed and cancelled states, and verified the Check status and link. Saved Critical and **Fail the Check** in the synthetic repository, then verified both selections persisted. |
| Automatic and imported scan history | **VERIFIED.** The report linked from a completed fixture job was labeled **GitHub pull request scan**. The imported history report retained its imported label. Both displayed one finding and zero coverage gaps. Reload retained the saved report. The local workspace history also counted one imported compatibility finding. |
| Migration scanning and export | **VERIFIED.** Pasting SQL and running a migration scan produced `PG002`. The workspace imported a compatibility JSON report, exported it, and the exported report matched the input after schema validation. |
| Gemini UI | **VERIFIED for the disabled state.** A saved report displayed that Gemini explanations were disabled. **NOT TESTED** in a browser with an active provider. |

Local evidence is under `%LOCALAPPDATA%\RollbackIQ\phase25-qa` including `final-check.log`, `final-build.log`, `final-exact-release.log`, `browser-automatic-report.png` and `browser-export.json`.

## Failures and corrections

| Observed failure | Correction and result |
| --- | --- |
| A new GitHub test used unsafe optional chaining and failed lint. The invalid-rule Gemini test also failed type checking because it used a valid-rule type. | Asserted that the captured request exists before checking it and modeled the deliberately invalid Gemini input at its validation boundary. The full check passed. |
| The browser auth fixture revoked a refresh token too early for concurrent requests. The mock settings response omitted a required nullable field. | Fixed the disposable fixture's refresh grace and added `choices: null`. Repeated sign-in, refresh, report and settings flows successfully. |
| The disposable local HTTPS fixture failed certificate-chain verification. The first alternate fixture used an absolute Windows path for a Node ESM preload. | Converted the preload to a file URL. The alternate transport fixture verified the production-mode worker's release gate against synthetic responses. TLS transport from the worker remains for hosted verification. |
| The live GitHub App and installation lack `checks:write`. | Confirmed with a read-only permission audit. Local regression coverage exercises this result and keeps the saved scan accessible. Live Check creation remains blocked until the App owner grants the permission and the installation owner approves it. |

## External acceptance

| Acceptance item | Status |
| --- | --- |
| Historical hosted webhook and scan | **VERIFIED read-only for Phase 2.** The existing draft PR and a previous HTTP 202 delivery were observed. The exact comparison was independently reproduced locally. |
| Fresh hosted Phase 2.5 scan and Check | **BLOCKED.** The deployed health endpoint returned `ok` without release or protocol metadata. The new web and worker release, Check permission approval and a separately authorized draft QA event are required. |
| Container image and 24/7 operation | **NOT TESTED** for the image build on this machine. Docker, Podman and a usable WSL environment were unavailable. **BLOCKED** for always-on operation pending a host and rollout approval. |
| Live Gemini staging | **BLOCKED.** A staging key, supported model, quota migration and authorization for a live request are required. |
| Hosted Auth and production environment scopes | **BLOCKED** for a disposable hosted Auth session. **NOT TESTED** for Vercel environment variable scopes and the future worker's secret store. |

The [deployment guide](phase-2.5-deployment-guide.md) covers the verification order and rollback procedure.

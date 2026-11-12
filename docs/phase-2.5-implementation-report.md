# RollbackIQ Phase 2.5 implementation report

## Baseline recorded before implementation

On 11 November 2026, `main` pointed to `2e6cc205cea338013c2f3bbd60b0903192b382a6`. The working tree contained the earlier Supabase analysis, Git snapshot, compatibility reporting and test changes documented in the [Phase 2 audit](phase-2-verification-report.md). The work proceeded on that tree.

| Baseline check | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | VERIFIED. All four workspace projects were up to date. |
| `pnpm check` | VERIFIED. Lint, workspace type checks, and all 57 tests passed. |
| `pnpm build` | VERIFIED. Next.js built and generated production routes. |
| Hosted Supabase migration history | VERIFIED by read-only MCP query. The original three migrations were applied. |
| Hosted Supabase security advisors | VERIFIED by read-only MCP query. Leaked-password protection was disabled. The private GitHub tables intentionally have RLS with no client policies. |

The worker used a five-minute database lease, a two-minute GitHub deadline and three attempts. Check publication could stop an otherwise valid scan before it was saved. Partial GitHub blob API failures could be reduced to scanner coverage gaps. Check status was not recorded separately from job status. The deployment had no worker readiness endpoint or release check. The existing Gemini integration was disabled and accepted only scan-level explanations.

## Implemented behavior

- **GitHub Checks.** The worker verifies the installation, repository and exact PR head before scanning. It distinguishes disabled publishing, missing App permission, installation approval, missing repository access and transient failures. The Check is associated with the exact head and links to the saved report. It includes the compatibility result, query and coverage counts, severity, evidence confidence and affected objects. The worker recovers an existing Check for the same App, head and job, and reconciles ambiguous completion responses before adding annotations again. It publishes up to 50 annotations using parsed locations in proposed migration files.
- **Risk gate.** The default threshold is High. Repository admins can select a severity threshold or fail only on confirmed incompatibilities. They can choose `action_required` or `failure` for incomplete coverage. A confirmed incompatibility fails. A potentially incompatible result below the severity threshold is neutral when coverage is sufficient. A compatible result with sufficient coverage can pass. A confirmed or gate-level risk takes precedence over the incomplete-coverage policy. Scan status and Check conclusion are stored independently.
- **Worker.** A five-minute lease is renewed every 30 seconds. Each attempt has a 180-second deadline. Retries use 30- and 60-second delays, extended when GitHub reports a rate limit, up to an hour. The worker reuses saved reports on publication retries. `/readyz` reflects database and release availability, `/livez` monitors the process, and shutdown stops new claims while active work drains. The worker checks the web release and queue protocol before its first production claim and rechecks them at 30-second intervals between attempts. The web application continues to receive webhooks during a worker restart.
- **Gemini.** Users can request an explanation of a saved scan or individual finding. The server sends only normalized finding metadata. The UI displays the affected object and evidence confidence from the stored report. A durable UTC-day budget limits authenticated users and the project. Explanations use structured output, bounded retries and timeouts. The scanner remains the source of the compatibility decision.
- **Dashboard.** Job state, Check state and Check conclusion are visible with separate links for the PR, Check and report. Imported and automatic reports retain their source labels and persisted finding counts. Older job rows remain readable with the Check status available in that row.

## Files changed in Phase 2.5

| Area | Files |
| --- | --- |
| GitHub integration | `apps/web/lib/github/{checks,config,contracts,provider,routes,snapshot,store,webhook,worker,worker-service}.ts` |
| Worker package and release | `Dockerfile.worker`, `.dockerignore`, `.env.example`, `.gitignore`, `apps/web/scripts/github-worker.ts`, `apps/web/lib/release.ts`, `apps/web/app/api/health/route.ts`, `apps/web/package.json`, `pnpm-lock.yaml` |
| Supabase | `apps/web/lib/supabase/{database,service}.ts`, `supabase/migrations/20261111154108_github_worker_operations.sql`, `supabase/migrations/20261111155003_gemini_daily_budget.sql` |
| Gemini and dashboard | `apps/web/lib/gemini.ts`, `apps/web/scripts/gemini-verify.ts`, `apps/web/app/api/scans/[id]/explain/route.ts`, `apps/web/app/team/github/page.tsx`, `apps/web/app/team/repositories/[id]/{page,ai-explanation}.tsx` |
| Regression tests | `package.json`, `apps/web/lib/gemini.test.ts`, `apps/web/lib/github/{github,worker-service}.test.ts`, `tests/github-tenancy.test.ts` |

The existing Phase 2 scanner, CLI and compatibility panel changes were present at baseline and were preserved. The detailed baseline file inventory and previous verification are in the [Phase 2 audit](phase-2-verification-report.md).

## Release status

| Requirement | Status and evidence |
| --- | --- |
| Local compatibility, application and build | **VERIFIED.** All 62 tests passed. Lint, type checks and Next.js production build passed. The browser exercised the local workspace against a disposable Supabase HTTP fixture. |
| QA repository comparison | **VERIFIED locally.** The CLI reran the exact Phase 2 commit pair and found five previous-release queries, zero detected coverage gaps and one low-confidence High RLS warning. The result was `potentially_incompatible`. |
| GitHub Check publishing | **VERIFIED with mocks. BLOCKED on GitHub.** The App and installation grant `contents:read`, `metadata:read` and `pull_requests:read`. An owner must grant and approve `checks:write`, then authorize a new draft QA event. |
| Always-on worker | **VERIFIED as a local process with a disposable queue fixture. BLOCKED for hosted operation.** A persistent host, a validated container build, the new database migrations and deployment approval are outstanding. |
| Supabase authorization | **VERIFIED in a disposable database.** The two new migrations ran there. The hosted project's migration list had the previous three migrations. Live leaked-password protection was disabled in the advisor result. |
| Gemini | **VERIFIED with mocks. BLOCKED for staging.** Local explanations were disabled and no model was configured. Staging needs an approved key and model, the quota migration and permission for one live test. |
| Hosted Phase 2.5 end-to-end | **BLOCKED.** The public `/api/health` returned `ok` without release or worker protocol. Phase 2.5 is pending deployment and a fresh end-to-end test. |

See the [deployment guide](phase-2.5-deployment-guide.md), [security review](phase-2.5-security-review.md) and [test results](phase-2.5-test-results.md) for rollout order, account changes that require authorization and test details.

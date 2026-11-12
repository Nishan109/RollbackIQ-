# RollbackIQ Phase 2 verification report

**Date** 11 November 2026 (IST)\
**Workspace** `F:\PreflightOPS`, `main` at `2e6cc205cea338013c2f3bbd60b0903192b382a6` with local changes

## Executive summary

The Phase 2 regression suite passed all 57 tests, lint, type checks, and the production build. The approved update to draft PR #1 passed through the deployed webhook, the local worker, Supabase persistence, and the browser report. The worker completed the scan on attempt 1. The report and independent CLI comparison both found **five previous-release queries, zero coverage gaps, and one row-level security warning**. The result is **Potentially incompatible**.

Production readiness remains partial. GitHub Check publication needs App permission and a hosted retest. The worker runs on the local machine. Full password sign-in and sign-out need a disposable test identity. Gemini passed mocked tests and is disabled in the current configuration. The final history-count patch passed lint, type checks and build, but browser access became unavailable during its retest.

## Environment and scope

| Component | Verified environment |
| --- | --- |
| Host | Windows NT 10.0.26200.0, PowerShell |
| Toolchain | Node 22.13.1, pnpm 11.25.0, Git 2.47.1.windows.1 |
| Application | Next.js 16.4.6, local development server and existing Vercel deployment |
| Test runners | Node `node:test` via `tsx`, disposable PostgreSQL via PGlite, and Playwright browser controls |
| Hosted services | GitHub App `rollback-iq`, connected Supabase project, existing Vercel webhook |
| Workspace | Next.js app in `apps/web`, analysis in `packages/scanner-core`, Git and export commands in `packages/cli`, composite action in `integrations/github-action` |

The audit reviewed the README, workspace manifest, environment template, architecture and integration guides, both Actions workflows, webhook and worker code, Supabase migrations and policies, and Gemini request handling. Local logs and export artifacts are under `%LOCALAPPDATA%\RollbackIQ\phase2-qa-20261111`. The approved change to the QA branch was one SQL comment. The RollbackIQ application fixes are local.

## Test results

**Verified** means the test ran and passed. **Failed** records an observed failure. **Blocked** records a missing prerequisite. **Not tested** records a check that was not run.

| Check | Command or procedure | Result | Evidence |
| --- | --- | --- | --- |
| Frozen install | `pnpm install --frozen-lockfile` | Verified | All four workspace projects already up to date. |
| Initial lint, type check and suite | `pnpm check` | Verified | 51/51 tests in `baseline-check.log`. |
| Initial build | `pnpm build` | Verified | Production build succeeded in `baseline-build.log`. |
| New scanner regression cases before fixes | `pnpm exec tsx --test packages/scanner-core/src/compatibility/compatibility.test.ts` | Failed, fixed | Three tests exposed constant alias coverage, repeated projections, and validation schema ambiguity. `regressions-before-fix.log`. |
| Intermediate type check | `pnpm check` | Failed, fixed | The target library lacked `Array.findLast`. Used an ES2022-compatible lookup. `intermediate-typecheck-failure.log`. |
| Exported-builder follow-up | `pnpm check` | Failed, fixed | The existing CLI fixture expected a complete result for an exported builder. It now exports an awaited result. Dedicated scanner tests require an exported builder to retain a gap. `exported-builder-fixture-failure.log`. |
| Final lint, type check and suite | `pnpm check` | Verified | 57/57 tests in `final-check.log`. Individual results are listed below. |
| Production build | `pnpm build` | Verified | Compiled and generated the production routes. `final-build.log`. |
| Dependency advisories | `pnpm audit --prod --audit-level high` | Verified | Registry reported no known vulnerabilities in the checked production dependencies. |
| App health | `GET http://127.0.0.1:3000/api/health` | Verified | HTTP 200 and `{"status":"ok"}`. |
| Hosted protected route | Browser opens `/team` with no hosted session | Verified | Redirected to `/auth` and displayed the sign-in form. |
| Invalid sign-in | Browser submits synthetic invalid credentials | Verified | Controlled sign-in error displayed. |
| Successful password login and sign-out | Dedicated test account | Blocked | No disposable credentials available. The existing signed-in local session verified authorized dashboard access. |
| Repository management | Browser opens GitHub connections | Verified | Connected `Nishan109/Site_Audit_AI` with automatic scans enabled, `supabase/migrations`, `src`, and the exact configured baseline. |
| Pasted SQL scan | Browser New scan, synthetic `DROP COLUMN` | Verified | One high-severity PG002 finding with AST and source-line evidence. |
| Browser severity filter | Risk findings, Critical then High | Verified | Critical hid PG002. High restored it. |
| Browser evidence filters | Confidence High and Low, object search, expand finding | Verified | Low-confidence RLS finding displayed only when expected. Corrected empty-evidence copy was visible. |
| Git comparison and import | CLI compares explicit SHAs, then browser imports JSON | Verified | UI showed both exact SHAs, five queries, zero gaps, and COMPAT010. Arbitrary Git references are selected through the CLI or configured GitHub integration. |
| Persistent scan history | Browser opens historical and automatic reports and refreshes | Verified | Historical report kept Unknown and two gaps. New automatic report kept its exact commits and counts after refresh. |
| Local history finding count | Browser opens history after importing a Git report | Failed, fixed in code | The row showed zero while the compatibility detail showed one. The row now uses the compatibility report count. Browser retest blocked by unavailable local browser access. |
| JSON export | Browser exports SQL and imported compatibility reports | Verified | SQL export contained PG002 and matched its visible object. Compatibility export passed the app's schema and matched the parsed CLI report. |
| SARIF and Actions annotation | CLI `--github --output-dir` | Verified | SARIF 2.1.0 contained COMPAT010. The command emitted an annotation at the migration's line 5 and wrote a job summary. Policy exit 1 was expected. |
| Gemini disabled flow | Browser opens saved scan | Verified | Disabled message displayed and the deterministic report remained visible. |
| Gemini live inference | Google provider call | Blocked | `GEMINI_ENABLED=false` and `GEMINI_MODEL` is unset. Model availability and live outputs remain unverified. |
| Live webhook and worker | Approved one-line update to draft PR #1 | Verified | GitHub returned HTTP 202. A single job completed on attempt 1 and saved the matching report. |
| Live Check publication | Inspect GitHub PR Checks and App permissions | Blocked | App has no `checks: write`, and publishing is disabled for this repository. Mocked Check creation and completion passed. |
| Hosted Actions for this PR | Read GitHub Actions and checks for `Site_Audit_AI` | Not tested | The API listed no Actions runs for the repository. The PR's visible check was Vercel Preview Comments. The RollbackIQ repository's existing Check and build run passed on `2e6cc20`. |
| Cross-tenant policies | `pnpm exec tsx --test tests/tenancy.test.ts tests/github-tenancy.test.ts` via `pnpm check` | Verified locally | Executed the migrations in disposable PostgreSQL. Cross-organization reads and writes, invalid tenant links and unauthorized roles were rejected. |
| Hosted database catalog | Supabase MCP read-only catalog and saved scan queries | Verified | Three expected migrations recorded. RLS was enabled on all 13 application tables and three private GitHub tables. The hosted job and its single normalized finding matched the report. |
| Local HTTP guards | Local Node `fetch` against `/team`, `/api/scans`, `/api/scan` and `/api/github/webhook` | Verified | HTTP 307 and 401 for protected routes, 400 for invalid paths, 415 for wrong content type, 413 for size limits, and 401 for missing or mismatched webhook signatures. `runtime-http.json`. |
| SQL parse behavior | Local `/api/scan` for malformed and unsupported SQL | Verified | PG901 for malformed SQL and PG900 for unsupported SQL. The parser returned without executing the input. |
| Production client bundles | Local comparison of configured server credential values against `.next/static` JS | Verified | No matches across 16 inspected JS files in the audited build. `client-secret-audit.json` records only boolean results. `.env.example` is the tracked environment template. |

## Compatibility engine

GitHub confirmed the baseline `b70e3c9e234aa8237401867577917d77421d4b2b` and original proposed commit `8700881b308fdefcb292ecee0c50086331e0d1cb`. The approved QA update created `c460157e16ab1eafbb28f1aeda650514d4d737ef` on the same draft PR. The comparison used the configured baseline and that exact head. The only migration added against the baseline was `supabase/migrations/20261111120143_rollbackiq_webhook_qa.sql`. The update to that fixture was one comment. [Draft PR #1](https://github.com/Nishan109/Site_Audit_AI/pull/1) · [QA commit](https://github.com/Nishan109/Site_Audit_AI/commit/c460157e16ab1eafbb28f1aeda650514d4d737ef)

| Scan | Previous queries | Gaps | Findings | Result |
| --- | ---: | ---: | ---: | --- |
| Historical automatic scan of `8700881` | 2 | 0 | 1 | Potentially incompatible. Shared client calls were undercounted. |
| Historical imported scan of `8700881` | 5 | 2 | 3 | Unknown. Conditional filters added to a stored builder were uncovered in both snapshots. |
| Current local CLI rerun of `8700881` | 5 | 0 | 1 | Potentially incompatible. Both snapshots contained 169 source files. |
| Fresh automatic scan of `c460157` | 5 | 0 | 1 | Potentially incompatible. Hosted report and final CLI run agreed on commits, counts and finding. |

The scanner now resolves shared client helpers and committed TypeScript aliases from the files in each release. It follows supported filters through constant aliases and self-derived assignments in one scope. In a direct chain it uses the final `.select()` projection while preserving filter references. The raw logical filter analysis checks a limited grammar and rejects ambiguous, mutated or escaped validators. Cross-function composition, exported builders, unresolved operations, complex SQL and dynamically constructed identifiers still produce gaps. Source evidence, runtime roles and database state remain distinct inputs.

`COMPAT010` remains high severity and low confidence for `public.rollbackiq_webhook_qa`. The conditional create leaves open whether the table already exists. A disposable PostgreSQL test confirmed that an ordinary reader could see a seeded row before RLS and zero rows after enabling it without a policy. The scan found no previous-release dependency on the fixture table. The production database used by the previous release and its actual roles were outside the runtime test. The CLI's high severity gate blocked with exit 1. [Saved automatic report](https://rollback-iq.vercel.app/team/repositories/4cbe8820-30c8-4a49-b864-7b31fb59a0d7?scan=ae36c9ae-5ec7-4e3c-a98a-82a3e084d1d2)

## GitHub integration and worker

- The deployed endpoint is `https://rollback-iq.vercel.app/api/github/webhook`. GitHub reports TLS verification enabled and a `pull_request` subscription. Delivery `5c2b7cd0-dde1-11f1-93ca-f4a40290908b` returned HTTP 202 for `pull_request.synchronize` at 20:35:45 IST. Older installation and ping deliveries showed HTTP 502 before the latest successful deliveries. Those historical failures were not replayed.
- The worker claimed job `771ac783-2dbb-4c0f-ad2f-60656e3341c1` and completed at 20:37:25 IST. It persisted scan `ae36c9ae-5ec7-4e3c-a98a-82a3e084d1d2`. The queue and stored scan matched the new PR head. The App had Contents, Metadata and Pull requests read permissions. The existing [Check and build run](https://github.com/Nishan109/RollbackIQ-/actions/runs/43026132501) verified the older published revision.
- The webhook validates HMAC over bounded original bytes before parsing or queuing. Tests cover invalid signatures, altered bytes, invalid payloads, delivery deduplication and commit deduplication. Isolated queue tests exercised revoked and expired leases, retries, stale PR cancellation and simulated provider failure. Worker and API tests use synthetic payloads and mocked GitHub responses for negative cases.
- The idle local worker was restarted at 20:34:09 IST, before the live QA commit. A second idle restart at 20:50:56 IST loaded the final exported-builder guard. The second process logged startup, remained present, and had an empty error log at verification. The final scanner also reproduced the live result through the CLI. The first restart is the one that processed the approved live event.
- The migration workflow uses a trusted base checkout for the scanner and a candidate checkout for the PR merge preview. The App compares the configured baseline with the exact PR head. Local CLI runs verified annotations, summary output and JSON/SARIF generation. Hosted artifact upload and PR annotations for the current patches were not run.
- Terminal Git push stopped at credential authentication. The authorized comment was committed through the signed-in GitHub browser session after reviewing the one-line diff. The draft PR stayed open, now with three commits.

## Supabase and Gemini

The hosted catalog confirmed the scan history, membership and job readiness indexes. The local tests verified owner/admin and viewer/developer restrictions, foreign keys, idempotent writes and persisted findings, evidence and coverage. The hosted browser confirmed authorized retrieval and refresh. The three private GitHub tables intentionally have RLS without public policies. Supabase's advisor also reported leaked-password protection disabled. [Supabase RLS documentation](https://supabase.com/docs/guides/database/postgres/row-level-security)

The Gemini SDK sends categorical rule IDs, counts, severity, confidence and status. Mocked tests verified that raw SQL, private paths and injected repository instructions were omitted. Structured output rejects extra fields. Simulated 429, timeout and 503 failures stayed bounded and left the deterministic report unchanged. The API key stayed server-side in the inspected build.

## Files changed

| File | Reason |
| --- | --- |
| `packages/scanner-core/src/compatibility/supabase.ts` | Resolve supported clients and trace bounded builder operations, aliases and final projections. |
| `packages/scanner-core/src/compatibility/supabase-filters.ts` | Analyze bounded logical filters and check supported validated values conservatively. |
| `packages/scanner-core/src/compatibility/source-program.ts` | Resolve modules against supplied source and configuration blobs. |
| `packages/scanner-core/src/compatibility/contracts.ts` | Carry optional TypeScript config blobs in snapshots. |
| `packages/scanner-core/src/compatibility/dependencies.ts` | Use the TypeScript program and query evidence during dependency extraction. |
| `packages/scanner-core/src/compatibility/index.ts` | Validate snapshot config bounds and refine conditional RLS handling. |
| `packages/scanner-core/src/compatibility/compatibility.test.ts` | Cover shared clients, chained filters, safe aliases, unsupported composition, validator ambiguity and RLS. |
| `packages/cli/src/compatibility-git.ts` | Read each committed revision's module configuration. |
| `packages/cli/src/compatibility.test.ts` | Verify Git snapshot isolation, release refs, committed aliases and artifacts. |
| `apps/web/lib/github/snapshot.ts` | Include TypeScript configuration from each GitHub tree. |
| `apps/web/lib/github/github.test.ts` | Verify GitHub snapshot module resolution with committed blobs. |
| `apps/web/lib/gemini.test.ts` | Verify bounded behavior on provider rate limits and aborts. |
| `apps/web/components/compatibility-panel.tsx` | Explain missing query evidence without implying a coverage gap exists. |
| `apps/web/app/workspace/workspace.tsx` | Count compatibility findings in imported scan history rows. |
| `tests/tenancy.test.ts` | Reproduce the conditional RLS effect with an ordinary role in disposable PostgreSQL. |
| `docs/compatibility.md` | Document supported Supabase patterns and limits. |
| `docs/phase-2-verification-report.md` | Record audit evidence and follow-up checks. |

## Prioritized follow-up

1. Rotate any still-active server credentials previously pasted into the conversation. Review the Supabase leaked-password protection setting before production use. [Supabase password security](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)
2. Review and publish the application changes through the usual release process, then run the worker from the same version on an always-on host. Check hosted Actions, artifact upload and failure alerts on that release.
3. If PR gating is required, approve GitHub App Checks write access and verify a real RollbackIQ Check on a QA commit. Keep the fixture draft for testing.
4. Use a disposable account to finish successful login, logout and session refresh. Recheck the imported history count when browser access is available. Enable a configured Gemini model in staging and run a minimal real provider test if AI explanations are needed.
5. Verify affected queries against a representative migrated database with the previous application release and its actual roles before treating a scan as a rollback approval.

## Final automated test inventory

Each test below ran through `pnpm check` (`pnpm lint`, `pnpm typecheck`, and `pnpm test`). The TAP evidence is in `final-check.log`.

1. **Verified** — scan endpoint returns live evidence without caching
2. **Verified** — scan endpoint rejects unsupported content types, invalid shapes and traversing paths
3. **Verified** — scan endpoint bounds streamed bodies and UTF-8 SQL size
4. **Verified** — browser writes use the configured public origin behind a proxy
5. **Verified** — JSON storage requests enforce byte limits without trusting Content-Length
6. **Verified** — the Gemini SDK sends only categorical evidence and validates the structured response
7. **Verified** — Gemini outage retries once and malformed output cannot override the report
8. **Verified** — per-identity, total and concurrency limits are enforced
9. **Verified** — Gemini rate limits and aborts remain bounded and preserve deterministic evidence
10. **Verified** — GitHub snapshots resolve shared clients using each revision's committed module configuration
11. **Verified** — GitHub authorization binds single-use state, uses PKCE and validates cookies before consumption
12. **Verified** — GitHub routes fail closed for missing configuration and cross-origin writes
13. **Verified** — GitHub JWT and user authorization enforce App identity and repository admin access
14. **Verified** — webhooks validate original bytes, reject forgery and bound bodies before durable acceptance
15. **Verified** — GitHub worker scans committed blobs, persists evidence and publishes a commit-scoped Check
16. **Verified** — file CLI emits SARIF and exits 1 when the threshold is met
17. **Verified** — file CLI returns 2 for invalid usage
18. **Verified** — Git CLI reads candidate blobs, scopes paths, reports removals and publishes annotations
19. **Verified** — compatibility Git CLI analyzes two tagged releases without reading the working tree
20. **Verified** — additive migration passes only within supported scope and retains Phase 1 results
21. **Verified** — recognizes Supabase table, projection and filter dependencies without confusing unrelated builders
22. **Verified** — traces async Supabase helpers through configured aliases and relative re-exports
23. **Verified** — reports unresolved clients, ambiguous helper returns and reused query builders
24. **Verified** — follows conditional Supabase builder filters and bounded logical expressions
25. **Verified** — traces bounded constant Supabase aliases without losing their later filters
26. **Verified** — uses the final projection in a direct Supabase select chain
27. **Verified** — Supabase operation matrix retains read, write and scalar-filter dependencies
28. **Verified** — query composition across functions, mutable aliases and exported builders retain coverage gaps
29. **Verified** — accepts guarded UUID and timestamp values without treating dynamic filter structure as static
30. **Verified** — retains gaps and reduces confidence for escaped or overwritten Supabase builders
31. **Verified** — logical filters reject unmodeled operators, foreign tables, malformed syntax and oversized inputs
32. **Verified** — distinguishes row-level security on a new table from a conditional or existing table
33. **Verified** — COMPAT001 confirms an unambiguous previous-release dependency
34. **Verified** — COMPAT002 confirms an unambiguous previous-release dependency
35. **Verified** — COMPAT003 confirms an unambiguous previous-release dependency
36. **Verified** — COMPAT004 keeps type and write behavior conditional
37. **Verified** — COMPAT005 keeps type and write behavior conditional
38. **Verified** — COMPAT006 keeps type and write behavior conditional
39. **Verified** — dynamic SQL, unsupported migrations and missing source yield coverage findings
40. **Verified** — empty migration diff remains scoped and exports reproducible JSON and SARIF
41. **Verified** — ambiguous joined columns stay unresolved and a baseline can disambiguate them
42. **Verified** — CTE shadowing, nested scopes, session settings and relation aliases prevent false confirmation
43. **Verified** — schema and quoted identifier identities do not collide
44. **Verified** — SELECT, INSERT, UPDATE, DELETE, JOIN, WHERE and RETURNING produce real references
45. **Verified** — restoration, conditional DDL, syntax recovery and historical edits reduce certainty
46. **Verified** — wildcard result shapes and positional inserts require review after an additive change
47. **Verified** — Prisma maps, namespaces and explicit scalar selections provide mapped dependencies
48. **Verified** — enforces supported PostgreSQL versions and bounded source inputs
49. **Verified** — matches supported DDL using PostgreSQL statement nodes
50. **Verified** — reports mixed coverage and parser failures while continuing other files
51. **Verified** — finds statements across comments, quoted identifiers and string literals
52. **Verified** — applies severity and incomplete-coverage policies independently
53. **Verified** — generates reproducible IDs and SARIF source locations
54. **Verified** — rejects invalid paths, duplicates and over-limit input
55. **Verified** — GitHub migration protects authorization, tenant links, webhook replay and worker leases
56. **Verified** — enabling RLS on an existing conditional fixture changes ordinary-role reads
57. **Verified** — tenant migration enforces role and organization isolation, transactional persistence and replay

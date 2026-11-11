# Phase 2 · Release compatibility

## Repository audit

The existing pnpm workspace contains a Next.js App Router app, the PostgreSQL AST and risk-rule package, a file CLI, a Git migration CLI, and a composite Action. The demo computes findings from five SQL files and keeps history in browser memory. `POST /api/scan` accepts bounded SQL text. The Git CLI reads candidate migration blobs and emits JSON, SARIF and Actions annotations. Phase 1 reports set application compatibility to `unknown`. The project contains no Supabase migrations, authentication, persistence, or Gemini client.

Before edits, `pnpm check` passed lint, strict TypeScript and all 12 tests. `pnpm build` generated the production app successfully. This workspace is a source directory without `.git`. Integration tests use temporary repositories with real commits and tags.

## Implementation order

1. Define a versioned compatibility report alongside Phase 1 reports and keep object identity structured from the PostgreSQL AST.
2. Read both Git revisions as bounded blobs. Track migration and source additions, changes, renames and removals without switching the checkout.
3. Resolve supported SQL and Prisma references from source syntax. Record unresolved constructs as coverage gaps.
4. Evaluate previous-release effects and report proposed-release evidence separately. Keep severity, compatibility status and confidence independent.
5. Expose the analyzer through the CLI, the existing GitHub Action and the existing workspace. Exercise the real entry points with fixtures and regression tests.
6. Implement platform persistence and AI after compatibility verification, subject to available infrastructure and credentials.

## Completed

- The standalone compatibility analyzer compares Git snapshots, binds supported PostgreSQL query references from TypeScript, JavaScript and Prisma, and matches them to AST-derived migration changes. It records both release graphs, source locations, severity, confidence and explicit coverage gaps.
- The `compatibility` CLI produces JSON, human-readable reports and SARIF with strict policy exits. The composite Action can run that command against a configured previous release and produce annotations and artifacts. The Phase 1 commands and migration rules remain available.
- The existing workspace displays compatibility status, previous-release evidence, migration links, and real demo results. It can rerun the demo comparison and open CLI reports locally.
- The optional team workspace implements password signup, sign-in, sign-out, reset and session handling, with organization and repository management. Supabase stores imported scans, release references, findings, evidence, coverage, reviews and audit events. History is paginated and available after reload.
- Optional Gemini explanations use the official server-side SDK with a configurable model, minimized input, validated output, rate limits, bounded retry, timeouts, and numeric usage logging. Scanner results remain available during provider failure.

## Files changed

| Area               | Files                                                                                                                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Analysis           | `packages/scanner-core/src/compatibility/`, typed targets in `contracts.ts`, AST extraction in `postgres.ts`, and shared identifier formatting                                 |
| CLI and workflow   | `packages/cli/src/compatibility*.ts`, `git-read.ts`, `github-report.ts`, existing Git command, `integrations/github-action/action.yml`, and `.github/workflows/migrations.yml` |
| Existing workspace | `apps/web/app/workspace/`, compatibility API and components, report validation, and synthetic release fixtures                                                                 |
| Team and storage   | `apps/web/app/auth/`, `apps/web/app/team/`, `apps/web/app/api/scans/`, `apps/web/lib/supabase/`, `proxy.ts`, and `supabase/migrations/20261111105615_rollbackiq_tenants.sql`   |
| Gemini             | `apps/web/lib/gemini.ts`, explanation endpoint and UI, request limits and provider tests                                                                                       |
| Setup and tests    | Package manifests and lockfile, `.env.example`, Supabase local config, `tests/tenancy.test.ts`, README and the configuration guides                                            |

## Verification

- `pnpm install --frozen-lockfile`, `pnpm check`, and `pnpm build` passed. All 36 automated tests passed, including existing Phase 1 regressions.
- Git integration tests created tagged releases, exercised strict policy and missing references, and checked shallow history, exact renames, binary inputs, working-tree preservation and SARIF.
- Desktop and mobile Chrome smoke tests verified the existing SQL scanner and the compatibility workspace, including evidence navigation, a live demo comparison and import of a report from actual Git tags.
- The Supabase migration ran in PostgreSQL through PGlite. Tests covered role permissions, cross-tenant reads and writes, composite foreign keys, idempotency and audit entries. A browser smoke test using a local Supabase protocol fixture with those same policies verified sign-in and sign-out, HttpOnly cookies, repository creation, report import and reload, and cross-tenant API denial. The browser test also caught a proxy-origin mismatch, which is covered by an origin regression test.
- A mocked Gemini HTTP response exercised the official SDK request, response parsing and usage counters. Other tests covered retries, invalid output, and exclusion of repository-controlled text from the prompt.
- `actionlint` accepted both workflows. The composite compatibility scan step ran locally in Bash against the tagged fixture and produced the expected exit `1`, annotations, summary and JSON/SARIF artifacts. `pnpm audit --prod --audit-level high` reported no known vulnerabilities after the lockfile was updated.

## Security and limitations

Git and the scanner read committed text without running repository scripts or migration SQL. The GitHub workflow keeps the scanner checkout separate and uses read-only permissions. Team data is gated by server authentication, PostgreSQL RLS, and role checks in the write RPCs. Scan imports retain repository paths and object names inside the selected tenant. Gemini receives categorical evidence and counts only.

The Prisma parser version supports the workspace’s Node.js runtime. Its lodash dependency is pinned to the patched version 4.18.1 after the initial audit flagged the transitive package. [GitHub security advisory](https://github.com/advisories/GHSA-r5fr-rjxr-66jc)

## Remaining verification and work

This environment has no Docker or Podman and no configured Supabase or Gemini credentials. Live Supabase signup, email recovery, hosted persistence and a real Gemini request still require a configured environment. The GitHub-hosted workflow also needs a repository and a pull request to verify runner execution. The local compatibility demo and CLI are available without those services.

GitHub App linking and automated PR report ingestion are now implemented in a subsequent change; see [GitHub App setup and verification](github-app.md). Live installation, hosted Supabase persistence and actual GitHub-delivered PR scans still require configured credentials and a running worker. Automatic approval policies, notifications and advanced analytics remain follow-on work. Static coverage limits are documented in the [compatibility guide](compatibility.md). [Team workspace setup](team-workspace.md)

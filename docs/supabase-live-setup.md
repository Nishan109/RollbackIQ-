# Supabase setup verification · 2026-11-11

The Supabase MCP connection is authenticated against RollbackIQ project `fycnhkbkxhxsnukuctxb` and matches the application environment. The previously connected project was not modified.

Applied migrations, in order:

1. `20261111105615_rollbackiq_tenants.sql`
2. `20261111105623_github_app.sql`
3. `20261111110013_private_storage_hardening.sql`

Local filenames match the versions recorded by Supabase MCP. Do not rerun these migrations manually in the SQL editor; they are already applied. Use the normal linked Supabase CLI migration workflow for future changes.

The database contains 13 public application tables and three private GitHub storage tables. Public reads require authenticated organization membership through RLS. Anonymous users have no table access. Authenticated clients cannot write directly to the application tables. The GitHub service RPC is executable only by `service_role`; it also checks organization roles for user-initiated actions. Private GitHub storage denies client access through grants and RLS while the owner-executed RPC retains access.

Local PostgreSQL tests cover tenant isolation, authorization expiry/replay, duplicate webhook handling, report ingestion, worker leases/retries and disconnect behavior with the hardened schema. No application account, organization, repository or installation was created by these schema migrations.

After deployment, MCP catalog checks confirmed 16 tables with RLS, zero anonymous-readable tables, zero directly client-writable tables and a server-only GitHub RPC. `pnpm check` passed lint, strict TypeScript and all 42 tests. The security advisor has no warning/error findings; its three informational no-policy notices describe the intentionally inaccessible private tables. The performance advisor has no remaining unindexed-foreign-key findings; unused-index notices are expected in the newly created, empty database. References: [private RLS notices](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) and [unused-index notices](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index).

Remaining application setup:

- Resolve the local Node.js HTTPS trust issue (`UNABLE_TO_VERIFY_LEAF_SIGNATURE`). The Node executable used by the app was version 22.13.1 when checked. Windows HTTPS requests worked, but Node requests did not. Use a supported Node LTS release with system-CA support and launch app/worker with `NODE_USE_SYSTEM_CA=1`, or configure a trusted CA through your normal development environment. Keep certificate validation enabled.
- Restart the web app and worker with the configured environment.
- Create/sign in to the application account, verify email as required, create an organization and connect GitHub.
- Confirm the App's callback/setup URLs, public HTTPS webhook URL and matching webhook secret. The verified GitHub App slug in the environment is `rollback-iq`.
- Complete a real repository installation and pull-request scan. Those end-to-end flows are not established by successful schema deployment.

See [GitHub App setup](github-app.md) and [team workspace setup](team-workspace.md).

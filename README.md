# RollbackIQ

**Know Your Rollback Risk Before You Deploy.**

RollbackIQ compares a proposed PostgreSQL migration plan with database dependencies in a previous application release. It uses PostgreSQL and TypeScript syntax trees to trace findings to migration operations and application source locations. The CLI, GitHub Action, and workspace share the same analyzer.

## Run locally

Requirements are Node.js 22.13 or later, pnpm 11.25.0, and Git 2.47 or later for commit comparison. Local scanning requires no credentials or database.

```bash
npm install --global pnpm@11.25.0
pnpm install --frozen-lockfile
pnpm dev
```

Open `http://localhost:3000/workspace` for your own SQL scans and Git reports. **New scan** analyzes pasted PostgreSQL SQL, and **Import report** opens a compatibility JSON report from the CLI. **View demo** opens the synthetic Acme Commerce example at `/workspace/demo`. Local reports stay in the current tab. The optional team workspace saves reports to Supabase.

```bash
pnpm --silent scan examples/demo-saas/migrations/002_drop_legacy_tier.sql
pnpm --silent scan --format sarif --fail-on high --fail-incomplete examples/demo-saas/migrations/002_drop_legacy_tier.sql
pnpm --silent compatibility --repo /path/to/checkout --previous v1.0.0 --proposed HEAD --migrations db/migrations --sources src --fail-on high --strict --output-dir rollbackiq-output
pnpm check
pnpm build
pnpm start
```

The first SARIF example emits a report and exits `1` because PG002 meets the threshold. Run `pnpm compatibility --help`, `pnpm scan --help`, or `pnpm scan:git --help` for options.

## Project guide

- [Architecture decision, folder layout, data model, interfaces and milestones](docs/architecture.md)
- [Scanner coverage, exit codes and REST API](docs/scanner.md)
- [Previous-release compatibility and evidence limits](docs/compatibility.md)
- [Team workspace, Supabase and Gemini configuration](docs/team-workspace.md)
- [Install and configure GitHub Actions](integrations/github-action/README.md)
- [Connect the GitHub App and run the PR scan worker](docs/github-app.md)
- [Acme Commerce migration fixtures](examples/demo-saas/README.md)
- [Phase 1 implementation and remaining work](docs/phase-1.md)
- [Phase 2 audit, implementation and verification](docs/phase-2.md)

Compatibility conclusions are limited to the supported static checks and configured release and schema inputs. Rehearse deployment and rollback against a representative database before acting on a report.

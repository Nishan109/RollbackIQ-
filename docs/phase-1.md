# Phase 1 · Foundation

## Implemented

- Strict TypeScript pnpm workspace, frozen dependency lockfile, Biome linting and formatting, and a Node test runner.
- Next.js landing page and responsive demo workspace with scan submission, severity filters, searchable findings, migration source, report export, and browser-session history. Five synthetic migrations are analyzed by the actual scanner.
- Standalone PostgreSQL AST scanner with ten rule and coverage identifiers, JSON and SARIF reporting, severity gating, and incomplete-coverage detection.
- Git comparison CLI and composite Action with read-only workflow permissions, a trusted scanner checkout, Git blob analysis, annotations, and report artifacts.
- Validated demo scan API, health endpoint, local startup commands, and an architecture decision record with a proposed tenant schema.

## Files

| Area                | Files                                                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Workspace           | `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `tsconfig.base.json`, `biome.json`, `.gitignore`, `.env.example` |
| Web                 | `apps/web/app/`, `apps/web/components/`, `apps/web/lib/demo.ts`, and web package configuration                            |
| Analysis            | `packages/scanner-core/src/` for the parser adapter, contracts, rules, reports and tests                                  |
| CLI                 | `packages/cli/src/` for file scanning, Git comparison and CLI integration tests                                           |
| CI                  | `.github/workflows/ci.yml`, `.github/workflows/migrations.yml`, `integrations/github-action/`                             |
| Fixtures and guides | `examples/demo-saas/`, `README.md`, `docs/architecture.md`, `docs/scanner.md`                                             |

## Commands

```bash
npm install --global pnpm@11.25.0
pnpm install --frozen-lockfile
pnpm dev
pnpm check
pnpm build
pnpm start
```

## Verification

- `pnpm install --frozen-lockfile` installed the full workspace. A clean filtered install also ran the Git CLI used by the composite Action.
- `pnpm check` passed Biome, strict TypeScript checking, and all 12 automated tests. Tests covered rules, parser failures, SARIF, policy decisions, Git blob comparison, CLI exits, and API validation and limits.
- `pnpm build` produced the Next.js production build. Desktop and mobile Chrome smoke tests verified navigation, severity and search filters, migration evidence, a live custom SQL scan, session history, JSON export, and the health endpoint.
- `actionlint` accepted both workflows. The local Git CLI integration test verified annotation and artifact output. GitHub-hosted runner execution remains unverified.
- `pnpm audit --prod --audit-level high` completed with no known vulnerabilities reported by the registry.

## Remaining work

Application compatibility remains unknown because the current scanner operates on DDL syntax without catalog data or previous-release dependency evidence. Phase 3 adds baseline and candidate schema modeling, TypeScript and Prisma references, and evidence-based comparison.

Hosted Supabase migrations, authentication, tenant access policies, durable scan history, repository management, teams, and review state are scheduled for Phases 4–5. Gemini, hosted GitHub ingestion, billing interest and production deployment are later milestones. A live GitHub-hosted execution requires pushing the source and triggering a pull request with a relevant migration change.

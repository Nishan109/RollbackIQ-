# Phase 2.8 onboarding and dashboard release verification

Prepared on 2026-11-14. This document records release preparation; the final
deployment commit and runtime health responses are recorded during rollout.

## Release scope

Production at preparation: `379ccfd995c02ffc1ace15f09d3c1c8a838cb8b5`, worker
protocol 2. The onboarding foundation is commit
`7c61d60a118047ddb98facc0e2791b629722fe01`. This release adds the subsequent
GitHub connection and saved-dashboard fixes to that foundation.

- Account, organization, installation, repository, and scan configuration
  progress reflects saved state. Role-specific actions and empty states explain
  how to finish setup.
- GitHub authorization opens in a separate tab. Existing installations are
  discovered through the authorized user's GitHub access. Installation conflicts
  remain isolated between RollbackIQ organizations. Successful changes notify
  the original tab without polling or continuous refreshes.
- The authenticated `/workspace` dashboard loads recent saved scan metadata and
  the latest report automatically. Selecting another saved report updates its
  URL so a reload opens the same report. Repository reports have an **Open in
  dashboard** link.
- Saved scan history includes the most recent 25 reports across organizations
  visible to the user. An explicitly selected older report can also open. Team
  workspace retains access to repository history beyond that recent window.
- Manual SQL scans and JSON imports remain temporary browser-tab data. Anonymous
  scanning and the synthetic demo remain available.
- Landing, help, report tools, loading states, and responsive layouts build on the
  existing Phase 2.7 product. JSON and SARIF export endpoints remain unchanged.
- Local onboarding fixtures use disposable accounts and clearly label preview
  behavior; production continues to use Supabase authentication.

## Security and infrastructure

**VERIFIED:** dashboard metadata reads use the signed-in Supabase client and
existing organization RLS. Report bodies load through the authenticated scan API,
are schema-validated, and must match the selected scan and repository IDs.
Authenticated dashboard responses are private and not cached publicly.

**VERIFIED:** an authenticated account outside the report organization sees an
empty dashboard and receives 404 for an explicit report selection. Anonymous
report access redirects to sign-in; the scan API returns 401. Invalid scan UUIDs
return 404.

**VERIFIED:** no new database migration, dependency, credential, GitHub
permission expansion, or scanner/worker protocol change is required. Production
credentials are not included in the source upload. Existing preview deployments
do not receive production credentials.

## Validation

| Check | Result |
| --- | --- |
| `pnpm check` (lint, typecheck, regression tests) | VERIFIED: 78 tests passed |
| `pnpm build` | VERIFIED |
| Known-secret and credential-pattern source scan | VERIFIED: no matches |
| Saved Critical report opens from repository into dashboard | VERIFIED |
| Both saved GitHub reports survive full dashboard reload | VERIFIED |
| Older compatible report selection survives reload | VERIFIED |
| Latest report loads on a fresh dashboard visit | VERIFIED |
| Authenticated non-member and anonymous access boundaries | VERIFIED |
| Public demo route | VERIFIED: HTTP 200 |
| Fresh GitHub PR event for this web release | NOT TESTED: no new event required or created |
| AWS worker deployment | NOT TESTED: no AWS resources provisioned |

Browser checks used the real saved PR #2 and PR #3 reports. No PR was merged and
no migration from those QA branches was executed.

## Controlled rollout and rollback

The user's subsequent instruction authorizes pushing this release and updating
the existing Vercel production deployment. Build the exact committed source with
the existing project's production configuration, stage it without changing the
production alias, and verify its health and source identity before promotion.
Record the full candidate SHA, deployment ID, and test results in rollout
evidence. Do not substitute a different release identifier to bypass worker
checks.

The worker verifies the website's exact SHA and protocol. A matching worker must
be prepared before promotion. When the queue is idle, gracefully drain the
existing worker and start one worker from the verified candidate. Reuse the
private worker environment and tested launcher. Check `/livez` and `/readyz`
before declaring automatic scanning operational. This is a release switch, not
an AWS migration or a change to worker behavior.

If rollout validation fails, restore the previously verified Vercel deployment
and its matching worker. Leave existing database rows and additive migrations
intact. Keep server secrets and worker health ports private.

Known limitation: recent dashboard history is bounded; it is not a live queue
monitor. Refresh or revisit the dashboard to load newly completed reports.

# Product experience redesign

The account, team, repository, GitHub settings, and workspace pages now share the landing page's graphite surfaces, lavender accents, Geist typography, fine borders, and spacing.

## Changes

- Account pages use a responsive form and product introduction. Sign-in, signup, recovery, and reset modes retain their server actions and validation. Password visibility controls have explicit labels and keyboard access, and reset to hidden when the form mode changes; the form comes first in the document and on phones.
- Team pages have a shared product header, account identity, bounded activity summaries, setup progress, repository rows, and recent report/job activity. Counts reflect the records shown, with unavailable states preserved.
- Repository pages provide a latest-report entry on the first history page, clearer exports and settings actions, expandable compatibility evidence, and a job timeline. The latest-report entry does not replace a selected report or older history page.
- Dashboard surfaces, navigation, metrics, tables, dialogs, filters, and empty states follow the same theme. Mobile navigation exposes all five sections. Saved-report selection and URL persistence remain intact.
- Next.js route loading boundaries and the saved-report fetch show real skeleton states. Links and submitted forms expose pending feedback. Page-entry motion is brief; reduced-motion preferences disable the new animations. There are no artificial loading delays or refresh timers.
- Saved reports now retain their provenance in the per-migration dependency panel. Singular finding labels are grammatically correct.

## Verification

- `pnpm check`: lint, type checks, and all 78 tests passed, including tenant isolation and saved report behavior.
- `pnpm build`: production build passed.
- Browser checks covered desktop and narrow layouts (observed CSS widths of 1405, 416, and 316 pixels), account modes, password reveal/conceal, email-to-password keyboard order, all dashboard views, finding dialogs and Escape, evidence filters, repository-to-dashboard navigation, and selection persistence after refresh.
- The existing critical compatibility report still shows one finding, five previous-release queries, and zero coverage gaps. Its separate migration finding remains High; compatibility evidence remains Critical.
- Browser JSON and SARIF downloads were parsed successfully. JSON retained the incompatible verdict; SARIF was version 2.1.0.
- A temporary manual scan of `CREATE TABLE public.qa_ui_check (id bigint PRIMARY KEY);` completed with one parsed statement and zero findings. This was static analysis in the browser workflow; no SQL was executed against a database.
- Reduced-motion emulation returned `animation-name: none` for the dashboard heading. Browser checks recorded no application warnings or errors.

## Release state

This release includes the landing page and product page redesigns prepared on `codex/landing-page-redesign` for the existing RollbackIQ repository. Vercel deployment status is tracked separately from source publication. Production worker and database settings were not changed by this UI work.

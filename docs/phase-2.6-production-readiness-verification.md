# RollbackIQ Phase 2.6 production readiness verification

Verified on 12 November 2026 in Asia/Calcutta. The local hardening and automated verification are complete. After explicit approval, the production worker was recovered and all 13 Vercel variables were restricted to Production. The owner account verified the populated production dashboard and saved report. Dashboard export rollout remains pending.

## A. Production baseline

| Area | Status | Evidence |
| --- | --- | --- |
| Production web release | VERIFIED | Public `/api/health` returned HTTP 200, `status: ok`, release `f4ca757d57aca416a41f99d23a8e115eca0c7d0e` and worker protocol 2. Vercel resolves the public alias to Ready Production deployment `dpl_FRqoviuEcF4LSFsH6Ly3ouFwVTHF`. |
| Current workspace | VERIFIED | `F:\PreflightOPS` is on `main` at `2e6cc205cea338013c2f3bbd60b0903192b382a6`, with existing Phase 2.5 working changes. The separate release checkout contains the exact deployed application source. Phase 2.6 edits are local in the primary workspace. |
| Windows production worker | VERIFIED | Initial inspection found the worker stopped. After recovery approval, Node PID `24384` under PowerShell PID `42592` was the only loopback listener on port 8787. Both health routes returned HTTP 200 with the deployed release and protocol 2, including a check more than three minutes after startup. |
| Queue baseline | VERIFIED | The read-only Supabase query found 0 queued, 0 running, 0 active leases, 0 expired running leases, 4 completed jobs and 0 failed jobs. |
| Saved reports | VERIFIED | All 7 expected report IDs remain present, including `332dc489-05df-407e-bd2c-bf9f4c1d045c`. The five existing migration versions are present. |
| GitHub App | VERIFIED | Installation `180854229` is active for App `rollback-iq`, with Checks write. The QA repository remains connected and automatic scanning and Check publishing are enabled. |
| QA PR and Check | VERIFIED | PR #1 remains open and draft at `e91eb1e5f9e441ca087eb41626d90b581808dc5c`. Check `131296825331` is completed with conclusion `failure`, consistent with the configured High-severity gate. |
| Production error log review | VERIFIED | A Vercel CLI query over the previous 30 minutes returned zero error or fatal entries. An earlier two-hour query exited unsuccessfully, and the supported 30-minute query succeeded. |

[Production health](https://rollback-iq.vercel.app/api/health) · [Production deployment](https://vercel.com/nikka23s-projects/rollback-iq/FRqoviuEcF4LSFsH6Ly3ouFwVTHF) · [QA PR](https://github.com/Nishan109/Site_Audit_AI/pull/1) · [Check](https://github.com/Nishan109/Site_Audit_AI/runs/131296825331)

The verified migration versions are `20261111105615`, `20261111105623`, `20261111110013`, `20261111154108` and `20261111155003`. The production scan retains its Potentially incompatible verdict, one High-severity, low-confidence COMPAT010 finding, five previous-release queries and zero detected coverage gaps. Runtime roles and the deployed schema remain outside that static analysis.

## B. Authentication and dashboard

| Check | Status | Evidence |
| --- | --- | --- |
| Login page and existing-account sign-in | VERIFIED | The user signed in directly in the browser. The application displayed Team workspace and the authenticated account ID. |
| Session persistence | VERIFIED | A fresh Team tab and a page reload retained the authenticated Team workspace. |
| Cookie security | VERIFIED | Browser developer inspection showed the four Supabase cookie chunks use Secure, HttpOnly, SameSite=Lax and path `/`. Cookie values were excluded from output and evidence files. |
| Account membership | VERIFIED | The initial sign-in used a different account with zero organization memberships. The user then signed in with the existing QA organization owner account. The Team workspace displayed the organization, owner role and connected repository. |
| Repository and saved report authorization | VERIFIED | The authenticated non-member received 404 for the repository page and the saved scan API. The API response had private, no-store caching. |
| Saved report UI | VERIFIED | The owner opened Site_Audit_AI, viewed all seven history entries and four completed jobs, and opened report `332dc489-05df-407e-bd2c-bf9f4c1d045c`. The UI showed the correct commits, one High-severity COMPAT010 finding, low confidence, five previous-release queries, zero gaps and the saved limitations. |
| Mobile Team workspace | VERIFIED | The authenticated empty Team workspace rendered at a 390 by 844 viewport. The document width equalled 390 pixels and the main width was 358 pixels. The temporary viewport was reset. |
| Logout | VERIFIED | Signing out the initial account returned to `/auth`. Opening the saved scan API afterward returned 401 and private, no-store caching. The owner later signed in for report verification and remains signed in at the saved report. |
| Invalid session rejection | VERIFIED | A request with an invalid Supabase session cookie returned 401. |
| Expired-session renewal | NOT TESTED | Session persistence was observed. Forced expiry and refresh-token renewal were outside the available browser session checks. |
| Auth callback redirect validation | VERIFIED | An unauthenticated callback with an external `next` URL returned a local `/auth?notice=link` redirect. The handler selects fixed internal destinations. |
| Mobile report layout and populated states | VERIFIED | At 390 by 844, the populated report had a 343-pixel main width and a 375-pixel document width, within the viewport. The finding and analysis limitations expanded correctly. The viewport was reset. |
| Report persistence and repository configuration | VERIFIED | Reload preserved the selected report, exact commits and five-query count. GitHub settings displayed the connected installation, migration and source paths, baseline commit, enabled scanning and Checks, High gate and Require action policy. |
| Slow loading and forced UI errors | NOT TESTED | Normal page transitions completed. Artificial delays and production dependency failures were outside the browser checks. |

The account mismatch was resolved by signing in with the account that originally connected Site_Audit_AI. The two accounts demonstrated denied and authorized report access through the existing membership rules. Credentials were entered directly by the user in the application.

## C. JSON and SARIF exports

The deployed repository page had no saved-report download controls. The existing workspace download handled JSON, and the existing scanner library already supplied SARIF conversion. The local fix reuses that converter and the authenticated scan API.

| Check | Status | Evidence |
| --- | --- | --- |
| Local saved-report download controls | VERIFIED | The repository page now links to `/api/scans/{id}?format=json` and `?format=sarif`. The controls use the existing responsive layout styles. |
| API compatibility and authorization | VERIFIED | The API retains its existing response when `format` is omitted. Export formatting runs after the existing session check and RLS-bound scan lookup. Missing sessions return 401 and inaccessible scan IDs return 404. |
| Actual report JSON validation | VERIFIED | The actual persisted Phase 2.5 report was read through the authorized CLI and converted locally. JSON parsed, the report matched the persisted payload exactly after removing added saved-scan metadata, and all findings, evidence and coverage were retained. |
| Report and commit metadata | VERIFIED | Both formats include report ID `332dc489-05df-407e-bd2c-bf9f4c1d045c`, repository ID, saved timestamp, previous SHA `b70e3c9e234aa8237401867577917d77421d4b2b` and proposed SHA `e91eb1e5f9e441ca087eb41626d90b581808dc5c`. |
| Download headers | VERIFIED | Local responses returned HTTP 200, JSON or SARIF content types, an attachment filename containing the report ID, private/no-store caching and nosniff. |
| Actual report SARIF schema | VERIFIED | SARIF 2.1.0 output passed the SchemaStore SARIF schema with zero errors using jsonschema 4.26.0 and the schema's declared Draft 7 validator. |
| Finding mapping | VERIFIED | COMPAT010 mapped to SARIF error level at `supabase/migrations/20261111120143_rollbackiq_webhook_qa.sql`, line 5, with low confidence, message text, rule metadata and saved scan metadata. |
| Malformed inputs | VERIFIED | Regression tests reject unknown formats and malformed stored reports with bounded error messages. |
| Live export access denial | VERIFIED | Both JSON and SARIF query URLs returned 401 to signed-out production requests. The current authenticated non-member received 404 for the saved scan API. |
| Authorized production JSON API | VERIFIED | The owner received HTTP 200 and private/no-store caching from the saved scan API. Its report ID, repository, commits, verdict, finding location, severity, confidence, five-query count and zero-gap count matched the database and UI. |
| Existing production SARIF URL | FAILED | An authenticated request with `format=sarif` returned HTTP 200 with `application/json`, the ordinary scan envelope and no attachment disposition. The payload lacked SARIF version and runs. The repository page had zero download links. |
| Authorized production file downloads | BLOCKED | The tested local JSON/SARIF attachment implementation awaits deployment approval. Its actual-report converter, filenames, metadata, JSON fidelity and SARIF schema have passed local checks. |

The implementation is in `apps/web/lib/scan-export.ts`, the existing scan route, and the repository page. Regression coverage is in `apps/web/lib/scan-export.test.ts`. Schema validation tooling and generated export evidence are isolated under `%LOCALAPPDATA%\RollbackIQ\phase26-verification`.

## D. Worker reliability

At initial inspection, the worker's last recorded lifecycle event was a dependency-unavailable event after its completed scan. Its earlier exit has no confirmed cause in the available lifecycle log. The earlier pinned Codex runtime directory has disappeared following a runtime update. The updated preparation uses the portable Node runtime and a pinned pnpm installation under the private worker directory.

| Check | Status | Evidence |
| --- | --- | --- |
| Hidden-console shutdown control | VERIFIED | The previous worker exposed only SIGINT/SIGTERM handling. The recovered worker now has a private control record and the new tested stop command. |
| Local graceful stop control | VERIFIED | A private per-user control record now binds a stop marker to PID, release and approximate process start time. The stop command verifies file ACLs, process identity and owner before requesting the existing SIGINT drain handler. |
| Stop guard | VERIFIED | The Windows fixture rejected a mismatched release, left the fixture running, then accepted the correct release and observed exit code 0 and control cleanup. |
| Stop and start in isolation | VERIFIED | The hidden-control fixture ran twice successfully, demonstrating control cleanup and a subsequent start. The actual worker entrypoint smoke fixture also drained through the new marker. |
| Queue outage and recovery | VERIFIED | Two complete worker smoke runs changed a disposable queue from available to 503 and back. Readiness degraded while liveness remained available, and polling recovered. |
| Network timeout and recovery | VERIFIED | Both runs held disposable queue responses open until the client's timeout. Readiness degraded and recovered after the queue responded again. |
| GitHub failures, leases and retries | VERIFIED | The existing worker/GitHub tests and PGlite queue tests passed. They cover provider errors, Check recovery, lease renewal, expired leases, retry backoff and exhaustion, and persistence. |
| Duplicate prevention | VERIFIED | The local control test rejected a second active owner. A recovery preflight run overlapped isolated fixtures and exited 2 for duplicate detection. After fixtures exited, the same preflight passed with exit 0. |
| Logging correlation | VERIFIED | The local logger retains validated job, scan and commit IDs plus bounded numeric fields. Tests confirm arbitrary messages, tokens and invalid field values are discarded. |
| Log rotation | VERIFIED | Lifecycle logs rotate at 1 MiB, with two retained files. Tests exercised three rotations and checked the bound. Separate shell transcripts require their own retention policy. |
| PowerShell startup | VERIFIED | Explicit loading of the shell's own security module resolves the previously observed background ACL cmdlet autoload failure. The Windows stop fixture passed in system PowerShell 5.1. |
| Portable pnpm | VERIFIED | pnpm 11.25.0 was installed under `%LOCALAPPDATA%\RollbackIQ\windows-worker\runtime`; its executable returned the expected version. This path is independent of the versioned Codex runtime directory. |
| Recovery preflight | VERIFIED | After fixtures completed, the clean deployed-release checkout passed the existing preflight with exit 0 using portable Node 26.13.1, portable pnpm 11.25.0, the private worker dotenv, protocol 2 and the exact web SHA. |
| Approved production recovery | VERIFIED | The worker logged startup at `2026-11-12T16:36:42.772Z`. PID `24384` returned healthy protocol 2 and the deployed SHA at 16:39:40 UTC. Its current lifecycle log contained startup and no new errors. |
| Production shutdown and subsequent restart cycle | NOT TESTED | Recovery started a stopped worker. Controlled shutdown and a subsequent live restart would require separate approval. The complete cycle passed in isolated fixtures. |

The new local runtime code is `tools/worker-runtime.mjs`, used by the existing launcher. Its control directory must be private to the account, SYSTEM and Administrators. The new stop command is `tools/stop-rollbackiq-worker.ps1`. The implementation adds no network shutdown endpoint.

### Reviewed recovery and shutdown procedure

Use the existing release checkout to recover the current production version. The primary workspace contains export changes that require a later release, and its source guard should therefore reject the old deployed SHA. A copy of the tested local launcher tools is prepared in the exact release checkout.

The user approved startup, and the following options were used in a dedicated PowerShell session. Automatic approval review rejected the detached startup command without stating a reason. The existing launcher then ran successfully in tool session `90814`, which must remain alive. Independent operation after Codex closes remains unverified.

```powershell
Set-Location -LiteralPath 'C:\Users\nisha\.codex\worktrees\rollbackiq-vercel-release\PreflightOPS'
$workerOptions = @{
    NodePath = Join-Path $env:LOCALAPPDATA 'RollbackIQ/phase25-completion/node26/node-v26.13.1-win-x64/node.exe'
    PnpmPath = Join-Path $env:LOCALAPPDATA 'RollbackIQ/windows-worker/runtime/node_modules/.bin/pnpm.cmd'
    GitPath = 'F:\Git\cmd\git.exe'
    EnvFile = Join-Path $env:LOCALAPPDATA 'RollbackIQ/windows-worker/worker.env'
    ExpectedRelease = 'f4ca757d57aca416a41f99d23a8e115eca0c7d0e'
    AppUrl = 'https://rollback-iq.vercel.app'
    HealthPort = 8787
}
& .\tools\test-rollbackiq-worker.ps1 @workerOptions
# Continue only when preflight exits 0 and startup is approved.
& .\tools\start-rollbackiq-worker.ps1 @workerOptions
```

From a separate session, query `/livez` and `/readyz`, match the returned release and protocol, verify one loopback listener owned by the recorded Node PID, and confirm no worker errors. The queue may be claimed as soon as this worker starts.

After separate stop approval, use the corresponding release checkout's stop script with `-ExpectedRelease f4ca757d57aca416a41f99d23a8e115eca0c7d0e`. It requests draining and waits for process exit. Inspect `github_worker_draining`, `github_worker_stopped`, queue leases, the released port and a successful preflight before another startup. The same Windows mutex and duplicate process checks guard the next start. Forced process termination is outside this procedure.

The laptop must stay awake and connected for continuous processing. Queue retries and readiness handle recoverable outages while the process lives. After reboot or process exit, manual recovery requires a fresh preflight. A scheduled task or service would require separate approval and remains optional. Secrets stay in the private dotenv file rather than startup arguments.

## E. Security hardening

### Vercel scope audit and proposed changes

The initial audit found all 13 variable names scoped to both Production and Preview. After the explicit scope-change approval, all 13 were updated and independently verified as Production-only. Vercel Authentication protects generated deployment URLs, and fork protection is enabled.

| Variables | Classification | Production use | Preview requirement |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Public client configuration | Browser and server auth | An isolated Preview should use its own project configuration. |
| `APP_URL` | Server origin configuration | Auth and callback destinations | A Preview needs its own trusted origin. |
| `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_CLIENT_ID` | Non-secret App identifiers | GitHub connection and signed requests | Static UI can render with integration unavailable. |
| `SUPABASE_SERVICE_ROLE_KEY` | Privileged server secret | Worker and protected service operations | Production access requires removal from untrusted Preview scope. |
| `GITHUB_APP_PRIVATE_KEY`, `GITHUB_CLIENT_SECRET`, `GITHUB_WEBHOOK_SECRET` | Server secrets | GitHub signing, OAuth and webhook verification | A Preview needs isolated integration credentials to exercise these flows. |
| `GEMINI_API_KEY` | Server secret | Optional AI explanations | A Preview needs a separately restricted key to exercise AI. |
| `GEMINI_ENABLED`, `GEMINI_MODEL` | Server feature configuration | Optional AI feature selection | Static Preview UI can keep AI unavailable. |

**VERIFIED** for the approved scope reduction. The Vercel API changed only the target list on each existing variable. The final inventory has 13 Production variables, zero Preview variables and matching IDs, keys, types and creation timestamps. The inventory returned four deployments, all Production, with no further page. The exact plan and results are in `%LOCALAPPDATA%\RollbackIQ\phase26-verification\preview-scope-plan.json` and `approved-scope-update-results.json`. Functional Previews require isolated credentials and origins. [Vercel environment update API](https://vercel.com/docs/rest-api/projects/edit-an-environment-variable)

### Local dotenv permissions

**VERIFIED** after correction. The original web dotenv had inherited read access for Authenticated Users and Users. The file now has explicit access only for the current user, SYSTEM and Administrators. Its original owner was restored, the current account can read it, and its content hash matched before and after the ACL correction. The private worker dotenv and its parent directory already had access limited to allowed principals. The discovered files were ignored by Git and the web dotenv was absent from tracked files. The saved ACL backup contains the security descriptor only.

**VERIFIED** secret scan. The scan checked 164 source files, 28 built browser assets and 22 worker logs against five configured server secret categories. It found zero exact-value matches. Public Supabase client configuration is intended for browser use. The scan covers the local configured secret values and inspected artifacts.

### RLS, RPCs and request protections

**VERIFIED** live metadata. All 13 public application tables have RLS enabled. `rollbackiq_github_service` and `rollbackiq_github_worker` deny execution to anon and authenticated and allow service_role. Their fixed search path is empty. `rollbackiq_ingest_scan` is security invoker and available to authenticated callers, with organization and role checks in the existing persistence path.

**VERIFIED** regression coverage. The PGlite tests exercise tenant boundaries, repository permissions, transactional scan persistence, replay handling and service RPC restrictions. GitHub tests exercise installation ownership, PKCE and single-use authorization state, raw-body webhook signatures, forged requests, body limits, Check identity and severity policy. Live signed-out requests returned 401 and the authenticated account outside the QA organization received 404.

The import endpoint has per-account, total and concurrent limits using in-memory state. Those limits apply per server instance. Supabase Auth provider rate configuration and broad load testing remain **NOT TESTED**. Auth API and protected route responses use private/no-store caching and bounded messages. No production exploit or cross-tenant data disclosure was observed in these checks.

## F. Observability and product readiness

| Operator signal | Status | Evidence |
| --- | --- | --- |
| Worker startup, draining, exit and readiness errors | VERIFIED | Existing lifecycle events and both health routes were exercised in isolated runs. Local runtime changes add a supported hidden-console shutdown path. |
| Webhook acceptance and job creation | VERIFIED | The existing production webhook log records delivery, head and PR identifiers. The Phase 2.5 delivery and job remain stored. |
| Job claim, lease renewal, saved report and Check outcome | VERIFIED | The existing job row stores release, attempts, lease expiry, saved scan and Check IDs. The prior end-to-end evidence recorded their transitions. Local logging now retains validated IDs for correlation. |
| Failed jobs and exhausted retries | VERIFIED | Isolated database and worker tests cover these terminal cases. Current production has zero failed jobs. |
| Existing onboarding | VERIFIED | An authenticated account outside an organization sees the organization creation form. An organization owner must grant access to the existing QA organization before its repositories appear. |
| Populated dashboard UX and report navigation | VERIFIED | The owner followed the repository link, opened the exact saved scan, expanded finding evidence and limitations, verified settings and refreshed the report. Local export links address the missing download entry points. |
| Free monitoring | VERIFIED | The current health routes and queue metadata provide probes compatible with a manual local check. Automated external health polling or startup scheduling would require an approved setup. |

## G. Quality evidence and local deliverables

- **VERIFIED** `pnpm check` passed all 70 tests, including lint and typechecking, from `F:\PreflightOPS`.
- **VERIFIED** `pnpm build` completed successfully. A final targeted Biome check returned zero fixes.
- **VERIFIED** two actual worker smoke fixtures recovered after both a 503 outage and a request timeout and exited gracefully.
- **VERIFIED** four runtime tests covered correlation-safe logging, log rotation, two successive hidden-worker runs, duplicate control ownership and the Windows stop command.
- **VERIFIED** the exported actual saved report passed JSON fidelity checks and SARIF schema validation with zero errors.
- **VERIFIED** local dotenv ACL correction preserved its original owner and values.
- **VERIFIED** the separately approved worker recovery and Vercel scope reduction were applied and checked. Production deployment of the export changes remains **BLOCKED** pending approval.

Test logs, schema, generated actual-report exports, scope plan, ACL descriptor and preflight evidence are under `%LOCALAPPDATA%\RollbackIQ\phase26-verification`. Local schema validation used an isolated Python environment. Certificate-verified package installation used the Windows trust store. The worker pnpm runtime is pinned to 11.25.0. These tools add no production dependency or paid service.

## H. Prioritized launch checklist

1. **VERIFIED** — Approved worker recovery passed preflight and sustained readiness. The dedicated PowerShell tool session must remain running. Independent startup and a live stop/restart cycle remain operational follow-up checks.
2. **VERIFIED** — The approved scope reduction removed Preview from all 13 variables. All four existing deployment records are Production deployments.
3. **VERIFIED** — The owner account verified the populated repository, finding confidence and severity, coverage, settings, mobile layout and refresh persistence. The earlier non-member account was denied access.
4. **BLOCKED, high** — Review and approve a separate release containing the local export and worker-tooling changes. Verify authenticated JSON and SARIF downloads after rollout.
5. **NOT TESTED** — Complete explicit session-expiry/refresh testing and controlled slow-loading/error UI checks.
6. **NOT TESTED, optional** — Consider approved startup scheduling and health alerts after manual recovery is reliable. Continue to account for laptop sleep and network availability.

Phase 2.6 has verified the authenticated dashboard, tested local exports, recovered the production worker and restricted Vercel variable scopes. Production launch approval remains pending export rollout and the operational follow-up above.

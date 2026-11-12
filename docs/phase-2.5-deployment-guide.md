# RollbackIQ Phase 2.5 deployment guide

The deployment consists of the Next.js app on Vercel, the existing Supabase project and one supervised worker on a persistent host. A container on an existing Linux VM is the smallest deployment with a restart policy and private health probes. A managed container service is also suitable if it can keep one replica running and allow graceful shutdown. Use the existing approved host or choose one before provisioning. The laptop worker was used for local verification. The hosted worker and Docker image are pending verification.

## Environment settings

Set Vercel variables for the intended deployment environment and worker variables in the host's secret manager. See [the environment template](../.env.example). Use HTTPS for both origins in production and select the same Supabase project in both services.

| Location | Variables |
| --- | --- |
| Web and worker | `APP_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_CLIENT_ID`, `GITHUB_APP_PRIVATE_KEY` |
| Web only | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `GITHUB_CLIENT_SECRET`, `GITHUB_WEBHOOK_SECRET` |
| Worker | `ROLLBACKIQ_WORKER_PRODUCTION=true`, `ROLLBACKIQ_RELEASE=<full Git SHA>`, `WORKER_HEALTH_PORT=8080`. The container binds to `0.0.0.0` for private host probes. A directly supervised process can keep `WORKER_HEALTH_HOST=127.0.0.1`. |
| Release identifier on Vercel | Expose `VERCEL_GIT_COMMIT_SHA` or set `ROLLBACKIQ_RELEASE` to the full Git SHA when Vercel supplies no commit variable. |
| Optional Gemini on the web | `GEMINI_ENABLED`, `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_USER_DAILY_LIMIT` and `GEMINI_TOTAL_DAILY_LIMIT`. Defaults are disabled, 10 explanations per user per UTC day and 100 across the project. |

The worker needs a valid RSA App key of at least 2048 bits. It receives only GitHub App and database credentials. It does not use the OAuth client secret, webhook secret or Gemini credentials. Keep server keys and the worker health port private. [Vercel system environment variables](https://vercel.com/docs/environment-variables/system-environment-variables)

## Release and smoke test

1. Review the pending Phase 2 and Phase 2.5 changes, then identify an approved commit and tag. Run `pnpm install --frozen-lockfile`, `pnpm check`, and `pnpm build` from that commit. Build the worker from the same checkout and publish its immutable image digest to an approved registry. Start with one replica and measure memory and CPU on a representative repository before sizing the host. A 1 vCPU and 1 GiB staging allocation is an initial estimate.

   ```sh
   release=$(git rev-parse HEAD)
   docker build -f Dockerfile.worker --build-arg ROLLBACKIQ_RELEASE="$release" -t "rollbackiq-worker:$release" .
   ```

2. Verify the linked Supabase target and review the migration plan with `supabase db push --remote --dry-run` using Supabase CLI v3. After approval, apply the migrations in filename order. On the project audited here, `20261111154108_github_worker_operations.sql` adds Check state and the worker RPC. `20261111155003_gemini_daily_budget.sql` adds the explanation budget. Confirm both entries in the target migration history. The additions keep the previous web RPC and reports readable. [Supabase migration CLI](https://supabase.com/docs/reference/cli/supabase-db-push)
3. Drain and stop the old worker, deploy the new web app and verify its `/api/health` returns the selected Git SHA and `workerProtocol: 2`. Start the matching worker with the service manager or run the immutable container image. Configure restart on failure, a minimum of one replica and a stop grace of at least 240 seconds. Keep the worker on a private network. Use `/livez` for liveness and `/readyz` for queue and release readiness. Verify both return HTTP 200 and `/readyz` shows the selected release and protocol `2` before sending a QA event.

   ```sh
   docker run -d --name rollbackiq-worker --restart unless-stopped --stop-timeout 240 \
     --env-file /path/to/secured/worker.env "rollbackiq-worker:$release"
   ```

   An existing Linux service manager can also run Node 22.13 or newer. Run `pnpm --filter @rollbackiq/web... install --prod --frozen-lockfile` at the checkout root, then `node --import tsx scripts/github-worker.ts` with `apps/web` as the working directory and the production worker environment injected.

4. In the approved [GitHub App settings](https://github.com/settings/apps/rollback-iq), confirm the active webhook points to the deployed `/api/github/webhook` and subscribes to **Pull request** events. Keep **Contents**, **Metadata** and **Pull requests** at read-only. With owner approval, set **Checks** to **Read and write**, then approve the updated permissions on the existing installation. In RollbackIQ, refresh installation access and enable **Publish GitHub Checks** for the QA repository. Keep the gate at High with **Require action** for incomplete coverage for the first test. [GitHub App permission updates](https://docs.github.com/en/apps/maintaining-github-apps/modifying-a-github-app-registration#changing-the-permissions-of-a-github-app) · [GitHub Checks API](https://docs.github.com/en/rest/checks/runs#create-a-check-run)
5. In GitHub connections, verify the QA repository points at `supabase/migrations`, sources `src` and previous release `b70e3c9e234aa8237401867577917d77421d4b2b`. With authorization for a fresh QA event, push an agreed comment-only change to the existing [draft QA PR](https://github.com/Nishan109/Site_Audit_AI/pull/1). Verify HTTP 202 for its `synchronize` delivery, a single job on the exact new head, a saved report, and a Check linked to that report. For the existing fixture and default gate, expect one High RLS warning, compatibility `potentially_incompatible` and Check `failure`. Use the report's actual evidence and counts to validate the result. Leave the PR in draft.
6. For approved Gemini staging only, configure `GEMINI_ENABLED=true`, a staging API key and an explicit model. Set `ROLLBACKIQ_GEMINI_STAGING=true` in the staging test shell and run `pnpm --filter @rollbackiq/web gemini:verify --live`. The script checks model support then makes one synthetic generation attempt. After success, request one explanation from a disposable staging identity and check that the result and compatibility decision remain separately labeled. [Gemini models API](https://aistudio.google.com/api-reference/models)

## Monitoring

- Query `public.github_jobs` with an authorized read-only operator connection. Alert on persistent queue age, stalled running jobs, a growing failed-job count or repeated Check errors. Track scan time from `github_job_completed.duration_ms`; use `updated_at - created_at` for terminal job time including waiting and publication retries.
- Track `github_webhook` non-2xx by `status` and `reason`. Use `request_id` and `delivery_id` to find the delivery. Use `repository_id`, `pull_number` and `head_sha` to join to worker logs, then follow `job_id`, `scan_id`, `attempt` and `release` through the dashboard and worker.
- Track `github_check_unpublished` and failed or blocked `check_state` values by `check_error`. Monitor `/livez` and `/readyz` separately. For `github_worker_unavailable`, compare web release, queue protocol and worker release before restarting.
- Track `gemini_explanation` outcomes, duration and attempts. Watch throttling and provider errors independently of scan completion. Keep runtime logs access-controlled because repository IDs, PRs and commit SHAs describe customer activity.

```sql
select status, count(*) as jobs, min(created_at) as oldest_created_at
from public.github_jobs
group by status;

select check_state, check_error, count(*) as jobs
from public.github_jobs
where updated_at >= now() - interval '1 hour' and check_state in ('blocked', 'failed')
group by check_state, check_error;
```

## Troubleshooting and rollback

| Symptom | Response |
| --- | --- |
| Frontend rollout fails | Stop or drain the new worker. Restore the prior Vercel deployment and its matching worker release. Confirm webhook delivery, queue health and existing report reads. Keep additive migrations in place. |
| Worker crashes or readiness returns 503 | Check the worker's release, `APP_URL`, Supabase connectivity, RPC protocol and private health response. Restart with the supervisor. An expired lease becomes eligible for recovery, subject to the retry limit. Existing job and report IDs support resuming Check publication. |
| Webhook returns 401 or 503 | A 401 indicates signature validation failed. Compare GitHub and web secret configuration without logging it. A 503 indicates queue persistence failed. Confirm Supabase availability before using an authorized redelivery. |
| GitHub Check is blocked or fails to publish | Open the job and saved report. Missing permission requires an App registration change. Installation approval requires approval on the installed App. Rate limits and transient API errors retry automatically. After the cause is resolved, an approved new QA commit can produce a fresh Check. |
| Supabase is temporarily unavailable | Restore database access and wait for readiness to recover. Check queued jobs and failed webhook deliveries. Use approved redelivery for rejected deliveries. |
| Gemini is unavailable | Use the deterministic report. Review the explanation outcome, selected model and budget. An authorized web environment change can disable Gemini while the provider recovers. |
| A migration introduces a schema problem | Pause the affected rollout and inspect the migration history, error and affected rows. Restore compatible application and worker releases when possible. Review a forward corrective migration before applying it. Treat database restore as a separately planned operation. |

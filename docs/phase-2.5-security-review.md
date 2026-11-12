# RollbackIQ Phase 2.5 security review

## Authentication and tenant isolation

| Control | Status and evidence |
| --- | --- |
| Session lifecycle | **VERIFIED locally.** Playwright exercised a disposable identity against the app and a Supabase HTTP fixture. Invalid credentials were rejected, valid sign-in reached the team page, the fixture observed token refresh, and sign-out redirected to the authentication page. An expired session with an invalid refresh token returned HTTP 307 to `/auth` for `/team` and HTTP 401 for scan creation. |
| Browser-origin and session enforcement | **VERIFIED locally.** A malformed cookie returned HTTP 401 on scan creation. A cross-origin request to the GitHub configuration endpoint returned HTTP 403. |
| Tenant, role and persistence policies | **VERIFIED in disposable PostgreSQL.** The regression suite applied the repository migrations and checked organization and repository isolation, membership roles, unauthorized writes, replay protection, saved scans and worker finalization with a current lease. The worker rejects stale leases and checks that the connection, installation, repository and organization match before acting. |
| Privileged queue and budget RPCs | **VERIFIED in disposable PostgreSQL.** Anonymous and authenticated roles could not execute the new RPCs. The service role could use them. The budget table uses RLS without client policies. The tests enforced both daily limits. |
| Hosted database | **VERIFIED read-only.** Supabase MCP showed three existing migrations. The two new migrations are pending. The advisor's three private GitHub table notices reflect deliberate deny-by-default RLS. |
| Hosted password protection | **FAILED.** The hosted Supabase advisor reported leaked-password protection disabled. Users may choose passwords known to have been exposed elsewhere. With authorization, enable **Prevent the use of leaked passwords** in Supabase Auth settings if the project plan supports it. Supabase lists this feature on Pro and above. [Supabase password security](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) |
| Hosted auth smoke test | **BLOCKED.** Requires an authorized disposable identity in the target environment. |

## GitHub trust boundaries

- **VERIFIED with mocks and database tests.** Webhooks authenticate the bounded raw request body with HMAC before parsing JSON, then deduplicate the delivery and job. Invalid signatures and malformed or oversized requests fail. Logs contain request and delivery identifiers, status and timing.
- **VERIFIED read-only.** Both the GitHub App and its installation grant read-only Contents, Metadata and Pull requests access. The existing QA PR is open and draft. A historical delivery for that PR received HTTP 202. Check creation requires `checks:write` on the App and approval by the installation owner. [GitHub Checks API](https://docs.github.com/en/rest/checks/runs#create-a-check-run)
- **VERIFIED with mocks.** Installation tokens are scoped to the selected repository. The worker verifies the repository and exact head, refreshes an expired token once and stops on stale or unavailable PRs. Check recovery verifies App ID, commit and job ID before updating an existing run.

## Secrets

- **VERIFIED locally.** `apps/web/.env.local` is ignored by Git. No tracked `.pem` or `.key` files were found. An exact-value scan of 144 source and repository files and 17 generated client assets found none of the configured Supabase server key, GitHub OAuth client secret, GitHub App private key, webhook secret or Gemini API key. The scan checked PEM content and escaped values as well as plaintext. This test covered the checked-out files and this production build.
- **VERIFIED locally.** The local web environment had a Supabase URL and publishable key, a server key, GitHub App credentials and a Gemini API key. Gemini was disabled and the model was unset. The worker can run with the App signing key and database server key, keeping the OAuth and webhook secrets in the web environment. The Docker build context excludes `.env*`, `*.pem` and `*.key` files.
- **BLOCKED for rotation verification.** A Supabase server key, GitHub App signing key, GitHub OAuth client secret and GitHub webhook secret were shared earlier in the chat. Rotate any still-active exposed keys and verify retirement of the old values. The earlier webhook rotation was reported. Rotation of the other three categories remains unverified. Schedule the webhook secret change together with the web environment change to limit delivery failures. Verify current credentials through the host secret managers without copying values into logs or documentation.
- **NOT TESTED.** The Vercel production environment's stored variable scopes, historical Git revisions, the actual hosted worker secret store and provider-side rotation history were outside the local secret scan. Verify those settings and the host's access controls before deployment.

## Gemini data and quota boundaries

**VERIFIED with mocks and disposable PostgreSQL.** The explanation endpoint authenticates the actor, checks scan access through RLS and validates the selected finding before reserving quota. The provider receives normalized finding metadata and no repository text, migration comments, database object names or raw credentials. The UI reads evidence and object names from the deterministic report. The provider is time-bounded and accepts structured validated output. Provider failures return an explanation status and leave scan results usable. Gemini logs include an outcome, attempts, latency and request and scan identifiers.

**BLOCKED for live staging verification.** Use an approved staging key and model. Run one synthetic explanation after verifying model support, and then verify the staging UI with a disposable identity. [Gemini models API](https://aistudio.google.com/api-reference/models)

# Team workspace setup

The demo workspace and local CLI run without Supabase or Gemini. The team workspace supports password authentication, organization membership, repository metadata, scan imports, paginated history and reviews.

## Configure Supabase

1. Start a local Supabase stack with `supabase start` from the repository root using the Supabase CLI and a supported container runtime. For a hosted project, review and apply the SQL in `supabase/migrations/` to that project through your normal migration process.
2. Copy `.env.example` to `apps/web/.env.local`. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` from the selected Supabase project. Set `APP_URL` to the exact site origin before starting or building Next.js. Use an HTTPS origin in production.
3. In Supabase Auth, set the Site URL to `APP_URL` and allow `/auth/callback` and `/auth/callback?flow=recovery` at that origin. Use the signup email confirmation and password reset flows. For token-hash email templates, set the confirmation link to `{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=email` and the recovery link to `{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=recovery`. The callback also supports PKCE code exchange. Use the local Supabase mailbox when testing local email. [Supabase password authentication](https://supabase.com/docs/guides/auth/passwords) · [Supabase redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls)
4. Restart Next.js, open `/team`, create an account, verify it if configured, and sign in. Create an organization and a repository record. An owner can grant access to existing accounts using the account IDs shown in each member’s team workspace.
5. Run `pnpm compatibility` against a Git checkout. Open the corresponding team repository and select **Save report** to upload the JSON report. Refresh the page to inspect persisted history. A viewer can read reports. Developers can import and review. Admins can also add repositories. Owners can manage membership.

The app uses the signed-in session and publishable key for normal Data API access. PostgreSQL RLS checks tenant membership and narrowly scoped RPCs authorize writes. Scan import, findings, evidence, coverage and audit entries are written in one transaction. Reimporting the same validated report into the same repository returns the existing scan ID. Report imports require both commit IDs and a request below 2 MiB. [GitHub App connection and automated PR scans](github-app.md) use an additional migration, server-only service-role operations and a separate worker. Automatic approval policies remain separate work.

| Route                                                  | Behavior                                                                   |
| ------------------------------------------------------ | -------------------------------------------------------------------------- |
| `GET /api/scans?repositoryId=<uuid>&cursor=<optional>` | Lists up to 25 authorized scans with a keyset cursor.                      |
| `POST /api/scans`                                      | Saves `{ "repositoryId": "…", "report": { … } }` for an authorized writer. |
| `GET /api/scans/<uuid>`                                | Returns an authorized scan and its stored report.                          |
| `POST /api/scans/<uuid>/explain`                       | Requests an optional explanation of an authorized scan.                    |

## Configure Gemini

Set `GEMINI_ENABLED=true`, a server-only `GEMINI_API_KEY`, and `GEMINI_MODEL` to a model available to your account that supports structured output. Restart the app and use **Explain this scan** on a saved report. The Google Gen AI SDK sends rule categories, statuses, confidence and evidence counts. Names, paths, comments, raw SQL, source and commit identifiers stay out of the prompt. The response is validated and displayed as generated guidance. Provider failure leaves deterministic results available. [Google Gen AI SDK structured output options](https://googleapis.github.io/js-genai/release_docs/interfaces/types.GenerateContentConfig.html)

Each app process allows up to three explanation requests per identity per minute, twenty total per minute, and three concurrent requests. The server logs numeric token usage when the provider supplies it. A retry is bounded to one additional request for transient failures. Multi-instance deployments require shared rate limits and provider quota controls for global budgets.

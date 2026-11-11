# Scanner and API

## Local files and Git

```bash
pnpm --silent scan --fail-on high --fail-incomplete path/to/migration.sql
pnpm --silent scan --format sarif path/to/migration.sql > rollbackiq-report.sarif
pnpm --silent scan:git --repo /path/to/checkout --base main --head HEAD --path prisma/migrations --fail-on high --fail-incomplete --output-dir ./rollbackiq-output
```

`--fail-on` accepts `critical`, `high`, `medium`, `low`, `info`, or `none` and includes the selected severity and all higher severities. Both gates are opt-in for the CLI. The composite Action defaults to `high` and incomplete-coverage blocking. The CLI emits JSON by default. Git mode resolves two commit refs, considers changed `.sql` files in the configured directories, and reads candidate blobs. It analyzes an entire changed migration file. Skipped entries list deleted, non-regular or over-limit candidates. A Git comparison with zero scannable files includes `report: null`.

| Exit | Meaning                                                                         |
| ---- | ------------------------------------------------------------------------------- |
| `0`  | Configured policy passed. Inspect report coverage and findings.                 |
| `1`  | Policy blocked on severity or incomplete coverage. The report is still emitted. |
| `2`  | Usage, input or runtime failure.                                                |

The file and Git CLIs accept up to 50 files, 256 KiB per file, and 1 MiB of UTF-8 SQL combined. Analysis stops within a file at 1,000 statements or 2,000 normalized operations and records incomplete coverage when additional operations remain. Paths in reports use forward slashes and `.sql` extensions.

## Coverage and interpretation

Rules recognize table and column removals, column renames, type changes, `SET NOT NULL`, constraint additions and removals, and index additions and removals. A plain nullable column addition is recorded as an operation. PG008 marks unique index creation or index removal for write or query-plan review. PG900 marks unsupported statements and subcommands. PG901 marks files the parser rejected. Line and column positions anchor findings to the statement. Multiple changes in one statement may share a location.

The pinned parser targets PostgreSQL 18 syntax. A parsed statement can still fail against the actual catalog, data or server version. The migration-only scanner does not connect to a database or execute migration SQL. Its `compatibility` field remains `unknown`. Use the separate release comparison command for SQL and Prisma source evidence. A covered file indicates that the active rules handled the statements within their scope. [Previous-release compatibility](compatibility.md)

## REST API

`GET /api/health` returns HTTP 200 with `{"status":"ok"}` while the web process can serve requests.

`POST /api/scan` accepts `application/json`. Send one to five unique relative `.sql` labels with nonempty PostgreSQL text. SQL labels are report locations. The endpoint reads no caller-supplied filesystem paths.

```json
{
  "files": [
    { "path": "migrations/002.sql", "sql": "ALTER TABLE public.accounts DROP COLUMN legacy_tier;" }
  ]
}
```

A successful response includes `{ "report": { ... }, "durationMs": 5 }`. A syntax error is represented in the report with `coverage: "parse-error"` and PG901. The response is sent with `Cache-Control: no-store`. Submitted SQL is held in memory to compute the result. Reports include database identifiers derived from SQL.

| Status | Meaning                                                |
| ------ | ------------------------------------------------------ |
| `400`  | Invalid JSON, UTF-8 or request schema.                 |
| `408`  | Request body timed out.                                |
| `413`  | Request exceeds 64 KiB or combined SQL exceeds 32 KiB. |
| `415`  | Unsupported content type.                              |
| `429`  | Demo process is at its concurrency or request limit.   |
| `500`  | Analyzer failed.                                       |

The demo API uses a process-local window of 60 requests per minute and four concurrent requests. A hosted deployment still needs authenticated tenant limits, shared storage, and abuse controls. Browser cancellation abandons the HTTP result. Server-side job cancellation is planned with hosted job processing.

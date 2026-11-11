# GitHub Actions

The composite Action scans changed PostgreSQL migrations and can compare previous-release application dependencies. It writes a job summary, emits up to 50 annotations, and saves JSON and SARIF reports. The repo workflow in `.github/workflows/migrations.yml` enables compatibility mode for demo migrations on pull requests targeting `main` after the action exists on that branch.

## Install in a consumer repository

1. Push this RollbackIQ source to a repository your Actions runner can read. Copy the full SHA of a reviewed commit.
2. Create `.github/workflows/rollbackiq.yml` in the repository containing your migrations. Replace `OWNER/ROLLBACKIQ` and `VERIFIED_ROLLBACKIQ_COMMIT_SHA` with the scanner repository and reviewed SHA. Change the migration directory to match the project.
3. Open a pull request containing a migration change. Check the RollbackIQ job summary, annotations, and report artifact.

The sample assumes the scanner checkout is public or available to the consumer job. A private cross-repository checkout requires a separately designed read-only access arrangement. The foundation workflow uses only the default read-only job token.

```yaml
name: RollbackIQ migration preflight
on:
  pull_request:
    paths: ["prisma/migrations/**"]
permissions:
  contents: read
jobs:
  scan:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803
        with:
          repository: OWNER/ROLLBACKIQ
          ref: VERIFIED_ROLLBACKIQ_COMMIT_SHA
          path: .rollbackiq-tool
          persist-credentials: false
      - uses: actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803
        with:
          path: candidate
          fetch-depth: 0
          persist-credentials: false
      - uses: ./.rollbackiq-tool/integrations/github-action
        with:
          repo: candidate
          base: ${{ github.event.pull_request.base.sha }}
          head: ${{ github.sha }}
          migration-directory: prisma/migrations
          analysis-mode: compatibility
          source-directories: src
          fail-on: high
          fail-incomplete: "true"
      - if: always()
        uses: actions/upload-artifact@b7c566a772e6b6bfb58ed0dc250532a479d7789f
        with:
          name: rollbackiq-report
          path: rollbackiq-output/
          if-no-files-found: ignore
          retention-days: 7
```

The scanner and dependencies come from the trusted checkout. The candidate is read as Git objects. Keep checkout credentials disabled, retain read-only permissions, and keep secrets out of this pull request job. The report can contain private table, column and path names. Artifact access follows the repository's visibility and permissions. Hosted report upload and GitHub App ingestion are later milestones. [GitHub Actions secure use](https://docs.github.com/en/actions/reference/security/secure-use)

In compatibility mode, `previous` defaults to `base`. Supply a deployed release tag or SHA as `previous` when the PR base differs from the version you would roll back to. Keep `fetch-depth: 0` so the prior commit and tags are available. Use a comma-separated `source-directories` list and optionally provide `prisma-schema`, `schema-baseline` and `default-schema`. Missing history, unmodeled input and analyzer errors fail according to the policy. `analysis-mode: migrations` retains the Phase 1 output.

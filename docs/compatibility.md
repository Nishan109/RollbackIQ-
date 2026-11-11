# Previous-release compatibility

## Compare a real Git repository

```bash
pnpm --silent compatibility --repo /path/to/checkout \
  --previous v1.0.0 --proposed HEAD \
  --migrations ./db/migrations --sources ./src --sources ./services \
  --default-schema public --postgres 18 \
  --fail-on high --strict --output-dir rollbackiq-output
```

`--previous` selects the application release that would run after rollback. `--proposed` selects the release whose migration changes will be applied. Use a Git tag, commit SHA, branch, or valid commit expression. The command resolves both references to commits. Fetch missing commits and tags before scanning a shallow checkout. The CLI reads Git objects without checking out either revision, running repository code, or fetching objects from a remote.

Repeat `--sources` for each application directory. The default is `src`. Use `--prisma prisma/schema.prisma` for an explicit tracked Prisma schema location, or allow auto-detection at that path. `--schema db/schema.sql` reads a tracked previous-release catalog containing simple `CREATE TABLE` definitions and uses it for column binding. The `--postgres` option currently accepts `18`, the syntax version of the parser. Set `--default-schema` to the application’s expected schema for unqualified names.

Output formats are `json`, `text` and `sarif`. `--output-dir` saves JSON and SARIF regardless of the output format. Exit `0` means the configured policy passed, `1` means it blocked and the report is available, and `2` means configuration or analysis failed. `--fail-on` includes the selected severity and higher severities across migration and compatibility findings. `--strict` or `--fail-incomplete` also blocks uncovered analysis. A missing previous release produces a `COMPAT009` error on stderr with exit `2`.

## Interpret the evidence

| Status                           | Meaning                                                                                                                                                                                             |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Incompatible                     | A supported previous-release query names a table or column removed by the modeled plan. The query would fail to resolve that object if the plan is applied under the configured schema assumptions. |
| Potentially incompatible         | The evidence indicates a possible conflict, such as a type change, writer dependency, positional query, or conditional migration.                                                                   |
| Compatible within analyzed scope | The supported checks completed and found no conflicting operation in the migration diff. This conclusion covers only the analyzed inputs.                                                           |
| Unknown                          | A coverage gap prevents a complete conclusion and the analyzer did not establish a definite conflict. Individual potential findings can still be present.                                           |

Severity and evidence confidence are independent. A known incompatibility can coexist with unrelated coverage gaps. A changed migration that existed in the previous tree needs execution-history review. A later operation that recreates an affected column lowers certainty about the final schema. The report includes both revisions, migration and source changes, dependency graphs, and previous/proposed evidence for matching findings.

## Supported scope

- The analyzer parses UTF-8 TypeScript and JavaScript and reads direct string literals or static templates passed to `db.query`, `pool.query`, `client.query`, `pg.query`, and `connection.query`. A static `{ text: ... }` query option and direct Prisma raw SQL literals are supported. Scoped `.sql` source files are analyzed as SQL scripts.
- PostgreSQL AST binding covers simple `SELECT`, `INSERT`, `UPDATE`, and `DELETE`, with table aliases, schema-qualified names, join predicates, `WHERE`, and `RETURNING`. Ambiguous unqualified columns require a matching catalog or are reported at reduced confidence. CTEs, nested SQL scopes, set operations, dynamic SQL, and ordering or grouping alias resolution require manual review.
- Prisma support covers direct `prisma.<model>` find, create, update and delete calls with literal options. It reads `@map`, `@@map` and `@@schema`. Explicit scalar field references can provide strong evidence. Implicit Prisma result shapes have reduced confidence. Nested relation queries, generated clients, aliases of the Prisma instance, and computed options require separate analysis. [Prisma database mappings](https://docs.prisma.io/docs/orm/v6/prisma-schema/data-model/database-mapping)
- The optional catalog tracks table and column names. It cannot reproduce extension semantics, triggers, runtime `search_path`, domain behavior, deployment order, database contents, or concurrent load. The compatibility scan never executes SQL or inspects a live database.
- Git inputs use a 45-second subprocess budget, up to 400 source files and 6 MiB per revision, and the Phase 1 migration limits. Compatibility matching covers up to 2,500 normalized migration operations. Reports retain up to 50 references per release for each finding. Review explicit gaps when a limit is reached.

The browser workspace loads bounded JSON exports locally and labels them as imported. For persistent history, sign in to a configured team workspace and explicitly save the report to a repository. Git reports can contain private paths, names and source references. Share artifacts only with people allowed to see that metadata.

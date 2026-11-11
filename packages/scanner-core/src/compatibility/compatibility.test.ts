import assert from "node:assert/strict";
import { test } from "node:test";
import { analyzeCompatibility, compatibilityPolicy, compatibilitySarif } from "./index";
import type { CompatibilityInput } from "./contracts";

const source = (text: string) => [{ path: "src/users.ts", text }];
function input(
  sql: string,
  previous = 'pool.query("SELECT id FROM public.users");',
): CompatibilityInput {
  return {
    previous: { release: { ref: "v1" }, sources: source(previous) },
    proposed: {
      release: { ref: "v2" },
      sources: source('pool.query("SELECT id FROM public.users");'),
    },
    migrations: sql ? [{ path: "db/002.sql", sql }] : [],
  };
}

test("additive migration passes only within supported scope and retains Phase 1 results", async () => {
  const report = await analyzeCompatibility(
    input("ALTER TABLE public.users ADD COLUMN note text;"),
  );
  assert.equal(report.status, "compatible_within_analyzed_scope");
  assert.equal(report.migrationReport?.files[0]?.changes[0]?.target?.column, "note");
  assert.equal(report.migrationReport?.compatibility, "unknown");
  assert.equal(report.findings.length, 0);
  assert.ok(report.coverage.limitations.length);
  assert.equal(
    compatibilityPolicy(report, { failOn: "high", failOnIncomplete: true }).blocked,
    false,
  );
});

test("recognizes Supabase table, projection and filter dependencies without confusing unrelated builders", async () => {
  const scan = input(
    "ALTER TABLE private.audit_reports DROP COLUMN owner_id;",
    `import { createClient as connect } from "@supabase/supabase-js";
     const supabase = connect(url, key);
     const row = { id: "report", title: "Example" };
     supabase.schema("private").from("audit_reports").insert(row);
     supabase.schema("private").from("audit_reports").select("id").eq("owner_id", owner);
     other.from("audit_reports").select("secret");`,
  );
  const report = await analyzeCompatibility(scan);
  assert.equal(report.status, "incompatible");
  assert.equal(report.dependencies.previous.queries, 2);
  assert.ok(
    report.findings[0]?.previousEvidence.some(({ target }) => target.column === "owner_id"),
  );
  assert.ok(
    report.dependencies.previous.references.some(
      ({ target, writeTarget }) => target.column === "title" && writeTarget,
    ),
  );
  assert.ok(
    !report.dependencies.previous.references.some(({ target }) => target.column === "secret"),
  );

  scan.previous.sources = source(`
    import { createClient } from "@supabase/supabase-js";
    const client = createClient(url, key);
    client.from("audit_reports").select("id,owners(id)");
  `);
  const nested = await analyzeCompatibility(scan);
  assert.equal(nested.status, "unknown");
  assert.ok(nested.coverage.gaps.some(({ kind }) => kind === "unresolved-reference"));
});

test("distinguishes row-level security on a new table from a conditional or existing table", async () => {
  const sql = "ALTER TABLE public.qa ENABLE ROW LEVEL SECURITY;";
  const guarded = input(`CREATE TABLE IF NOT EXISTS public.qa (id bigint PRIMARY KEY); ${sql}`);
  const report = await analyzeCompatibility(guarded);
  assert.equal(report.status, "potentially_incompatible");
  assert.equal(report.coverage.gaps.length, 0);
  assert.equal(report.findings[0]?.title, "Row-level security may change access");
  assert.ok(compatibilityPolicy(report, { failOn: "high", failOnIncomplete: true }).blocked);
  assert.equal(
    (await analyzeCompatibility(input(`CREATE TABLE public.qa (id bigint PRIMARY KEY); ${sql}`)))
      .status,
    "compatible_within_analyzed_scope",
  );
  guarded.baseline = { path: "db/schema.sql", sql: "CREATE TABLE public.users(id bigint);" };
  assert.equal((await analyzeCompatibility(guarded)).status, "compatible_within_analyzed_scope");
  guarded.baseline.sql += "CREATE TABLE public.qa(id bigint);";
  assert.equal((await analyzeCompatibility(guarded)).status, "potentially_incompatible");
  const existing = await analyzeCompatibility(input(sql, 'db.query("SELECT id FROM public.qa")'));
  assert.equal(existing.status, "potentially_incompatible");
  assert.equal(existing.findings[0]?.previousEvidence[0]?.target.table, "qa");
});

for (const [sql, ruleId] of [
  ["ALTER TABLE public.users DROP COLUMN full_name;", "COMPAT001"],
  ["DROP TABLE public.users;", "COMPAT002"],
  ["ALTER TABLE public.users RENAME COLUMN full_name TO display_name;", "COMPAT003"],
] as const) {
  test(`${ruleId} confirms an unambiguous previous-release dependency`, async () => {
    const report = await analyzeCompatibility(
      input(
        sql,
        '\nconst result = pool.query("SELECT u.full_name FROM public.users u WHERE u.id=$1");',
      ),
    );
    const finding = report.findings.find((finding) => finding.ruleId === ruleId);
    assert.equal(report.status, "incompatible");
    assert.equal(finding?.status, "incompatible");
    assert.equal(finding?.confidence, "high");
    assert.equal(finding?.severity, "critical");
    assert.equal(finding?.previousEvidence[0]?.location.line, 2);
    assert.equal(finding?.proposedEvidence.length, ruleId === "COMPAT002" ? 2 : 0);
  });
}

for (const [sql, ruleId] of [
  ["ALTER TABLE users ALTER COLUMN full_name TYPE varchar(80);", "COMPAT004"],
  ["ALTER TABLE users ALTER COLUMN full_name SET NOT NULL;", "COMPAT005"],
  ["ALTER TABLE users ADD CONSTRAINT valid CHECK (full_name IS NOT NULL);", "COMPAT006"],
] as const) {
  test(`${ruleId} keeps type and write behavior conditional`, async () => {
    const report = await analyzeCompatibility(
      input(sql, 'db.query("INSERT INTO users (id, full_name) VALUES ($1, $2)");'),
    );
    const finding = report.findings.find((finding) => finding.ruleId === ruleId);
    assert.equal(finding?.status, "potentially_incompatible");
    assert.notEqual(finding?.confidence, "high");
  });
}

test("dynamic SQL, unsupported migrations and missing source yield coverage findings", async () => {
  const dynamic = await analyzeCompatibility(
    input(
      "ALTER TABLE users DROP COLUMN full_name;",
      `const q = \`SELECT \${field} FROM users\`; db.query(q);`,
    ),
  );
  assert.equal(dynamic.status, "unknown");
  assert.ok(dynamic.findings.some(({ ruleId }) => ruleId === "COMPAT007"));
  assert.equal(
    compatibilityPolicy(dynamic, { failOn: "none", failOnIncomplete: true }).blocked,
    true,
  );
  const unsupported = await analyzeCompatibility(
    input("ALTER SEQUENCE users_seq RESTART WITH 100;"),
  );
  assert.equal(unsupported.status, "unknown");
  assert.ok(unsupported.findings.some(({ ruleId }) => ruleId === "COMPAT008"));
  const absent = input("");
  absent.previous = { release: { ref: "v1" }, sources: [] };
  assert.ok(
    (await analyzeCompatibility(absent)).findings.some(({ ruleId }) => ruleId === "COMPAT010"),
  );
});

test("empty migration diff remains scoped and exports reproducible JSON and SARIF", async () => {
  const scan = input("");
  const report = await analyzeCompatibility(scan);
  assert.equal(report.status, "compatible_within_analyzed_scope");
  assert.equal(report.migrationReport, null);
  assert.deepEqual(
    JSON.parse(JSON.stringify(report)),
    JSON.parse(JSON.stringify(await analyzeCompatibility(scan))),
  );
  assert.equal(compatibilitySarif(report).version, "2.1.0");
  const broken = await analyzeCompatibility(input("DROP TABLE users;"));
  const result = compatibilitySarif(broken).runs[0]?.results.find(
    ({ ruleId }) => ruleId === "COMPAT002",
  );
  assert.ok(result && "relatedLocations" in result && result.relatedLocations.length);
});

test("ambiguous joined columns stay unresolved and a baseline can disambiguate them", async () => {
  const data = input(
    "ALTER TABLE users DROP COLUMN full_name;",
    'db.query("SELECT full_name FROM users u JOIN orders o ON u.id=o.user_id");',
  );
  const ambiguous = await analyzeCompatibility(data);
  assert.notEqual(ambiguous.status, "incompatible");
  assert.ok(ambiguous.coverage.gaps.some(({ kind }) => kind === "unresolved-reference"));
  data.baseline = {
    path: "db/schema.sql",
    sql: "CREATE TABLE users(id int, full_name text); CREATE TABLE orders(id int, user_id int);",
  };
  assert.equal((await analyzeCompatibility(data)).status, "incompatible");
});

test("CTE shadowing, nested scopes, session settings and relation aliases prevent false confirmation", async () => {
  for (const query of [
    "WITH users AS (SELECT 'name' AS full_name) SELECT full_name FROM users",
    "SELECT q.full_name FROM (SELECT id AS full_name FROM orders) q",
    "SET search_path TO other; SELECT full_name FROM users",
    "SELECT x.full_name FROM users AS x(id, full_name)",
  ]) {
    const report = await analyzeCompatibility(
      input(
        "ALTER TABLE public.users DROP COLUMN full_name;",
        `db.query(${JSON.stringify(query)});`,
      ),
    );
    assert.notEqual(report.status, "incompatible", query);
    assert.ok(report.coverage.gaps.length, query);
  }
});

test("schema and quoted identifier identities do not collide", async () => {
  const different = await analyzeCompatibility(
    input(
      "ALTER TABLE public.users DROP COLUMN full_name;",
      "db.query('SELECT full_name FROM private.users');",
    ),
  );
  assert.equal(
    different.findings.some(({ ruleId }) => ruleId === "COMPAT001"),
    false,
  );
  const quoted = await analyzeCompatibility(
    input(
      'ALTER TABLE "Sales"."user.record" DROP COLUMN "Full.Name";',
      'db.query(\'SELECT u."Full.Name" FROM "Sales"."user.record" u\');',
    ),
  );
  assert.equal(quoted.status, "incompatible");
  assert.equal(quoted.findings[0]?.object, '"Sales"."user.record"."Full.Name"');
});

test("SELECT, INSERT, UPDATE, DELETE, JOIN, WHERE and RETURNING produce real references", async () => {
  const report = await analyzeCompatibility(
    input(
      "ALTER TABLE users DROP COLUMN full_name;",
      [
        'db.query("SELECT u.id FROM users u JOIN orders o ON u.full_name=o.reference WHERE o.id=$1");',
        'db.query("INSERT INTO users (id, full_name) VALUES ($1,$2) RETURNING full_name");',
        'db.query("UPDATE users SET full_name=$1 WHERE id=$2 RETURNING full_name");',
        'db.query("DELETE FROM users WHERE full_name=$1 RETURNING id");',
      ].join("\n"),
    ),
  );
  const refs = report.findings.find(({ ruleId }) => ruleId === "COMPAT001")?.previousEvidence ?? [];
  assert.deepEqual(
    new Set(refs.map(({ statement }) => statement)),
    new Set(["select", "insert", "update", "delete"]),
  );
  assert.ok(report.dependencies.previous.edges.some(({ kind }) => kind === "FILE_CONTAINS_QUERY"));
  assert.ok(
    report.dependencies.previous.edges.some(({ kind }) => kind === "QUERY_REFERENCES_COLUMN"),
  );
});

test("restoration, conditional DDL, syntax recovery and historical edits reduce certainty", async () => {
  const previous = 'db.query("SELECT full_name FROM users");';
  for (const data of [
    input(
      "ALTER TABLE users DROP COLUMN full_name; ALTER TABLE users ADD COLUMN full_name text;",
      previous,
    ),
    input("ALTER TABLE users DROP COLUMN IF EXISTS full_name;", previous),
    input("ALTER TABLE users DROP COLUMN full_name;", `${previous}\nconst = ;`),
    {
      ...input("ALTER TABLE users DROP COLUMN full_name;", previous),
      gaps: [{ kind: "migration", scope: "migrations", message: "Existing history changed." }],
    } as CompatibilityInput,
  ]) {
    const report = await analyzeCompatibility(data);
    assert.notEqual(report.status, "incompatible");
    assert.equal(
      report.findings.find(({ ruleId }) => ruleId === "COMPAT001")?.status,
      "potentially_incompatible",
    );
  }
});

test("wildcard result shapes and positional inserts require review after an additive change", async () => {
  for (const query of ["SELECT * FROM users", "INSERT INTO users VALUES ($1,$2)"]) {
    const report = await analyzeCompatibility(
      input("ALTER TABLE users ADD COLUMN note text;", `db.query(${JSON.stringify(query)});`),
    );
    assert.equal(report.status, "potentially_incompatible");
    assert.ok(report.findings.some(({ ruleId }) => ruleId === "COMPAT010"));
  }
});

test("Prisma maps, namespaces and explicit scalar selections provide mapped dependencies", async () => {
  const schema = {
    path: "prisma/schema.prisma",
    text: 'model Customer {\n id Int @id\n fullName String @map("full_name")\n @@map("customer_records")\n @@schema("sales")\n}',
  };
  const data = input(
    "ALTER TABLE sales.customer_records DROP COLUMN full_name;",
    "prisma.customer.findUnique({where:{id:1},select:{fullName:true}});",
  );
  data.previous = { ...data.previous, prisma: schema };
  const report = await analyzeCompatibility(data);
  assert.equal(report.status, "incompatible");
  assert.equal(report.findings[0]?.object, "sales.customer_records.full_name");
  assert.equal(report.findings[0]?.previousEvidence[0]?.kind, "prisma-reference");
  const broken = {
    ...data,
    previous: {
      ...data.previous,
      prisma: { ...schema, text: schema.text.replace("fullName String", "fullName ! String") },
    },
  };
  assert.notEqual((await analyzeCompatibility(broken)).status, "incompatible");
});

test("enforces supported PostgreSQL versions and bounded source inputs", async () => {
  await assert.rejects(
    analyzeCompatibility({ ...input(""), postgresMajor: 17 as 18 }),
    /PostgreSQL 18/,
  );
  const data = input("");
  data.previous = { ...data.previous, sources: [{ path: "../secret.ts", text: "" }] };
  await assert.rejects(analyzeCompatibility(data), /relative/);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import type { CompatibilityInput } from "./contracts";
import { analyzeCompatibility, compatibilityPolicy, compatibilitySarif } from "./index";

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
  assert.equal(report.dependencies.previous.queries, 3);
  assert.ok(report.coverage.gaps.some(({ kind }) => kind === "unresolved-reference"));
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

test("traces async Supabase helpers through configured aliases and relative re-exports", async () => {
  const sources = [
    {
      path: "src/lib/client.ts",
      text: `import {createServerClient as sdkClient} from "@supabase/ssr";
      export async function createClient() { const cookies = await getCookies(); return sdkClient(url, key, {cookies}); }`,
    },
    { path: "src/lib/index.ts", text: `export {createClient as connect} from "./client";` },
    {
      path: "src/reader.ts",
      text: `import {connect} from "@/lib";
      const db = await connect(); db.from("audit_reports").select("id,snapshot").eq("owner_id", owner);`,
    },
    {
      path: "src/writer.ts",
      text: `import {createClient} from "./lib/client";
      const db = await createClient(); const id = "row"; const snapshot = {}; const row = {id, snapshot};
      db.from("audit_reports").insert(row);`,
    },
    {
      path: "src/delete.ts",
      text: 'export async function remove(factory:()=>Promise<unknown>){const client=await factory();client.from("audit_reports").delete().eq("id",id);}',
    },
    {
      path: "src/caller.ts",
      text: 'import {remove} from "./delete";import {connect} from "@/lib";remove(connect);',
    },
  ];
  const typescriptConfigs = [
    {
      path: "tsconfig.base.json",
      text: JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@/*": ["src/*"] } } }),
    },
    { path: "tsconfig.json", text: JSON.stringify({ extends: "./tsconfig.base.json" }) },
  ];
  const scan: CompatibilityInput = {
    previous: { release: { ref: "v1" }, sources, typescriptConfigs },
    proposed: { release: { ref: "v2" }, sources, typescriptConfigs },
    migrations: [
      { path: "migrations/002.sql", sql: "ALTER TABLE public.audit_reports DROP COLUMN snapshot;" },
    ],
  };
  const report = await analyzeCompatibility(scan);
  assert.equal(report.status, "incompatible");
  assert.equal(report.dependencies.previous.queries, 3);
  assert.equal(report.coverage.gaps.length, 0);
  assert.ok(
    report.dependencies.previous.references.some(
      ({ target, writeTarget }) => target.column === "snapshot" && writeTarget,
    ),
  );
  assert.ok(
    report.dependencies.previous.references.some(
      ({ statement, location }) => statement === "delete" && location.path === "src/delete.ts",
    ),
  );
  assert.ok(
    report.findings[0]?.previousEvidence.some(({ location }) => location.path === "src/reader.ts"),
  );
  scan.previous = { ...scan.previous, typescriptConfigs: [] };
  const missingAlias = await analyzeCompatibility(scan);
  assert.ok(
    missingAlias.coverage.gaps.some(
      ({ kind, location }) => kind === "unresolved-reference" && location?.path === "src/reader.ts",
    ),
  );
});

test("reports unresolved clients, ambiguous helper returns and reused query builders", async () => {
  for (const client of [
    'import { createClient } from "missing-helper"; const client = await createClient();',
    'import {createClient} from "@supabase/supabase-js"; function helper(){if(flag)return createClient(url,key);return createClient(other,key);}const client=helper();',
    'import {createClient} from "@supabase/supabase-js"; function helper(){return helper();}const client=helper();',
    'import {createClient} from "@supabase/supabase-js"; let client=createClient(url,key);',
  ]) {
    const report = await analyzeCompatibility(
      input("", `${client}client.from("users").select("id");`),
    );
    assert.equal(report.status, "unknown");
    assert.equal(report.dependencies.previous.queries, 1);
    assert.ok(report.coverage.gaps.some(({ kind }) => kind === "unresolved-reference"));
  }
  const reused = await analyzeCompatibility(
    input(
      "",
      `import {createClient} from "@supabase/supabase-js";
    const client=createClient(url,key); let query=client.from("users").select("id");
    if(flag) query=query.or(dynamicFilters); const result=await query;`,
    ),
  );
  assert.equal(reused.dependencies.previous.queries, 1);
  assert.equal(reused.status, "unknown");
  assert.ok(reused.coverage.gaps.some(({ message }) => message.includes("logical filter")));
  const unrelated = await analyzeCompatibility(
    input(
      "",
      'Array.from(items).map(x=>x);Buffer.from(value).toString();db.query("SELECT id FROM users");',
    ),
  );
  assert.equal(unrelated.dependencies.previous.queries, 1);
  assert.equal(unrelated.coverage.gaps.length, 0);
});

test("follows conditional Supabase builder filters and bounded logical expressions", async () => {
  const report = await analyzeCompatibility(
    input(
      "ALTER TABLE public.users DROP COLUMN cursor_id;",
      `import {createClient} from "@supabase/supabase-js";
    const client=createClient(url,key);
    let request=client.from("users").select("id");
    if(search) request=request.ilike("name", search);
    if(cursor) request=request.or('updated_at.lt.2026-11-11,and(updated_at.eq.2026-11-11,cursor_id.lt.abc)');
    const result=await request;`,
    ),
  );
  assert.equal(report.coverage.gaps.length, 0);
  assert.equal(report.dependencies.previous.queries, 1);
  assert.equal(report.status, "incompatible");
  for (const column of ["id", "name", "updated_at", "cursor_id"])
    assert.ok(
      report.dependencies.previous.references.some(({ target }) => target.column === column),
    );
});

test("traces bounded constant Supabase aliases without losing their later filters", async () => {
  for (const extension of [
    'const filtered=request.eq("active",true);await filtered;',
    'const alias=request;const filtered=alias.in("email",values).order("id").limit(10);await filtered;',
    'const filtered=request.eq("active",true);await request;await filtered;',
  ]) {
    const report = await analyzeCompatibility(
      input(
        "ALTER TABLE public.users DROP COLUMN active;",
        `import {createClient} from "@supabase/supabase-js";const client=createClient(url,key);const request=client.from("users").select("id");${extension}`,
      ),
    );
    assert.equal(report.coverage.gaps.length, 0, extension);
    assert.ok(
      report.dependencies.previous.references.some(
        ({ target }) => target.column === (extension.includes('"email"') ? "email" : "active"),
      ),
      extension,
    );
  }
});

test("uses the final projection in a direct Supabase select chain", async () => {
  const prefix =
    'import {createClient} from "@supabase/supabase-js";const client=createClient(url,key);';
  const report = await analyzeCompatibility(
    input(
      "ALTER TABLE public.users DROP COLUMN legacy;",
      `${prefix}await client.from("users").select("legacy").select("id");`,
    ),
  );
  // Destructive migrations retain the existing precautionary status even when
  // no previous-release dependency intersects them.
  assert.equal(report.status, "potentially_incompatible");
  assert.equal(report.findings.length, 0);
  assert.equal(report.coverage.gaps.length, 0);
  assert.ok(
    !report.dependencies.previous.references.some(({ target }) => target.column === "legacy"),
  );
  const filtered = await analyzeCompatibility(
    input(
      "ALTER TABLE public.users DROP COLUMN legacy;",
      `${prefix}await client.from("users").select("legacy").eq("legacy",value).select("id");`,
    ),
  );
  assert.equal(filtered.status, "incompatible");
});

test("Supabase operation matrix retains read, write and scalar-filter dependencies", async () => {
  for (const [operation, column] of [
    ['select("id,email").eq("active",true).in("id",ids).order("email").limit(5)', "email"],
    ['insert({email}).select("id")', "email"],
    ['update({email}).eq("id",id)', "email"],
    ['delete().in("email",emails)', "email"],
  ]) {
    const report = await analyzeCompatibility(
      input(
        `ALTER TABLE public.users DROP COLUMN ${column};`,
        `import {createClient} from "@supabase/supabase-js";const client=createClient(url,key);await client.from("users").${operation};`,
      ),
    );
    assert.equal(report.status, "incompatible", operation);
    assert.equal(report.coverage.gaps.length, 0, operation);
  }
});

test("query composition across functions, mutable aliases and exported builders retain coverage gaps", async () => {
  for (const extension of [
    "let alias=request;await alias;",
    "consume(request);",
    'function later(){return request.eq("active",true);}await later();',
    'export const filtered=request.eq("active",true);',
    Array.from(
      { length: 35 },
      (_, i) => `const alias${i}=${i === 0 ? "request" : `alias${i - 1}`};`,
    ).join(""),
  ]) {
    const report = await analyzeCompatibility(
      input(
        "",
        `import {createClient} from "@supabase/supabase-js";const client=createClient(url,key);const request=client.from("users").select("id");${extension}`,
      ),
    );
    assert.equal(report.status, "unknown", extension);
    assert.ok(report.coverage.gaps.length, extension);
  }
  const scan = input("");
  scan.previous.sources = [
    {
      path: "src/query.ts",
      text: 'import {createClient} from "@supabase/supabase-js";const client=createClient(url,key);export const request=client.from("users").select("id");',
    },
    {
      path: "src/reader.ts",
      text: 'import {request} from "./query";await request.eq("active",true);',
    },
  ];
  assert.equal((await analyzeCompatibility(scan)).status, "unknown");
});

test("accepts guarded UUID and timestamp values without treating dynamic filter structure as static", async () => {
  const schema = {
    path: "src/cursor.ts",
    text: 'import {z} from "zod"; export const cursorSchema=z.object({at:z.iso.datetime({offset:true}),id:z.uuid()});',
  };
  const prefix =
    'import {createClient} from "@supabase/supabase-js";import {cursorSchema} from "./cursor";const client=createClient(url,key);let request=client.from("users").select("id");const cursor=cursorSchema.safeParse(raw);';
  const valid = `if(cursor.success) request=request.or(\`updated_at.lt.\${cursor.data.at},and(updated_at.eq.\${cursor.data.at},cursor_id.lt.\${cursor.data.id})\`);await request;`;
  const scan = input("ALTER TABLE public.users DROP COLUMN cursor_id;");
  scan.previous.sources = [schema, { path: "src/users.ts", text: prefix + valid }];
  const report = await analyzeCompatibility(scan);
  assert.equal(report.coverage.gaps.length, 0);
  assert.equal(report.status, "incompatible");
  for (const text of [
    valid.replace("if(cursor.success) ", ""),
    valid.replace(`updated_at.lt.\${cursor.data.at}`, `\${cursor.data.id}.lt.1`),
    valid.replace(`updated_at.lt.\${cursor.data.at}`, `updated_at.\${cursor.data.id}.1`),
    `if(cursor.success){cursor.data.id=untrusted;request=request.or(\`cursor_id.lt.\${cursor.data.id}\`);}await request;`,
    `if(cursor.success){mutate(cursor);request=request.or(\`cursor_id.lt.\${cursor.data.id}\`);}await request;`,
    valid.replace("cursor.data.at", "unvalidated"),
  ]) {
    scan.previous.sources = [schema, { path: "src/users.ts", text: prefix + text }];
    const unresolved = await analyzeCompatibility(scan);
    assert.ok(unresolved.coverage.gaps.length, text);
    assert.notEqual(unresolved.status, "incompatible", text);
  }
  scan.previous.sources = [
    { ...schema, text: schema.text.replace("z.uuid()", "z.string()") },
    { path: "src/users.ts", text: prefix + valid },
  ];
  assert.ok((await analyzeCompatibility(scan)).coverage.gaps.length);
  for (const text of [
    schema.text.replace("id:z.uuid()", "id:z.uuid(),id:z.string()"),
    schema.text.replace("id:z.uuid()", "id:z.uuid(),[key]:z.string()"),
  ]) {
    scan.previous.sources = [
      { ...schema, text },
      { path: "src/users.ts", text: prefix + valid },
    ];
    assert.ok((await analyzeCompatibility(scan)).coverage.gaps.length, text);
  }
  scan.previous.sources = [
    schema,
    { path: "src/users.ts", text: prefix + valid },
    {
      path: "src/mutate.ts",
      text: 'import {cursorSchema} from "./cursor";cursorSchema.safeParse=customParser;',
    },
  ];
  assert.ok((await analyzeCompatibility(scan)).coverage.gaps.length, "mutated validation schema");
});

test("retains gaps and reduces confidence for escaped or overwritten Supabase builders", async () => {
  for (const extension of [
    'const alias=request;alias.select("name");',
    "request=unknownBuilder;",
    'request=request.select("name");',
    "consume(request);",
    "request.or(raw);",
    'later(()=>request.eq("name",value));',
    'request=request.order("name",{referencedTable:"profiles"});',
  ]) {
    const report = await analyzeCompatibility(
      input(
        "ALTER TABLE public.users DROP COLUMN id;",
        `import {createClient} from "@supabase/supabase-js";const client=createClient(url,key);let request=client.from("users").select("id");${extension}await request;`,
      ),
    );
    assert.ok(report.coverage.gaps.length, extension);
    assert.notEqual(report.status, "incompatible", extension);
    assert.ok(
      report.dependencies.previous.references.every(({ confidence }) => confidence === "low"),
      extension,
    );
  }
});

test("logical filters reject unmodeled operators, foreign tables, malformed syntax and oversized inputs", async () => {
  for (const argument of [
    "raw",
    JSON.stringify("id.eq.1,and(name.eq.a"),
    JSON.stringify("id.in.(1,2)"),
    JSON.stringify("profiles.name.eq.a"),
    JSON.stringify("id.eq.1,or()"),
    `${JSON.stringify("id.eq.1")},{referencedTable:"profiles"}`,
    JSON.stringify(`${"or(".repeat(18)}id.eq.1${")".repeat(18)}`),
    JSON.stringify(`id.eq.${"a".repeat(32768)}`),
  ]) {
    const report = await analyzeCompatibility(
      input(
        "",
        `import {createClient} from "@supabase/supabase-js";const client=createClient(url,key);await client.from("users").select("id").or(${argument});`,
      ),
    );
    assert.equal(report.status, "unknown", argument.slice(0, 80));
  }
  const literal = await analyzeCompatibility(
    input(
      "",
      'import {createClient} from "@supabase/supabase-js";const client=createClient(url,key);await client.from("users").select("id").or(\'name.eq."a,b",not.and(id.neq.1,name.not.ilike.x)\');',
    ),
  );
  assert.equal(literal.coverage.gaps.length, 0);
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

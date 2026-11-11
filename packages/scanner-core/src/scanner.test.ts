import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluatePolicy, MAX_FILE_BYTES, scanMigrations, toSarif } from "./index";

test("matches supported DDL using PostgreSQL statement nodes", async () => {
  const report = await scanMigrations([
    {
      path: "migrations/all.sql",
      sql: `
-- comentário 🧪
DROP TABLE IF EXISTS public.legacy, "Sales"."Mixed.Name" CASCADE;
ALTER TABLE public.accounts DROP COLUMN legacy, ALTER COLUMN quota TYPE bigint;
ALTER TABLE public.accounts RENAME COLUMN plan TO tier;
ALTER TABLE public.accounts ALTER COLUMN email SET NOT NULL;
ALTER TABLE public.accounts ADD CONSTRAINT positive_quota CHECK (quota > 0), DROP CONSTRAINT old_check;
CREATE INDEX accounts_tier_idx ON public.accounts (tier);
CREATE UNIQUE INDEX CONCURRENTLY accounts_email_idx ON public.accounts (email);
DROP INDEX CONCURRENTLY public.accounts_tier_idx;
ALTER TABLE public.accounts ADD COLUMN notes text;
`,
    },
  ]);
  assert.equal(report.summary.files, 1);
  assert.equal(report.summary.statements, 9);
  assert.equal(report.summary.changes, 12);
  assert.equal(report.compatibility, "unknown");
  assert.equal(report.files[0]?.coverage, "covered");
  const counts = Object.fromEntries(
    [...new Set(report.findings.map(({ ruleId }) => ruleId))].map((ruleId) => [
      ruleId,
      report.findings.filter((finding) => finding.ruleId === ruleId).length,
    ]),
  );
  assert.deepEqual(counts, {
    PG001: 2,
    PG002: 1,
    PG003: 1,
    PG004: 1,
    PG005: 1,
    PG006: 2,
    PG007: 3,
    PG008: 2,
  });
  const drop = report.findings.find(({ object }) => object === '"Sales"."Mixed.Name"');
  assert.equal(drop?.location.line, 3);
  assert.equal(drop?.location.column, 1);
  assert.equal(drop?.severity, "critical");
  assert.equal(drop?.confidence, "potential");
  assert.match(drop?.evidence ?? "", /CASCADE/);
  assert.equal(
    report.findings.some(
      ({ evidence, ruleId }) => ruleId === "PG007" && evidence.includes("CONCURRENTLY"),
    ),
    false,
  );
});

test("reports mixed coverage and parser failures while continuing other files", async () => {
  const report = await scanMigrations([
    { path: "migrations/001.sql", sql: "ALTER SEQUENCE orders_seq RESTART WITH 100;" },
    { path: "migrations/002.sql", sql: "-- secret input\nALTER TABLE ;" },
    { path: "migrations/003.sql", sql: "ALTER TABLE orders ADD COLUMN note text;" },
    {
      path: "migrations/004.sql",
      sql: "ALTER TABLE orders ADD COLUMN owner int REFERENCES users(id), ADD COLUMN b serial, DROP COLUMN old;",
    },
  ]);
  assert.deepEqual(
    report.files.map(({ coverage }) => coverage),
    ["partial", "parse-error", "covered", "partial"],
  );
  assert.deepEqual(
    report.findings.map(({ ruleId }) => ruleId),
    ["PG900", "PG901", "PG900", "PG900", "PG002"],
  );
  assert.equal(report.findings[1]?.location.line, 2);
  assert.equal(report.findings[1]?.location.column, 13);
  assert.equal(report.summary.incompleteFiles, 3);
  assert.equal(JSON.stringify(report).includes("secret input"), false);
});

test("finds statements across comments, quoted identifiers and string literals", async () => {
  const [file] = (
    await scanMigrations([
      {
        path: "quoted.sql",
        sql: `SELECT 'DROP TABLE accounts;';
-- DROP COLUMN legacy
ALTER TABLE "Odd;table" ADD COLUMN "note" text;`,
      },
    ])
  ).files;
  assert.equal(file?.statements, 2);
  assert.equal(file?.changes[0]?.operation, "unsupported");
  assert.equal(file?.changes[1]?.object, '"Odd;table".note');
  assert.equal(file?.changes[1]?.location.line, 3);
});

test("applies severity and incomplete-coverage policies independently", async () => {
  const report = await scanMigrations([
    {
      path: "gated.sql",
      sql: "ALTER TABLE orders DROP COLUMN old; ALTER SEQUENCE order_seq RESTART;",
    },
  ]);
  assert.deepEqual(evaluatePolicy(report, { failOn: "critical", failOnIncomplete: false }), {
    blocked: false,
    findingIds: [],
    incompleteFiles: [],
  });
  assert.equal(
    evaluatePolicy(report, { failOn: "high", failOnIncomplete: false }).findingIds.length,
    1,
  );
  assert.deepEqual(evaluatePolicy(report, { failOn: "none", failOnIncomplete: true }), {
    blocked: true,
    findingIds: [],
    incompleteFiles: ["gated.sql"],
  });
});

test("generates reproducible IDs and SARIF source locations", async () => {
  const input = [{ path: "some dir/é.sql", sql: "-- é 🧪\nDROP TABLE accounts;" }];
  const first = await scanMigrations(input);
  assert.deepEqual(first, await scanMigrations(input));
  const sarif = toSarif(first);
  assert.equal(sarif.version, "2.1.0");
  const result = sarif.runs[0]?.results[0];
  assert.equal(result?.ruleId, "PG001");
  assert.deepEqual(result?.locations[0]?.physicalLocation, {
    artifactLocation: { uri: "some%20dir/%C3%A9.sql" },
    region: { startLine: 2, startColumn: 1 },
  });
});

test("rejects invalid paths, duplicates and over-limit input", async () => {
  const file = { path: "m.sql", sql: "SELECT 1;" };
  await assert.rejects(scanMigrations([file, file]), /unique/);
  await assert.rejects(scanMigrations([{ ...file, path: "../m.sql" }]), /relative/);
  await assert.rejects(
    scanMigrations([{ ...file, sql: "a".repeat(MAX_FILE_BYTES + 1) }]),
    /byte limit/,
  );
  await assert.rejects(scanMigrations([{ ...file, sql: "DROP\0 TABLE test" }]), /null byte/);
});

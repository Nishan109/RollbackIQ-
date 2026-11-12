import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { PGlite, type Transaction } from "@electric-sql/pglite";

const owner = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";
const viewer = "00000000-0000-4000-8000-000000000003";
const developer = "00000000-0000-4000-8000-000000000004";

test("enabling RLS on an existing conditional fixture changes ordinary-role reads", async () => {
  const db = new PGlite();
  try {
    await db.exec(
      "create role fixture_reader;create table public.qa(id bigint primary key);insert into public.qa values(1);grant select on public.qa to fixture_reader;",
    );
    const read = () =>
      db.transaction(async (tx) => {
        await tx.exec("set local role fixture_reader");
        return (await tx.query("select id from public.qa")).rows;
      });
    assert.equal((await read()).length, 1);
    await db.exec(
      "create table if not exists public.qa(id bigint primary key);alter table public.qa enable row level security;",
    );
    assert.equal((await read()).length, 0);
  } finally {
    await db.close();
  }
});

test("tenant migration enforces role and organization isolation, transactional persistence and replay", async () => {
  const db = new PGlite();
  try {
    // Match the Supabase request identity interface while executing policies in PostgreSQL.
    await db.exec(`
      create role anon;
      create role authenticated;
      create schema auth;
      create table auth.users (id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
      create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true),''),'{}')::jsonb $$;
      grant usage on schema auth to authenticated, anon;
    `);
    await db.query("insert into auth.users values ($1), ($2), ($3), ($4)", [
      owner,
      other,
      viewer,
      developer,
    ]);
    await db.exec(
      await readFile(
        new URL("../supabase/migrations/20261111105615_rollbackiq_tenants.sql", import.meta.url),
        "utf8",
      ),
    );

    function asActor<T>(
      user: string,
      callback: (tx: Transaction) => Promise<T>,
      anonymous = false,
    ) {
      return db.transaction(async (tx) => {
        await tx.exec("set local role authenticated");
        await tx.query(
          "select set_config('request.jwt.claim.sub',$1,true), set_config('request.jwt.claims',$2,true)",
          [user, JSON.stringify({ is_anonymous: anonymous })],
        );
        return callback(tx);
      });
    }
    const org = async (user: string, name: string) =>
      asActor(
        user,
        async (tx) =>
          (
            await tx.query<{ id: string }>("select public.rollbackiq_create_organization($1) id", [
              name,
            ])
          ).rows[0]?.id,
      );
    const repository = async (user: string, orgId: string | undefined, name: string) =>
      asActor(
        user,
        async (tx) =>
          (
            await tx.query<{ id: string }>("select public.rollbackiq_add_repository($1,$2) id", [
              orgId,
              name,
            ])
          ).rows[0]?.id,
      );
    const a = await org(owner, "Organization A");
    const b = await org(other, "Organization B");
    const repoA = await repository(owner, a, "company/a");
    const repoB = await repository(other, b, "company/b");
    assert.ok(a && b && repoA && repoB);
    await assert.rejects(
      asActor(
        other,
        (tx) => tx.query("select public.rollbackiq_create_organization('Anonymous')"),
        true,
      ),
      /Authentication required/,
    );
    await assert.rejects(
      asActor(other, (tx) =>
        tx.query("select public.rollbackiq_set_member($1,$2,'admin')", [a, other]),
      ),
      /owner access/,
    );
    await asActor(owner, async (tx) => {
      await tx.query("select public.rollbackiq_set_member($1,$2,'viewer')", [a, viewer]);
      await tx.query("select public.rollbackiq_set_member($1,$2,'developer')", [a, developer]);
    });
    await assert.rejects(repository(developer, a, "forbidden"), /owner or admin/);

    const report = {
      kind: "release-compatibility",
      schemaVersion: 1,
      status: "incompatible",
      previous: { ref: "v1", commit: "a".repeat(40) },
      proposed: { ref: "v2", commit: "b".repeat(40) },
      findings: [
        {
          id: "finding",
          ruleId: "COMPAT001",
          severity: "critical",
          status: "incompatible",
          confidence: "high",
          object: "public.users.name",
          previousEvidence: [
            {
              location: { path: "src/users.ts", line: 7, column: 1 },
              kind: "static-sql-reference",
            },
          ],
          proposedEvidence: [],
        },
      ],
      coverage: { gaps: [{ kind: "dynamic-sql", scope: "previous", message: "Review." }] },
    };
    const key = "c".repeat(64);
    const ingest = (user: string, repo: string, payload = report) =>
      asActor(
        user,
        async (tx) =>
          (
            await tx.query<{ id: string }>(
              "select public.rollbackiq_ingest_scan($1,$2,$3::jsonb) id",
              [repo, key, JSON.stringify(payload)],
            )
          ).rows[0]?.id,
      );
    const scan = await ingest(developer, repoA);
    assert.ok(scan);
    assert.equal(await ingest(developer, repoA), scan);
    await assert.rejects(
      ingest(developer, repoA, { ...report, status: "unknown" }),
      /Idempotency key conflicts/,
    );
    await assert.rejects(ingest(developer, repoB), /write access required/);
    await assert.rejects(ingest(viewer, repoA), /write access required/);

    await asActor(viewer, async (tx) => {
      assert.deepEqual((await tx.query("select id from public.scans")).rows, [{ id: scan }]);
      assert.equal((await tx.query("select rule_id from public.scan_findings")).rows.length, 1);
      assert.equal(
        (await tx.query("select source_path from public.finding_evidence")).rows.length,
        1,
      );
      assert.equal((await tx.query("select kind from public.scan_coverage")).rows.length, 1);
      assert.equal((await tx.query("select id from public.audit_logs")).rows.length, 0);
    });
    await assert.rejects(
      asActor(viewer, (tx) =>
        tx.query("select public.rollbackiq_review_scan($1,'reviewed')", [scan]),
      ),
      /review access required/,
    );
    await asActor(developer, (tx) =>
      tx.query("select public.rollbackiq_review_scan($1,'reviewed')", [scan]),
    );
    await asActor(other, async (tx) => {
      assert.equal(
        (await tx.query("select id from public.scans where id=$1", [scan])).rows.length,
        0,
      );
      assert.equal((await tx.query("select id from public.finding_evidence")).rows.length, 0);
      assert.equal((await tx.query("select id from public.scan_coverage")).rows.length, 0);
      assert.equal((await tx.query("select scan_id from public.scan_reviews")).rows.length, 0);
    });
    await assert.rejects(
      asActor(owner, (tx) =>
        tx.query("update public.scans set organization_id=$1 where id=$2", [b, scan]),
      ),
      /permission denied/,
    );
    await assert.rejects(
      db.query(
        "insert into public.scan_coverage (organization_id,scan_id,kind,scope,message) values ($1,$2,'source','previous','cross tenant')",
        [b, scan],
      ),
      /foreign key/,
    );
    assert.equal(
      (
        await asActor(owner, (tx) =>
          tx.query("select event_type from public.audit_logs where event_type = 'scan.imported'"),
        )
      ).rows.length,
      1,
    );
  } finally {
    await db.close();
  }
});

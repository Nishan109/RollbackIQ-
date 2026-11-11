import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { analyzeCompatibility } from "../packages/scanner-core/src/compatibility/index";

test("GitHub migration protects authorization, tenant links, webhook replay and worker leases", async () => {
  const db = new PGlite();
  const owner = "00000000-0000-4000-8000-000000000001",
    other = "00000000-0000-4000-8000-000000000002",
    viewer = "00000000-0000-4000-8000-000000000003";
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
      grant usage on schema auth to authenticated,anon;`);
    await db.query("insert into auth.users values($1),($2),($3)", [owner, other, viewer]);
    for (const file of [
      "20261111105615_rollbackiq_tenants.sql",
      "20261111105623_github_app.sql",
      "20261111110013_private_storage_hardening.sql",
    ])
      await db.exec(
        await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), "utf8"),
      );
    const privateStorage = await db.query<{ name: string; rls: boolean; user_read: boolean }>(
      `select c.relname name,c.relrowsecurity rls,has_table_privilege('authenticated',c.oid,'SELECT') user_read from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='rollbackiq_private' and c.relkind='r'`,
    );
    assert.equal(privateStorage.rows.length, 3);
    assert.ok(privateStorage.rows.every((table) => table.rls && !table.user_read));
    const createOrg = async (user: string) =>
      db.transaction(async (tx) => {
        await tx.exec("set local role authenticated");
        await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [user]);
        return (
          await tx.query<{ id: string }>("select public.rollbackiq_create_organization('Team') id")
        ).rows[0]?.id;
      });
    const a = await createOrg(owner),
      b = await createOrg(other);
    assert.ok(a && b);
    await db.query(
      "insert into public.organization_members(organization_id,user_id,role) values($1,$2,'viewer')",
      [a, viewer],
    );
    const rpc = async (action: string, data: Record<string, unknown>) =>
      db.transaction(async (tx) => {
        await tx.exec("set local role service_role");
        return (
          await tx.query<{ result: unknown }>(
            "select public.rollbackiq_github_service($1,$2::jsonb) result",
            [action, JSON.stringify(data)],
          )
        ).rows[0]?.result;
      });
    const common = { actor: owner, organization: a };
    const hash = "a".repeat(64);
    await assert.rejects(
      rpc("begin", { actor: viewer, organization: a, hash, phase: "oauth" }),
      /owner or admin/,
    );
    await assert.rejects(
      rpc("begin", { actor: other, organization: a, hash, phase: "oauth" }),
      /owner or admin/,
    );
    await rpc("begin", { ...common, hash, phase: "oauth" });
    await assert.rejects(rpc("consume", { actor: other, hash, phase: "oauth" }), /expired/);
    await rpc("consume", { actor: owner, hash, phase: "oauth" });
    await assert.rejects(rpc("consume", { actor: owner, hash, phase: "oauth" }), /already used/);
    await rpc("begin", { ...common, hash, phase: "oauth" });
    await db.exec(
      "update rollbackiq_private.github_states set expires_at=now()-interval '1 minute'",
    );
    await assert.rejects(rpc("consume", { actor: owner, hash, phase: "oauth" }), /expired/);
    const payload = {
      installation: { id: 42, app_id: 1, account: { id: 200, login: "org" } },
      repositories: [{ id: 10, full_name: "org/repo" }],
    };
    const choice = (await rpc("choices", { ...common, payload })) as { id: string };
    await assert.rejects(
      rpc("select", { ...common, choice: choice.id, repositories: [99] }),
      /not authorized/,
    );
    await rpc("select", { ...common, choice: choice.id, repositories: [10] });
    await assert.rejects(
      rpc("select", { ...common, choice: choice.id, repositories: [10] }),
      /expired/,
    );
    const choiceB = (await rpc("choices", { actor: other, organization: b, payload })) as {
      id: string;
    };
    await assert.rejects(
      rpc("select", { actor: other, organization: b, choice: choiceB.id, repositories: [10] }),
      /already associated/,
    );
    const repository = (
      await db.query<{ repository_id: string }>(
        "select repository_id from public.github_repositories",
      )
    ).rows[0]?.repository_id;
    assert.ok(repository);
    const configuration = {
      migrations: "migrations",
      sources: ["src"],
      prisma: "",
      baseline: "",
      previous: "v1",
      defaultSchema: "public",
      publishChecks: true,
    };
    await rpc("configure", { ...common, repository, configuration, enabled: true });
    const event = {
      delivery: "00000000-0000-4000-8000-000000000020",
      event: "pull_request",
      payload: {
        action: "opened",
        installation: { id: 42 },
        repository: { id: 10 },
        pull_request: { number: 1, head: { sha: "b".repeat(40) } },
      },
    };
    await rpc("webhook", event);
    await rpc("webhook", event);
    assert.equal(
      (await db.query<{ count: number }>("select count(*)::int count from public.github_jobs"))
        .rows[0]?.count,
      1,
    );
    const job = (await rpc("claim", {})) as { id: string; lease_token: string };
    assert.ok(job.id);
    assert.equal(await rpc("claim", {}), null);
    await assert.rejects(
      rpc("finish", { job: job.id, lease: "00000000-0000-4000-8000-000000000099" }),
      /lease/,
    );
    await rpc("fail", { job: job.id, lease: job.lease_token, error: "Transient provider outage" });
    await db.exec("update public.github_jobs set available_at=now()-interval '1 minute'");
    const retry = (await rpc("claim", {})) as { id: string; lease_token: string; attempts: number };
    assert.equal(retry.attempts, 2);
    assert.notEqual(retry.lease_token, job.lease_token);
    await assert.rejects(rpc("finish", { job: job.id, lease: job.lease_token }), /lease/);
    const report = await analyzeCompatibility({
      previous: {
        release: { ref: "v1", commit: "a".repeat(40) },
        sources: [
          {
            path: "src/customers.ts",
            text: "db.query('SELECT legacy_tier FROM public.customers');",
          },
        ],
      },
      proposed: {
        release: { ref: "head", commit: "b".repeat(40) },
        sources: [
          { path: "src/customers.ts", text: "db.query('SELECT id FROM public.customers');" },
        ],
      },
      migrations: [
        {
          path: "migrations/002.sql",
          sql: "ALTER TABLE public.customers DROP COLUMN legacy_tier;",
        },
      ],
    });
    assert.equal(report.status, "incompatible");
    await assert.rejects(
      rpc("save", {
        job: retry.id,
        lease: retry.lease_token,
        report: { ...report, proposed: { commit: "c".repeat(40) } },
      }),
      /match job/,
    );
    const saved = (await rpc("save", { job: retry.id, lease: retry.lease_token, report })) as {
      scan: string;
    };
    assert.ok(saved.scan);
    assert.deepEqual(await rpc("save", { job: retry.id, lease: retry.lease_token, report }), saved);
    assert.deepEqual(
      await rpc("report", { job: retry.id, lease: retry.lease_token }),
      JSON.parse(JSON.stringify(report)),
    );
    assert.ok(
      (await db.query<{ count: number }>("select count(*)::int count from public.finding_evidence"))
        .rows[0]?.count,
    );
    await rpc("disconnect", common);
    await assert.rejects(rpc("finish", { job: retry.id, lease: retry.lease_token }), /lease/);
    assert.equal(
      (await db.query<{ count: number }>("select count(*)::int count from public.repositories"))
        .rows[0]?.count,
      1,
    );
    // Reconnect reuses the stable repository record and preserves reports.
    const reconnect = (await rpc("choices", { ...common, payload })) as { id: string };
    await rpc("select", { ...common, choice: reconnect.id, repositories: [10] });
    assert.equal(
      (await db.query<{ count: number }>("select count(*)::int count from public.scans")).rows[0]
        ?.count,
      1,
    );
    await rpc("configure", { ...common, repository, configuration, enabled: true });
    const event2 = {
      ...event,
      delivery: "00000000-0000-4000-8000-000000000021",
      payload: { ...event.payload, pull_request: { number: 1, head: { sha: "c".repeat(40) } } },
    };
    await rpc("webhook", event2);
    const leased = (await rpc("claim", {})) as { id: string; lease_token: string };
    assert.ok(leased.id);
    await db.exec(
      "update public.github_jobs set lease_until=now()-interval '1 minute' where status='running'",
    );
    const recovered = (await rpc("claim", {})) as {
      id: string;
      lease_token: string;
      attempts: number;
    };
    assert.equal(recovered.attempts, 2);
    await assert.rejects(rpc("finish", { job: leased.id, lease: leased.lease_token }), /lease/);
    await rpc("fail", { job: recovered.id, lease: recovered.lease_token, error: "outage" });
    await db.exec(
      "update public.github_jobs set available_at=now()-interval '1 minute' where status='queued'",
    );
    const finalAttempt = (await rpc("claim", {})) as {
      id: string;
      lease_token: string;
      attempts: number;
    };
    assert.equal(finalAttempt.attempts, 3);
    await rpc("fail", { job: finalAttempt.id, lease: finalAttempt.lease_token, error: "outage" });
    assert.equal(await rpc("claim", {}), null);
    await rpc("webhook", {
      delivery: "00000000-0000-4000-8000-000000000022",
      event: "installation",
      payload: { action: "suspend", installation: { id: 42 } },
    });
    assert.equal(
      ((await rpc("dashboard", common)) as { connections: { status: string }[] }).connections[0]
        ?.status,
      "suspended",
    );
    await rpc("webhook", {
      delivery: "00000000-0000-4000-8000-000000000023",
      event: "installation",
      payload: { action: "unsuspend", installation: { id: 42 } },
    });
    assert.equal(
      ((await rpc("dashboard", common)) as { connections: { status: string }[] }).connections[0]
        ?.status,
      "needs_refresh",
    );
    await rpc("webhook", {
      delivery: "00000000-0000-4000-8000-000000000024",
      event: "installation_repositories",
      payload: { installation: { id: 42 }, repositories_removed: [{ id: 10 }] },
    });
    assert.equal(
      ((await rpc("dashboard", common)) as { repositories: { status: string; enabled: boolean }[] })
        .repositories[0]?.status,
      "revoked",
    );
    assert.equal(
      (await db.query<{ count: number }>("select count(*)::int count from public.scans")).rows[0]
        ?.count,
      1,
    );
    await db.transaction(async (tx) => {
      await tx.exec("set local role authenticated");
      await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [other]);
      assert.equal((await tx.query("select * from public.github_connections")).rows.length, 0);
    });
    await assert.rejects(
      db.transaction(async (tx) => {
        await tx.exec("set local role authenticated");
        await tx.query("select public.rollbackiq_github_service('claim','{}')");
      }),
      /permission denied/,
    );
  } finally {
    await db.close();
  }
});

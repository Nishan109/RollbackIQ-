import assert from "node:assert/strict";
import { createHmac, generateKeyPairSync, verify } from "node:crypto";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { analyzeCompatibility } from "@rollbackiq/scanner-core/compatibility";
import { beginAuthorization, consumeAuthorization } from "./authorization";
import { checkOutput, recoverCheck } from "./checks";
import { githubReady, githubSettings } from "./config";
import { jobSchema, scanConfiguration } from "./contracts";
import { Github } from "./provider";
import { githubCallback, githubPost, githubSetup } from "./routes";
import { boundedBytes, pkceChallenge, validSignature } from "./security";
import { githubSnapshot } from "./snapshot";
import { receiveWebhook } from "./webhook";
import { runGithubJob } from "./worker";

const actor = "00000000-0000-4000-8000-000000000001";
const organization = "00000000-0000-4000-8000-000000000002";
const repositoryId = "00000000-0000-4000-8000-000000000003";
const jobId = "00000000-0000-4000-8000-000000000004";
const previous = "a".repeat(40),
  head = "b".repeat(40);

test("GitHub snapshots resolve shared clients using each revision's committed module configuration", async () => {
  const env = environment();
  try {
    const oldTree = "c".repeat(40),
      newTree = "d".repeat(40);
    const blobs = new Map<string, string>();
    function entry(path: string, text: string) {
      const sha = (blobs.size + 10).toString(16).padStart(40, "0");
      blobs.set(sha, text);
      return { path, sha, type: "blob", mode: "100644", size: Buffer.byteLength(text) };
    }
    const helper =
      'import {createServerClient} from "@supabase/ssr";export async function connect(){return createServerClient(url,key);}';
    const config = (target: string) =>
      JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@/client": [target] } } });
    const oldEntries = [
      entry("tsconfig.json", config("src/old-client.ts")),
      entry("src/old-client.ts", helper),
      entry(
        "src/main.ts",
        'import {connect} from "@/client";const client=await connect();client.from("users").select("legacy_tier");',
      ),
    ];
    const newEntries = [
      entry("tsconfig.json", config("src/new-client.ts")),
      entry("src/new-client.ts", helper),
      entry(
        "src/main.ts",
        'import {connect} from "@/client";const client=await connect();client.from("users").select("id");',
      ),
      entry("migrations/002.sql", "ALTER TABLE public.users DROP COLUMN legacy_tier;"),
    ];
    const provider = new Github(async (input) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith(`/commits/${previous}`))
        return Response.json({ sha: previous, commit: { tree: { sha: oldTree } } });
      if (path.endsWith(`/commits/${head}`))
        return Response.json({ sha: head, commit: { tree: { sha: newTree } } });
      if (path.endsWith(`/git/trees/${oldTree}`))
        return Response.json({ truncated: false, tree: oldEntries });
      if (path.endsWith(`/git/trees/${newTree}`))
        return Response.json({ truncated: false, tree: newEntries });
      if (path.includes("/compare/")) return Response.json({ status: "ahead" });
      const blob = blobs.get(path.split("/").at(-1) ?? "");
      if (blob !== undefined)
        return Response.json({
          encoding: "base64",
          content: Buffer.from(blob).toString("base64"),
          size: Buffer.byteLength(blob),
        });
      throw new Error("Unexpected snapshot request");
    });
    const snapshot = await githubSnapshot(
      provider,
      "test-token",
      "org/repo",
      head,
      scanConfiguration.parse({ migrations: "migrations", sources: ["src"], previous }),
    );
    const report = await analyzeCompatibility(snapshot);
    assert.equal(snapshot.previous.typescriptConfigs?.length, 1);
    assert.equal(snapshot.proposed.typescriptConfigs?.length, 1);
    assert.equal(report.dependencies.previous.queries, 1);
    assert.equal(report.dependencies.proposed.queries, 1);
    assert.equal(report.coverage.gaps.length, 0);
    assert.equal(report.status, "incompatible");
  } finally {
    env.restore();
  }
});
function environment() {
  const original = { ...process.env };
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  Object.assign(process.env, {
    APP_URL: "http://localhost:3000",
    GITHUB_APP_ID: "1",
    GITHUB_APP_SLUG: "rollbackiq-test",
    GITHUB_CLIENT_ID: "test-client",
    GITHUB_CLIENT_SECRET: "test-secret",
    GITHUB_WEBHOOK_SECRET: "webhook-test",
    GITHUB_APP_PRIVATE_KEY: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  });
  return {
    publicKey,
    restore: () => {
      process.env = original;
    },
  };
}
test("GitHub authorization binds single-use state, uses PKCE and validates cookies before consumption", async () => {
  const env = environment();
  try {
    const states = new Map<string, { organization: string; actor: string; phase: string }>();
    const store = async (action: string, data: Record<string, unknown>) => {
      if (action === "begin") {
        states.set(
          String(data.hash),
          data as { organization: string; actor: string; phase: string },
        );
        return {};
      }
      const state = states.get(String(data.hash));
      if (!state || state.actor !== data.actor || state.phase !== data.phase)
        throw new Error("Invalid state");
      states.delete(String(data.hash));
      return { organization: state.organization };
    };
    const flow = await beginAuthorization(store, new Github(), actor, organization, 42);
    const url = new URL(flow.url);
    assert.equal(url.searchParams.get("code_challenge"), pkceChallenge(flow.cookie.verifier));
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    assert.equal(url.searchParams.has("client_secret"), false);
    await assert.rejects(
      consumeAuthorization(store, actor, JSON.stringify(flow.cookie), "spoofed", "oauth"),
    );
    await assert.rejects(
      consumeAuthorization(
        store,
        "wrong-user",
        JSON.stringify(flow.cookie),
        flow.cookie.state,
        "oauth",
      ),
    );
    assert.equal(
      (
        await consumeAuthorization(
          store,
          actor,
          JSON.stringify(flow.cookie),
          flow.cookie.state,
          "oauth",
        )
      ).organization,
      organization,
    );
    await assert.rejects(
      consumeAuthorization(store, actor, JSON.stringify(flow.cookie), flow.cookie.state, "oauth"),
    );
    assert.equal(githubSettings()?.appId, 1);
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    assert.equal(githubReady(), false);
    delete process.env.GITHUB_CLIENT_SECRET;
    assert.equal(githubSettings(), null);
  } finally {
    env.restore();
  }
});

test("GitHub routes fail closed for missing configuration and cross-origin writes", async () => {
  const env = environment();
  try {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const request = new Request("http://localhost:3000/api/github/connect", {
      method: "POST",
      body: "organization=x",
    });
    assert.equal((await githubPost("connect")(request)).status, 503);
    assert.equal(
      (await githubSetup(new Request("http://localhost:3000/api/github/setup"))).status,
      503,
    );
    assert.equal(
      (await githubCallback(new Request("http://localhost:3000/api/github/callback"))).status,
      503,
    );
    Object.assign(process.env, {
      SUPABASE_SERVICE_ROLE_KEY: "test-service",
      NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "test-publishable",
    });
    assert.equal(
      (
        await githubPost("connect")(
          new Request("http://localhost:3000/api/github/connect", {
            method: "POST",
            headers: { origin: "https://attacker.example" },
            body: "organization=x",
          }),
        )
      ).status,
      403,
    );
  } finally {
    env.restore();
  }
});
test("GitHub JWT and user authorization enforce App identity and repository admin access", async () => {
  const env = environment();
  try {
    let expectedApp = 1;
    const calls: { url: string; body?: string }[] = [];
    const provider = new Github(async (input, init) => {
      const url = String(input);
      calls.push({ url, body: init?.body?.toString() });
      assert.match(url, /^https:\/\/(api\.)?github\.com\//);
      if (url.includes("access_token")) return Response.json({ access_token: "user-token" });
      if (url.includes("/user/installations/42/repositories"))
        return Response.json({
          total_count: 2,
          repositories: [
            { id: 10, full_name: "org/admin", permissions: { admin: true } },
            { id: 11, full_name: "org/read", permissions: { admin: false } },
          ],
        });
      if (url.endsWith("/user")) return Response.json({ id: 100 });
      return Response.json({
        id: 42,
        app_id: expectedApp,
        account: { id: 200, login: "org" },
        suspended_at: null,
      });
    });
    const jwt = provider.jwt(),
      [header, body, signature] = jwt.split(".");
    assert.ok(signature);
    assert.equal(
      verify(
        "RSA-SHA256",
        Buffer.from(`${header}.${body}`),
        env.publicKey,
        Buffer.from(signature, "base64url"),
      ),
      true,
    );
    const result = await provider.authorizedChoices("user-token", 42);
    assert.deepEqual(
      result.repositories.map((r) => r.id),
      [10],
    );
    expectedApp = 2;
    await assert.rejects(provider.authorizedChoices("user-token", 42), /unavailable/);
    await provider.exchange("code", "verifier");
    const exchange = JSON.parse(calls.at(-1)?.body ?? "{}");
    assert.equal(exchange.code_verifier, "verifier");
    await assert.rejects(provider.request("//evil.example/path", "token"));
    const failed = new Github(async () =>
      Response.json({ secret: "provider response" }, { status: 401 }),
    );
    await assert.rejects(
      failed.authorizedChoices("expired", 42),
      (e) => e instanceof Error && !e.message.includes("provider response"),
    );
  } finally {
    env.restore();
  }
});
test("webhooks validate original bytes, reject forgery and bound bodies before durable acceptance", async () => {
  const secret = "test-webhook";
  const delivery = "00000000-0000-4000-8000-000000000011";
  const raw = JSON.stringify({
    action: "opened",
    installation: { id: 42 },
    repository: { id: 10, full_name: "org/repo" },
    pull_request: { number: 1, head: { sha: head }, body: "private comment" },
    organization: "attacker-tenant",
  });
  const signature = `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
  assert.equal(validSignature(Buffer.from(`${raw} `), signature, secret), false);
  let stored: Record<string, unknown> | undefined;
  let calls = 0;
  const store = async (_action: string, data: Record<string, unknown>) => {
    calls++;
    stored = data;
    return { duplicate: calls > 1 };
  };
  const request = (sig = signature, body = raw) =>
    new Request("http://localhost/api/github/webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-github-delivery": delivery,
        "x-github-event": "pull_request",
        "x-hub-signature-256": sig,
      },
      body,
    });
  assert.equal((await receiveWebhook(request("invalid"), secret, store)).status, 401);
  assert.equal(calls, 0);
  assert.equal((await receiveWebhook(request(), secret, store)).status, 202);
  assert.equal(JSON.stringify(stored).includes("private comment"), false);
  assert.equal(JSON.stringify(stored).includes("attacker-tenant"), false);
  assert.equal((await receiveWebhook(request(), secret, store)).status, 202);
  const oversized = new Request("http://localhost", {
    method: "POST",
    headers: { "content-length": "1048577" },
    body: "x",
  });
  assert.equal((await receiveWebhook(oversized, secret, store)).status, 413);
  await assert.rejects(boundedBytes(new Response("too much").body, 2), /size limit/);
});
test("GitHub worker scans committed blobs, persists evidence and publishes a commit-scoped Check", async () => {
  const env = environment();
  try {
    const calls: { path: string; method: string; body: unknown }[] = [];
    const reports: unknown[] = [];
    const source = "export const q = db.query('SELECT legacy_tier FROM public.customers');";
    const sql = "ALTER TABLE public.customers DROP COLUMN legacy_tier;";
    const sourceSha = "c".repeat(40),
      sqlSha = "d".repeat(40),
      treeOld = "e".repeat(40),
      treeNew = "f".repeat(40);
    const config = scanConfiguration.parse({
      migrations: "migrations",
      sources: ["src"],
      previous: "v1",
    });
    const job = {
      id: jobId,
      organization_id: organization,
      repository_id: repositoryId,
      installation_id: 42,
      github_id: 10,
      full_name: "org/repo",
      pull_number: 1,
      head_sha: head,
      lease_token: jobId,
      check_id: null,
      configuration: config,
      attempts: 1,
      scan_id: null,
    };
    let override:
      | ((path: string, method: string, body: unknown) => Response | Promise<Response> | undefined)
      | undefined;
    const provider = (signal?: AbortSignal) =>
      new Github(async (input, init) => {
        const path = new URL(String(input)).pathname;
        const body = init?.body ? JSON.parse(String(init.body)) : undefined;
        calls.push({ path, method: init?.method ?? "GET", body });
        const response = override?.(path, init?.method ?? "GET", body);
        if (response) return response;
        if (path === "/app/installations/42")
          return Response.json({
            id: 42,
            app_id: 1,
            account: { id: 200, login: "org" },
            permissions: { checks: "write" },
          });
        if (path.endsWith("/access_tokens"))
          return Response.json({
            token: "installation-token",
            expires_at: new Date(Date.now() + 3600000).toISOString(),
          });
        if (path === "/repos/org/repo") return Response.json({ id: 10, full_name: "org/repo" });
        if (path.endsWith("/pulls/1"))
          return Response.json({ state: "open", head: { sha: head }, base: { repo: { id: 10 } } });
        if (path.endsWith(`/commits/${head}/check-runs`))
          return Response.json({ total_count: 0, check_runs: [] });
        if (path.endsWith("/check-runs")) return Response.json({ id: 900 });
        if (path.endsWith("/check-runs/900"))
          return Response.json({
            id: 900,
            app: { id: 1 },
            head_sha: head,
            external_id: jobId,
            status: "in_progress",
          });
        if (path.endsWith("/commits/v1"))
          return Response.json({ sha: previous, commit: { tree: { sha: treeOld } } });
        if (path.endsWith(`/commits/${head}`))
          return Response.json({ sha: head, commit: { tree: { sha: treeNew } } });
        if (path.includes("/git/trees/"))
          return Response.json({
            truncated: false,
            tree: [
              {
                path: "src/customers.ts",
                mode: "100644",
                type: "blob",
                sha: sourceSha,
                size: Buffer.byteLength(source),
              },
              ...(path.endsWith(treeNew)
                ? [
                    {
                      path: "migrations/002_drop.sql",
                      mode: "100644",
                      type: "blob",
                      sha: sqlSha,
                      size: Buffer.byteLength(sql),
                    },
                  ]
                : []),
            ],
          });
        if (path.includes("/compare/")) return Response.json({ status: "ahead" });
        if (path.includes("/git/blobs/")) {
          const text = path.endsWith(sourceSha) ? source : sql;
          return Response.json({
            encoding: "base64",
            content: Buffer.from(text).toString("base64"),
            size: Buffer.byteLength(text),
          });
        }
        throw new Error(`Unexpected test request ${path}`);
      }, signal);
    const actions: string[] = [];
    const store = async (action: string, data: Record<string, unknown>) => {
      actions.push(action);
      if (action === "claim") return job;
      if (action === "save") {
        reports.push(data.report);
        return { scan: repositoryId };
      }
      return {};
    };
    assert.equal(await runGithubJob(store, provider), true);
    assert.equal(actions.at(-1), "finish");
    const report = reports[0] as {
      status: string;
      findings: { ruleId: string }[];
      previous: { commit: string };
      proposed: { commit: string };
    };
    assert.equal(report.status, "incompatible");
    assert.ok(report.findings.some((f) => f.ruleId === "COMPAT001"));
    assert.equal(report.previous.commit, previous);
    assert.equal(report.proposed.commit, head);
    const check = calls.find((c) => c.method === "PATCH")?.body as {
      conclusion: string;
      details_url: string;
      output: { summary: string; annotations: { path: string; start_line: number }[] };
    };
    assert.equal(check.conclusion, "failure");
    assert.match(check.details_url, new RegExp(repositoryId));
    assert.match(check.output.summary, /Previous-release queries: 1/);
    assert.equal(check.output.annotations[0]?.path, "migrations/002_drop.sql");
    assert.equal(check.output.annotations[0]?.start_line, 1);
    const created = calls.find((c) => c.method === "POST" && c.path.endsWith("/check-runs"));
    assert.ok(created);
    assert.equal((created.body as { head_sha: string }).head_sha, head);
    // A superseded PR is cancelled before any repository snapshot or report is read.
    const staleProvider = () => {
      const base = provider();
      const request = base.request.bind(base);
      base.request = async (path, token, method, body) =>
        path.endsWith("/pulls/1")
          ? { state: "open", head: { sha: previous }, base: { repo: { id: 10 } } }
          : request(path, token, method, body);
      return base;
    };
    const failures: Record<string, unknown>[] = [];
    await runGithubJob(async (action, data) => {
      if (action === "claim") return job;
      if (action === "fail") failures.push(data);
      if (action === "save") assert.fail("stale scan saved");
      return {};
    }, staleProvider);
    assert.equal(failures[0]?.cancelled, true);
    // A provider outage requeues the lease and never creates a successful report.
    const outageFailures: Record<string, unknown>[] = [];
    await runGithubJob(
      async (action, data) => {
        if (action === "claim") return job;
        if (action === "save") assert.fail("outage saved a report");
        if (action === "fail") outageFailures.push(data);
        return {};
      },
      () =>
        new Github(async () =>
          Response.json({ error: "private provider response" }, { status: 503 }),
        ),
    );
    assert.equal(outageFailures[0]?.cancelled, false);
    assert.equal(JSON.stringify(outageFailures).includes("private provider response"), false);
    // Check publication retries reuse the persisted report without reading blobs.
    const before = calls.filter((c) => c.path.includes("/git/blobs/")).length;
    await runGithubJob(async (action) => {
      if (action === "claim") return { ...job, scan_id: repositoryId, check_id: 900 };
      if (action === "report") return report;
      if (action === "save") return { scan: repositoryId };
      return {};
    }, provider);
    assert.equal(calls.filter((c) => c.path.includes("/git/blobs/")).length, before);

    const run = async (
      customJob: Record<string, unknown> = {},
      options?: Parameters<typeof runGithubJob>[2],
    ) => {
      calls.length = 0;
      const operations: { action: string; data: Record<string, unknown> }[] = [];
      await runGithubJob(
        async (action, data) => {
          operations.push({ action, data });
          if (action === "claim") return { ...job, ...customJob };
          if (action === "save") return { scan: repositoryId };
          if (action === "report") return report;
          return {};
        },
        provider,
        options,
      );
      return operations;
    };
    for (const granted of [false, true]) {
      override = (path) =>
        path === "/app/installations/42"
          ? Response.json({
              id: 42,
              app_id: 1,
              account: { id: 200, login: "org" },
              permissions: {},
            })
          : path === "/app"
            ? Response.json({ permissions: granted ? { checks: "write" } : {} })
            : undefined;
      const operations = await run();
      assert.ok(
        operations.some(
          ({ action, data }) =>
            action === "checkpoint" &&
            data.state === "blocked" &&
            data.reason === (granted ? "installation_approval_required" : "permission_missing"),
        ),
      );
      assert.ok(operations.some(({ action }) => action === "save"));
      assert.equal(operations.at(-1)?.action, "finish");
      assert.ok(!calls.some((c) => c.path.endsWith("/check-runs")));
    }
    const disabled = await run({ configuration: { ...config, publishChecks: false } });
    assert.ok(
      disabled.some(({ action, data }) => action === "checkpoint" && data.state === "disabled"),
    );
    assert.ok(!calls.some((c) => c.path.endsWith("/check-runs")));
    let tokenIssued = 0;
    let repoCalls = 0;
    override = (path) => {
      if (path.endsWith("/access_tokens"))
        return Response.json({
          token: `test-token-${++tokenIssued}`,
          expires_at: new Date().toISOString(),
        });
      if (path === "/repos/org/repo" && ++repoCalls === 1)
        return Response.json({}, { status: 401 });
    };
    assert.equal((await run()).at(-1)?.action, "finish");
    assert.equal(tokenIssued, 2);
    override = (path) =>
      path === "/repos/org/repo" ? Response.json({}, { status: 404 }) : undefined;
    assert.equal((await run()).at(-1)?.data.reason, "repository_not_installed");
    override = (path) =>
      path === "/repos/org/repo"
        ? Response.json({}, { status: 403, headers: { "retry-after": "90" } })
        : undefined;
    assert.equal((await run()).at(-1)?.data.retryAfter, 90);

    for (const phase of ["POST", "PATCH"]) {
      override = (path, method) =>
        path.includes("/check-runs") && method === phase
          ? Response.json({}, { status: 503 })
          : undefined;
      const operations = await run();
      assert.ok(
        operations.some(({ action }) => action === "save"),
        phase,
      );
      assert.equal(operations.at(-1)?.data.reason, "provider_unavailable", phase);
      assert.equal(operations.at(-1)?.data.retry, true, phase);
      const exhausted = await run({ attempts: 3 });
      assert.equal(exhausted.at(-1)?.action, "finish", phase);
      assert.ok(
        exhausted.some(({ action, data }) => action === "checkpoint" && data.state === "failed"),
        phase,
      );
    }
    override = (path) =>
      path.includes("/git/blobs/") ? Response.json({}, { status: 503 }) : undefined;
    const incomplete = await run();
    assert.ok(
      !incomplete.some(({ action }) => action === "save"),
      "a provider outage cannot become a coverage finding",
    );
    assert.equal(incomplete.at(-1)?.data.reason, "provider_unavailable");

    override = (path, method) =>
      method === "GET" && path.endsWith("/check-runs/900")
        ? Response.json({
            id: 900,
            app: { id: 1 },
            head_sha: head,
            external_id: jobId,
            status: "completed",
            conclusion: "failure",
            details_url: check.details_url,
          })
        : undefined;
    assert.equal(
      (await run({ scan_id: repositoryId, check_id: 900, attempts: 2 })).at(-1)?.action,
      "finish",
    );
    assert.ok(!calls.some((c) => c.method === "PATCH"), "annotations must not append twice");
    override = (path, method) =>
      method === "GET" && path.endsWith("/check-runs/900")
        ? Response.json({
            id: 900,
            app: { id: 2 },
            head_sha: head,
            external_id: jobId,
            status: "in_progress",
          })
        : undefined;
    const wrongApp = await run({ scan_id: repositoryId, check_id: 900, attempts: 2 });
    assert.ok(
      wrongApp.some(
        ({ action, data }) => action === "checkpoint" && data.reason === "recovery_incomplete",
      ),
    );
    assert.ok(!calls.some((c) => c.method === "PATCH"));

    override = (path) =>
      path.includes("/git/blobs/") ? delay(150, Response.json({}, { status: 503 })) : undefined;
    const timedOut = await run({ attempts: 3 }, { timeoutMs: 100, heartbeatMs: 10 });
    assert.ok(timedOut.some(({ action }) => action === "renew"));
    assert.ok(!timedOut.some(({ action }) => action === "save"));
    assert.equal(timedOut.at(-1)?.data.reason, "timed_out");
    assert.equal(timedOut.at(-1)?.data.conclusion, "timed_out");

    override = (path) =>
      path.endsWith("/pulls/1")
        ? Response.json({
            state: "closed",
            head: { sha: head },
            base: { repo: { id: 10 } },
          })
        : undefined;
    assert.equal((await run({ check_id: 900 })).at(-1)?.data.conclusion, "cancelled");
  } finally {
    env.restore();
  }
});

test("Check policy treats uncertainty independently and annotations only target candidate migration files", async () => {
  const job = jobSchema.parse({
    id: jobId,
    organization_id: organization,
    repository_id: repositoryId,
    installation_id: 42,
    github_id: 10,
    full_name: "org/repo",
    pull_number: 1,
    head_sha: head,
    lease_token: jobId,
    check_id: null,
    attempts: 1,
    scan_id: null,
    configuration: { migrations: "migrations", sources: ["src"], previous: "v1" },
  });
  const source = [
    { path: "src/query.ts", text: 'db.query("SELECT legacy FROM public.customers")' },
  ];
  const migration = {
    path: "migrations/001.sql",
    sql: "ALTER TABLE public.customers DROP COLUMN legacy;",
  };
  const report = await analyzeCompatibility({
    previous: { release: { ref: previous }, sources: source },
    proposed: { release: { ref: head }, sources: source },
    migrations: [migration],
    migrationChanges: [{ path: migration.path, status: "added" }],
  });
  const reportUrl = "https://rollbackiq.example/reports/example";
  const output = (data: typeof report, config = job.configuration) =>
    checkOutput(data, { ...job, configuration: config }, reportUrl);
  assert.equal(output(report).conclusion, "failure");
  const first = report.findings[0];
  assert.ok(first);
  const findings = Array.from({ length: 60 }, (_, index) => ({ ...first, id: String(index) }));
  assert.equal(output({ ...report, findings }).output.annotations?.length, 50);
  assert.equal(
    output({
      ...report,
      findings: findings.map((f) => ({
        ...f,
        location: { path: "src/query.ts", line: 1, column: 1 },
      })),
    }).output.annotations,
    undefined,
  );
  const clean = { ...report, findings: [], migrationReport: null };
  assert.equal(
    output({ ...clean, status: "compatible_within_analyzed_scope" }).conclusion,
    "success",
  );
  assert.equal(output({ ...clean, status: "potentially_incompatible" }).conclusion, "neutral");
  const unknown = { ...clean, status: "unknown" as const };
  assert.equal(output(unknown).conclusion, "action_required");
  assert.equal(
    output(unknown, {
      ...job.configuration,
      checkPolicy: { failOn: "none", incomplete: "failure" },
    }).conclusion,
    "failure",
  );
  assert.equal(
    output(report, {
      ...job.configuration,
      checkPolicy: { failOn: "none", incomplete: "action_required" },
    }).conclusion,
    "failure",
  );

  const prior = {
    id: 900,
    app: { id: 1 },
    head_sha: head,
    external_id: jobId,
    status: "in_progress",
  };
  const pages: number[] = [];
  const recovered = await recoverCheck(
    async (path) => {
      const page = Number(new URL(path, "https://api.github.com").searchParams.get("page"));
      pages.push(page);
      return {
        total_count: 101,
        check_runs:
          page === 2
            ? [prior]
            : Array.from({ length: 100 }, (_, i) => ({
                ...prior,
                id: i + 1,
                external_id: "other",
              })),
      };
    },
    job,
    1,
  );
  assert.deepEqual(pages, [1, 2]);
  assert.equal(recovered?.id, 900);
  await assert.rejects(
    recoverCheck(async () => ({ total_count: 101, check_runs: [] }), job, 1),
    /identified safely/,
  );
});

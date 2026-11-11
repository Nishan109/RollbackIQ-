import assert from "node:assert/strict";
import { createHmac, generateKeyPairSync, verify } from "node:crypto";
import { test } from "node:test";
import { beginAuthorization, consumeAuthorization } from "./authorization";
import { githubReady, githubSettings } from "./config";
import { scanConfiguration } from "./contracts";
import { Github } from "./provider";
import { githubCallback, githubPost, githubSetup } from "./routes";
import { boundedBytes, pkceChallenge, validSignature } from "./security";
import { receiveWebhook } from "./webhook";
import { runGithubJob } from "./worker";

const actor = "00000000-0000-4000-8000-000000000001";
const organization = "00000000-0000-4000-8000-000000000002";
const repositoryId = "00000000-0000-4000-8000-000000000003";
const jobId = "00000000-0000-4000-8000-000000000004";
const previous = "a".repeat(40),
  head = "b".repeat(40);
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
    const provider = () =>
      new Github(async (input, init) => {
        const path = new URL(String(input)).pathname;
        const body = init?.body ? JSON.parse(String(init.body)) : undefined;
        calls.push({ path, method: init?.method ?? "GET", body });
        if (path === "/app/installations/42")
          return Response.json({ id: 42, app_id: 1, account: { id: 200, login: "org" } });
        if (path.endsWith("/access_tokens"))
          return Response.json({
            token: "installation-token",
            expires_at: new Date(Date.now() + 3600000).toISOString(),
          });
        if (path === "/repos/org/repo") return Response.json({ id: 10, full_name: "org/repo" });
        if (path.endsWith("/pulls/1"))
          return Response.json({ state: "open", head: { sha: head }, base: { repo: { id: 10 } } });
        if (path.endsWith(`/commits/${head}/check-runs`)) return Response.json({ check_runs: [] });
        if (path.endsWith("/check-runs")) return Response.json({ id: 900 });
        if (path.endsWith("/check-runs/900")) return Response.json({ id: 900 });
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
      });
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
    const check = calls.find((c) => c.method === "PATCH")?.body as { conclusion: string };
    assert.equal(check.conclusion, "action_required");
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
  } finally {
    env.restore();
  }
});

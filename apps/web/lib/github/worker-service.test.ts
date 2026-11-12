import assert from "node:assert/strict";
import { test } from "node:test";
import type { GithubRpc } from "./store";
import { runWorkerService, verifyWorkerDependencies, workerHealth } from "./worker-service";

const release = "a".repeat(40);
const origin = "https://rollbackiq.example";
const store: GithubRpc = async () => ({ protocol: 2 });

test("worker readiness expires when queue contact stops and switches off while draining", () => {
  let now = 1000;
  const health = workerHealth(release, () => now);
  assert.equal(health.response("/livez").code, 200);
  assert.equal(health.response("/readyz").code, 503);
  assert.equal(health.response("/unknown").code, 404);
  health.contact();
  assert.equal(health.response("/readyz").code, 200);
  now += 76_000;
  assert.equal(health.response("/readyz").code, 503);
  health.contact();
  health.drain();
  assert.equal(health.response("/readyz").code, 503);
});

test("production worker checks database protocol and web release before claiming", async () => {
  await verifyWorkerDependencies(store, origin, release, true, async (url, options) => {
    assert.equal(String(url), `${origin}/api/health`);
    assert.equal(options?.redirect, "error");
    return Response.json({ release, workerProtocol: 2 });
  });
  await assert.rejects(
    verifyWorkerDependencies(store, origin, release, true, async () =>
      Response.json({ release: "b".repeat(40), workerProtocol: 2 }),
    ),
    /web_release_mismatch/,
  );
  await assert.rejects(
    verifyWorkerDependencies(store, origin, release, true, async () =>
      Response.json({}, { status: 503 }),
    ),
    /web_unavailable/,
  );
  const actions: string[] = [];
  await assert.rejects(
    runWorkerService({
      store: async (action) => {
        actions.push(action);
        return { protocol: 1 };
      },
      origin,
      release,
      production: false,
      once: true,
      signal: new AbortController().signal,
    }),
    /queue_protocol_mismatch/,
  );
  assert.deepEqual(actions, ["health"]);
});

test("worker drains an active claim on shutdown without taking another claim", async () => {
  const shutdown = new AbortController();
  const actions: string[] = [];
  let arrived: () => void = () => assert.fail("claim barrier was not set");
  let releaseClaim: () => void = () => assert.fail("drain barrier was not set");
  const claimed = new Promise<void>((resolve) => {
    arrived = resolve;
  });
  const draining = new Promise<void>((resolve) => {
    releaseClaim = resolve;
  });
  const running = runWorkerService({
    origin,
    release,
    production: false,
    signal: shutdown.signal,
    store: async (action) => {
      actions.push(action);
      if (action === "health") return { protocol: 2 };
      assert.equal(action, "claim");
      arrived();
      await draining;
      return null;
    },
  });
  await claimed;
  shutdown.abort();
  releaseClaim();
  await running;
  assert.deepEqual(actions, ["health", "claim"]);
});

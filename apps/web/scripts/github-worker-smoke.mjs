import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const imageRelease = process.argv[2];
const release = imageRelease ?? "a".repeat(40);
if (imageRelease) {
  assert.match(imageRelease, /^[a-f0-9]{40}$/);
  assert.equal(process.env.ROLLBACKIQ_RELEASE, imageRelease);
  assert.equal(process.env.ROLLBACKIQ_WORKER_PRODUCTION, "true");
  assert.equal(process.env.NODE_ENV, "production");
  assert.ok(process.getuid?.() > 0, "Worker image must run as a non-root user");
}

async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return server.address().port;
}

async function close(server) {
  const closed = once(server, "close");
  server.close();
  server.closeAllConnections();
  await closed;
}

const portReservation = createServer();
const healthPort = await listen(portReservation);
await close(portReservation);
const testKey = "rollbackiq-worker-smoke-only";
const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs1", format: "pem" },
  publicKeyEncoding: { type: "pkcs1", format: "pem" },
});
let queueAvailable = true;
let queueTimesOut = false;
let claims = 0;
const queue = createServer(async (request, response) => {
  const reply = (status, data) => {
    response.writeHead(status, { "Content-Type": "application/json" });
    response.end(JSON.stringify(data));
  };
  if (
    request.method !== "POST" ||
    request.url !== "/rest/v1/rpc/rollbackiq_github_worker" ||
    request.headers.authorization !== `Bearer ${testKey}`
  )
    return reply(404, {});
  let raw = "";
  for await (const chunk of request) raw += chunk;
  const action = JSON.parse(raw).p_action;
  if (queueTimesOut) return;
  if (!queueAvailable) return reply(503, { message: "Disposable queue unavailable" });
  if (action === "health") return reply(200, { protocol: 2 });
  if (action === "claim") {
    claims++;
    return reply(200, null);
  }
  return reply(400, {});
});
const queueOrigin = `http://127.0.0.1:${await listen(queue)}`;
const windows = process.platform === "win32";
const controlDirectory = await mkdtemp(join(tmpdir(), "rollbackiq-worker-control-"));
const controlModule = new URL("../../../tools/worker-runtime.mjs", import.meta.url).href;
const workerArgs = windows
  ? [
      "--input-type=module",
      "--eval",
      `const { installWorkerControl } = await import(${JSON.stringify(controlModule)});
      installWorkerControl(process.env.WORKER_FIXTURE_CONTROL, ${JSON.stringify(release)}, ${healthPort});
      await import("./scripts/github-worker.ts");`,
    ]
  : ["scripts/github-worker.ts"];
const worker = spawn(process.execPath, ["--import", "tsx", ...workerArgs], {
  env: {
    Path: process.env.Path,
    SystemRoot: process.env.SystemRoot,
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
    NODE_ENV: "production",
    APP_URL: queueOrigin,
    NEXT_PUBLIC_SUPABASE_URL: queueOrigin,
    SUPABASE_SERVICE_ROLE_KEY: testKey,
    GITHUB_APP_ID: "1",
    GITHUB_APP_SLUG: "rollbackiq-smoke",
    GITHUB_CLIENT_ID: "smoke-client-id",
    GITHUB_APP_PRIVATE_KEY: privateKey,
    ROLLBACKIQ_WORKER_PRODUCTION: "false",
    ROLLBACKIQ_RELEASE: release,
    WORKER_HEALTH_HOST: "127.0.0.1",
    WORKER_HEALTH_PORT: String(healthPort),
    WORKER_FIXTURE_CONTROL: controlDirectory,
  },
  stdio: ["ignore", "inherit", "inherit"],
  windowsHide: true,
});
const exited = once(worker, "exit");

function health(path) {
  return fetch(`http://127.0.0.1:${healthPort}${path}`, { signal: AbortSignal.timeout(1500) });
}

async function waitForReadiness(expected) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline && worker.exitCode === null && worker.signalCode === null) {
    const response = await health("/readyz").catch(() => undefined);
    if (response?.status === expected) return response.json();
    await response?.body?.cancel();
    await delay(150);
  }
  assert.fail(`Worker did not reach readiness HTTP ${expected}`);
}

try {
  assert.deepEqual(await waitForReadiness(200), { status: "ok", release, protocol: 2 });
  queueAvailable = false;
  await waitForReadiness(503);
  const live = await health("/livez");
  assert.equal(live.status, 200);
  await live.body?.cancel();
  queueAvailable = true;
  assert.deepEqual(await waitForReadiness(200), { status: "ok", release, protocol: 2 });
  queueTimesOut = true;
  await waitForReadiness(503);
  queueTimesOut = false;
  assert.deepEqual(await waitForReadiness(200), { status: "ok", release, protocol: 2 });
  assert.ok(claims > 0, "Worker did not poll the disposable queue");
} finally {
  if (windows) {
    const control = JSON.parse(
      await readFile(join(controlDirectory, "worker-control.json"), "utf8"),
    );
    await writeFile(join(controlDirectory, control.stopFile), "drain");
  }
  if (!windows) worker.kill("SIGTERM");
  const result = await Promise.race([exited, delay(8000, null, { ref: false })]);
  if (!result) {
    worker.kill("SIGKILL");
    await exited;
  }
  await close(queue);
  await rm(controlDirectory, { recursive: true, force: true });
  assert.ok(result, "Worker did not stop within eight seconds");
  assert.deepEqual(result, [0, null]);
}
console.info("Worker startup, readiness, liveness, queue recovery and graceful exit verified.");

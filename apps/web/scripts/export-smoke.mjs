import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { generateKeyPairSync, sign } from "node:crypto";
import { once } from "node:events";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { analyzeCompatibility } from "@rollbackiq/scanner-core/compatibility";

const require = createRequire(import.meta.url);
const release = process.env.ROLLBACKIQ_RELEASE ?? "a".repeat(40);
const owner = "00000000-0000-4000-8000-000000000001";
const nonMember = "00000000-0000-4000-8000-000000000002";
const report = await analyzeCompatibility({
  previous: { release: { ref: "previous", commit: "a".repeat(40) }, sources: [] },
  proposed: { release: { ref: "proposed", commit: "b".repeat(40) }, sources: [] },
  migrations: [
    { path: "supabase/migrations/qa.sql", sql: "ALTER TABLE public.qa ENABLE ROW LEVEL SECURITY;" },
  ],
});
const scan = process.argv[2]
  ? JSON.parse(await readFile(process.argv[2], "utf8"))
  : {
      id: "00000000-0000-4000-8000-000000000003",
      repository_id: owner,
      created_at: "2026-11-12T00:00:00Z",
      status: report.status,
      report,
    };
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const publicJwk = {
  ...publicKey.export({ format: "jwk" }),
  kid: "fixture-key",
  alg: "RS256",
  use: "sig",
};
const identities = new Map();
let malformed = false;
let authorizedReads = 0;

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

const persistence = createServer((request, response) => {
  const url = new URL(request.url, "http://127.0.0.1");
  const identity = identities.get(request.headers.authorization);
  const reply = (status, body) => {
    response.writeHead(status, { "Content-Type": "application/json" });
    response.end(JSON.stringify(body));
  };
  if (url.pathname === "/auth/v1/.well-known/jwks.json") return reply(200, { keys: [publicJwk] });
  if (!identity) return reply(401, { message: "Fixture session rejected" });
  if (url.pathname === "/auth/v1/user")
    return reply(200, {
      id: identity,
      aud: "authenticated",
      role: "authenticated",
      is_anonymous: false,
    });
  if (url.pathname === "/rest/v1/scans" && url.searchParams.get("id") === `eq.${scan.id}`) {
    authorizedReads++;
    const rows =
      identity === owner
        ? [{ ...scan, report: malformed ? { fixture: "private-data" } : scan.report }]
        : [];
    return reply(200, request.headers.accept?.includes("object+json") ? (rows[0] ?? null) : rows);
  }
  return reply(404, { message: "Unknown fixture endpoint" });
});
const persistenceOrigin = `http://127.0.0.1:${await listen(persistence)}`;

function cookie(identity) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(
    JSON.stringify({ alg: "RS256", typ: "JWT", kid: "fixture-key" }),
  ).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      iss: `${persistenceOrigin}/auth/v1`,
      sub: identity,
      aud: "authenticated",
      role: "authenticated",
      iat: now,
      exp: now + 3600,
      session_id: identity,
      aal: "aal1",
      is_anonymous: false,
    }),
  ).toString("base64url");
  const unsigned = `${header}.${payload}`;
  const token = `${unsigned}.${sign("RSA-SHA256", Buffer.from(unsigned), privateKey).toString("base64url")}`;
  identities.set(`Bearer ${token}`, identity);
  const session = {
    access_token: token,
    refresh_token: "disposable-fixture-only",
    token_type: "bearer",
    expires_at: now + 3600,
    expires_in: 3600,
    user: { id: identity, is_anonymous: false },
  };
  return `sb-127-auth-token=base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`;
}

const ownerCookie = cookie(owner);
const otherCookie = cookie(nonMember);
const reservation = createServer();
const appPort = await listen(reservation);
await close(reservation);
const origin = `http://127.0.0.1:${appPort}`;
const app = spawn(
  process.execPath,
  [
    require.resolve("next/dist/bin/next"),
    "start",
    "--hostname",
    "127.0.0.1",
    "--port",
    String(appPort),
  ],
  {
    env: {
      Path: process.env.Path,
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      TEMP: process.env.TEMP,
      TMP: process.env.TMP,
      NODE_ENV: "production",
      NEXT_TELEMETRY_DISABLED: "1",
      APP_URL: origin,
      NEXT_PUBLIC_SUPABASE_URL: persistenceOrigin,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "disposable-publishable-fixture",
      ROLLBACKIQ_RELEASE: release,
    },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  },
);
app.stdout.resume();
app.stderr.resume();
const exited = once(app, "exit");

async function get(format, session) {
  const url = new URL(`/api/scans/${scan.id}`, origin);
  if (format !== null) url.searchParams.set("format", format);
  return fetch(url, {
    headers: session ? { Cookie: session } : {},
    signal: AbortSignal.timeout(8000),
  });
}

try {
  let ready = false;
  const deadline = Date.now() + 25000;
  while (!ready && Date.now() < deadline && app.exitCode === null) {
    const health = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(1500) }).catch(
      () => null,
    );
    if (health?.ok) {
      const body = await health.json();
      assert.equal(body.release, release);
      assert.equal(body.workerProtocol, 2);
      ready = true;
    } else await health?.body?.cancel();
    if (!ready) await sleep(100);
  }
  assert.ok(ready, "Built fixture application did not start");
  for (const format of ["json", "sarif"]) {
    const unauthenticated = await get(format);
    assert.equal(unauthenticated.status, 401);
    assert.deepEqual(await unauthenticated.json(), { error: "Sign in to open reports." });
    const other = await get(format, otherCookie);
    assert.equal(other.status, 404);
    assert.deepEqual(await other.json(), { error: "Scan unavailable." });
  }
  const original = await get(null, ownerCookie);
  assert.equal(original.status, 200);
  assert.equal(original.headers.get("content-disposition"), null);
  assert.deepEqual(await original.json(), scan);
  for (const format of ["json", "sarif"]) {
    const response = await get(format, ownerCookie);
    assert.equal(response.status, 200);
    assert.match(
      response.headers.get("content-type"),
      format === "json" ? /application\/json/ : /application\/sarif\+json/,
    );
    assert.equal(
      response.headers.get("content-disposition"),
      `attachment; filename="rollbackiq-${scan.id}.${format}"`,
    );
    assert.match(response.headers.get("cache-control"), /private/);
    assert.match(response.headers.get("cache-control"), /no-store/);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    const text = await response.text();
    const body = JSON.parse(text);
    if (format === "json") {
      const { savedScan, ...exported } = body;
      assert.deepEqual(exported, scan.report);
      assert.equal(savedScan.id, scan.id);
    } else {
      assert.equal(body.version, "2.1.0");
      assert.equal(body.runs[0].properties.savedScan.id, scan.id);
      assert.equal(
        body.runs[0].results.length,
        scan.report.findings.length + (scan.report.migrationReport?.findings.length ?? 0),
      );
    }
    if (process.argv[3]) {
      await mkdir(process.argv[3], { recursive: true });
      await writeFile(join(process.argv[3], `http-export.${format}`), text);
    }
  }
  assert.equal((await get("html", ownerCookie)).status, 400);
  malformed = true;
  const invalid = await get("sarif", ownerCookie);
  assert.equal(invalid.status, 422);
  assert.doesNotMatch(await invalid.text(), /private-data/);
  assert.ok(authorizedReads > 0);
  console.info(
    "Built export route verified with owner, non-member and signed-out sessions, attachment headers, report fidelity and bounded errors.",
  );
} finally {
  app.kill();
  await exited;
  await close(persistence);
}

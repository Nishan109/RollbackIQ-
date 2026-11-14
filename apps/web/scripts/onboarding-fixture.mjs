// Disposable Auth and PostgREST fixtures for testing the built app on loopback.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  scryptSync,
  sign,
  timingSafeEqual,
} from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { analyzeCompatibility } from "@rollbackiq/scanner-core/compatibility";
import { z } from "zod";

const owner = "00000000-0000-4000-8000-000000000001";
const organization = "00000000-0000-4000-8000-000000000003";
const otherOrganization = "00000000-0000-4000-8000-000000000004";
const repository = "00000000-0000-4000-8000-000000000006";
const scan = "00000000-0000-4000-8000-000000000007";
const password = "FixtureOnly123";
const serviceKey = "fixture-server-only";
const date = "2026-11-13T12:00:00Z";
const previous = "a".repeat(40);
const proposed = "b".repeat(40);
const report = await analyzeCompatibility({
  previous: { release: { ref: "v1.0.0", commit: previous }, sources: [] },
  proposed: { release: { ref: "fixture-pr", commit: proposed }, sources: [] },
  migrations: [
    {
      path: "supabase/migrations/002_enable_rls.sql",
      sql: "ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;",
    },
  ],
});
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = {
  ...publicKey.export({ format: "jwk" }),
  kid: "fixture-key",
  alg: "RS256",
  use: "sig",
};
const credentials = z.object({
  email: z
    .string()
    .trim()
    .max(254)
    .pipe(z.email())
    .transform((email) => email.toLowerCase()),
  password: z.string().min(8).max(256),
});
const users = new Map([[owner, user(owner, "owner@example.test", password)]]);
const organizations = [
  { id: organization, name: "Acme Engineering", user: owner },
  { id: otherOrganization, name: "Sandbox Team", user: owner },
];
const connection = {
  installation_id: 12,
  organization_id: organization,
  account_login: "acme",
  status: "connected",
  synchronized_at: date,
};
const linkedRepo = {
  repository_id: repository,
  organization_id: organization,
  installation_id: 12,
  github_id: 123,
  full_name: "acme/orders",
  status: "connected",
  enabled: true,
  configuration: {
    migrations: "supabase/migrations",
    previous: "v1.0.0",
    sources: ["src"],
    prisma: "",
    baseline: "",
    defaultSchema: "public",
    publishChecks: true,
    checkPolicy: { failOn: "high", incomplete: "action_required" },
  },
};
const scanRow = {
  id: scan,
  organization_id: organization,
  repository_id: repository,
  created_at: date,
  previous_sha: previous,
  proposed_sha: proposed,
  status: report.status,
  finding_count: report.findings.length,
  report,
};
const jobs = [
  { status: "queued", scan_id: null, attempts: 0, pull_number: 7, head_sha: proposed },
  { status: "completed", scan_id: scan, attempts: 1, pull_number: 6, head_sha: previous },
].map((job, index) => ({
  ...job,
  id: `00000000-0000-4000-8000-00000000001${index}`,
  created_at: date,
  organization_id: organization,
  repository_id: repository,
  check_id: null,
  check_state: null,
  check_error: null,
  check_conclusion: null,
}));
const limits = { organizations: 0, configuration: 0 };
const sessions = new Map();
let authOrigin;

function user(id, email, password) {
  const salt = randomBytes(16);
  return {
    passwordHash: scryptSync(password, salt, 32),
    salt,
    profile: {
      id,
      email,
      aud: "authenticated",
      role: "authenticated",
      is_anonymous: false,
      app_metadata: {},
      user_metadata: {},
    },
  };
}

function session(id) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT", kid: jwk.kid })).toString(
    "base64url",
  );
  const payload = Buffer.from(
    JSON.stringify({
      iss: `${authOrigin}/auth/v1`,
      sub: id,
      aud: "authenticated",
      role: "authenticated",
      iat: now,
      exp: now + 3600,
      session_id: randomUUID(),
      aal: "aal1",
      is_anonymous: false,
    }),
  ).toString("base64url");
  const unsigned = `${header}.${payload}`;
  const access_token = `${unsigned}.${sign("RSA-SHA256", Buffer.from(unsigned), privateKey).toString("base64url")}`;
  sessions.set(`Bearer ${access_token}`, id);
  return {
    access_token,
    refresh_token: "fixture-refresh",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: now + 3600,
    user: users.get(id).profile,
  };
}

async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return server.address().port;
}

const persistence = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, "http://127.0.0.1");
    const identity = sessions.get(request.headers.authorization);
    const service = request.headers.authorization === `Bearer ${serviceKey}`;
    function reply(status, body) {
      response.writeHead(status, {
        "Content-Type": "application/json",
        "X-Supabase-Api-Version": "2024-01-01",
      });
      response.end(JSON.stringify(body));
    }
    async function body() {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    }
    if (url.pathname === "/auth/v1/.well-known/jwks.json") return reply(200, { keys: [jwk] });
    if (url.pathname === "/auth/v1/token" && url.searchParams.get("grant_type") === "password") {
      const input = credentials.safeParse(await body());
      const account =
        input.success &&
        [...users.values()].find(({ profile }) => profile.email === input.data.email);
      return input.success &&
        account &&
        timingSafeEqual(account.passwordHash, scryptSync(input.data.password, account.salt, 32))
        ? reply(200, session(account.profile.id))
        : reply(400, { code: "invalid_credentials", message: "Invalid login credentials" });
    }
    if (url.pathname === "/auth/v1/signup") {
      const input = credentials.safeParse(await body());
      if (!input.success)
        return reply(422, { code: "validation_failed", message: "Invalid signup credentials" });
      const { email, password } = input.data;
      if ([...users.values()].some(({ profile }) => profile.email === email))
        return reply(422, {
          code: "user_already_exists",
          message: "Preview account already exists",
        });
      if (users.size >= 100) return reply(503, { message: "Preview account limit reached" });
      const id = randomUUID();
      users.set(id, user(id, email, password));
      return reply(200, session(id));
    }
    if (url.pathname === "/fixture-counts") return reply(200, limits);
    if (!identity && !service) return reply(401, { message: "Fixture session rejected" });
    if (url.pathname === "/auth/v1/user" && identity)
      return reply(200, users.get(identity).profile);
    if (url.pathname === "/auth/v1/logout") {
      sessions.delete(request.headers.authorization);
      return reply(200, {});
    }
    if (url.pathname === "/rest/v1/rpc/rollbackiq_create_organization" && identity) {
      const { p_name } = await body();
      const id = randomUUID();
      limits.organizations++;
      organizations.push({ id, name: p_name, user: identity });
      return reply(200, id);
    }
    if (url.pathname === "/rest/v1/rpc/rollbackiq_github_service" && service) {
      const { p_action, p_data } = await body();
      const access = organizations.some(
        ({ id, user }) => id === p_data.organization && user === p_data.actor,
      );
      if (!access) return reply(403, { code: "42501", message: "Fixture access denied" });
      const connected = p_data.organization === organization;
      if (p_action === "dashboard")
        return reply(200, {
          choices: null,
          connections: connected ? [connection] : [],
          repositories: connected ? [linkedRepo] : [],
        });
      if (p_action === "configure" && connected && p_data.repository === repository) {
        linkedRepo.configuration = p_data.configuration;
        linkedRepo.enabled = p_data.enabled;
        limits.configuration++;
        return reply(200, {});
      }
    }
    const owned = organizations.filter(({ user }) => user === identity);
    const data = {
      organizations: owned.map(({ id, name }) => ({ id, name })),
      organization_members: owned.map(({ id }) => ({
        organization_id: id,
        user_id: identity,
        role: "owner",
      })),
      repositories:
        identity === owner
          ? [{ id: repository, organization_id: organization, name: linkedRepo.full_name }]
          : [],
      github_connections: identity === owner ? [connection] : [],
      github_repositories: identity === owner ? [linkedRepo] : [],
      github_jobs: identity === owner ? jobs : [],
      scans: identity === owner ? [scanRow] : [],
      scan_reviews: [],
    };
    const rows = data[url.pathname.slice("/rest/v1/".length)];
    if (!Array.isArray(rows)) return reply(404, { message: "Unknown fixture route" });
    const filters = [...url.searchParams].filter(([, value]) => value.startsWith("eq."));
    const selected = rows.filter((row) =>
      filters.every(([key, value]) => String(row[key]) === value.slice(3)),
    );
    const projection = url.searchParams.get("select")?.split(",");
    const result = selected.map((row) =>
      projection
        ? Object.fromEntries(projection.filter((key) => key in row).map((key) => [key, row[key]]))
        : row,
    );
    return reply(
      200,
      request.headers.accept?.includes("object+json") ? (result[0] ?? null) : result,
    );
  } catch {
    response.writeHead(500, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ message: "Fixture handler failed" }));
  }
});

authOrigin = `http://127.0.0.1:${await listen(persistence)}`;
const port = Number(process.argv[2] ?? 3198);
assert.ok(Number.isSafeInteger(port) && port > 1024 && port < 65536);
const appOrigin = `http://127.0.0.1:${port}`;
const require = createRequire(import.meta.url);
const app = spawn(
  process.execPath,
  [
    require.resolve("next/dist/bin/next"),
    "start",
    "--hostname",
    "127.0.0.1",
    "--port",
    String(port),
  ],
  {
    env: {
      Path: process.env.Path,
      SystemRoot: process.env.SystemRoot,
      TEMP: process.env.TEMP,
      TMP: process.env.TMP,
      NODE_ENV: "production",
      NEXT_TELEMETRY_DISABLED: "1",
      ROLLBACKIQ_RELEASE: process.env.ROLLBACKIQ_RELEASE,
      ROLLBACKIQ_LOCAL_PREVIEW: "1",
      APP_URL: appOrigin,
      NEXT_PUBLIC_SUPABASE_URL: authOrigin,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "fixture-publishable",
      SUPABASE_SERVICE_ROLE_KEY: serviceKey,
      GITHUB_APP_ID: "1",
      GITHUB_APP_SLUG: "rollbackiq-fixture",
      GITHUB_CLIENT_ID: "fixture-client",
      GITHUB_CLIENT_SECRET: "fixture-client-secret",
      GITHUB_APP_PRIVATE_KEY: privateKey.export({ type: "pkcs1", format: "pem" }),
      GITHUB_WEBHOOK_SECRET: "fixture-webhook-secret",
    },
    windowsHide: true,
    stdio: "inherit",
  },
);
console.info(
  `Onboarding fixture ${appOrigin}. Sample workspace: owner@example.test (${password}). Signup creates temporary accounts in memory.`,
);
console.info(`Fixture mutation counts: ${authOrigin}/fixture-counts`);
const stop = () => app.kill();
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
const [code] = await once(app, "exit");
persistence.closeAllConnections();
persistence.close();
process.exitCode = code ?? 0;

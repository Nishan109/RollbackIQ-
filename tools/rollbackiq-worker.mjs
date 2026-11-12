import { execFileSync, spawnSync } from "node:child_process";
import { createPrivateKey } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmdirSync, unlinkSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseEnv } from "node:util";
import { installWorkerControl, workerLogger } from "./worker-runtime.mjs";

const [mode, envFile, release, port, git, appUrl, windowsReady] = process.argv.slice(2);
const web = process.cwd();
const root = join(web, "../..");
const require = createRequire(join(web, "package.json"));
const names = [
  "APP_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "GITHUB_APP_ID",
  "GITHUB_APP_SLUG",
  "GITHUB_CLIENT_ID",
  "GITHUB_APP_PRIVATE_KEY",
];
const qaRepository = "Nishan109/Site_Audit_AI";
let exitCode = windowsReady === "True" ? 0 : 2;

function result(status, message) {
  console.info(`${status} ${message}`);
  if (status === "FAIL") exitCode = 1;
  if (status === "BLOCKED" && exitCode === 0) exitCode = 2;
}

function httpsOrigin(value) {
  try {
    const url = new URL(value);
    if (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      url.pathname === "/" &&
      !url.search &&
      !url.hash
    )
      return url.origin;
  } catch {}
  return undefined;
}

function verifySource() {
  const inputs = [
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "tsconfig.base.json",
    "apps/web/package.json",
    "apps/web/tsconfig.json",
    "apps/web/lib",
    "apps/web/scripts/github-worker.ts",
    "packages/scanner-core",
  ];
  const folder = mkdtempSync(join(tmpdir(), "rollbackiq-index-"));
  const index = join(folder, "index");
  const options = { cwd: root, env: { ...process.env, GIT_INDEX_FILE: index }, encoding: "utf8" };
  try {
    const kind = execFileSync(git, ["cat-file", "-t", release], {
      ...options,
      stdio: ["ignore", "pipe", "ignore"],
    });
    if (kind.trim() !== "commit") return false;
    execFileSync(git, ["read-tree", release], { ...options, stdio: "ignore" });
    const diff = spawnSync(
      git,
      ["-c", "core.safecrlf=false", "diff", "--quiet", "--no-ext-diff", "--", ...inputs],
      { ...options, stdio: "ignore" },
    );
    const extras = execFileSync(
      git,
      ["ls-files", "--others", "--exclude-standard", "-z", "--", ...inputs],
      { ...options, stdio: ["ignore", "pipe", "ignore"] },
    );
    return diff.status === 0 && extras.length === 0;
  } catch {
    return false;
  } finally {
    // The temporary index is independent of the repository's real index.
    try {
      unlinkSync(index);
    } catch {}
    rmdirSync(folder);
  }
}

async function verifySupabase(client, store) {
  try {
    const db = await store("health", {});
    if (db?.protocol !== 2) {
      result("BLOCKED", "Supabase worker protocol is not 2.");
      return;
    }
    result("PASS", "Supabase service-role connection and worker protocol 2.");
    const [queue, repo] = await Promise.all([
      client.from("github_jobs").select("status").limit(1),
      client
        .from("github_repositories")
        .select("github_id,installation_id,enabled,status,configuration")
        .eq("full_name", qaRepository)
        .single(),
    ]);
    if (queue.error) result("FAIL", "Supabase queue could not be read.");
    else result("PASS", "Supabase queue read succeeded.");
    if (repo.error) {
      result("BLOCKED", "QA repository settings are unavailable.");
      return;
    }
    const connection = await client
      .from("github_connections")
      .select("status")
      .eq("installation_id", repo.data.installation_id)
      .single();
    const configured =
      !connection.error &&
      connection.data.status === "connected" &&
      repo.data.status === "connected" &&
      repo.data.enabled &&
      repo.data.configuration?.publishChecks === true;
    result(
      configured ? "PASS" : "BLOCKED",
      configured
        ? "QA repository is connected with automatic scans and GitHub Checks enabled."
        : "QA repository needs a connected installation, automatic scans, and Check publishing.",
    );
    return repo.data;
  } catch {
    result(
      "FAIL",
      "Supabase health RPC failed. Check server credentials, network trust, and migrations.",
    );
  }
}

async function verifyGitHub(provider, app, repo, origin) {
  if (!repo) {
    result("BLOCKED", "GitHub repository access requires the QA installation details.");
    return;
  }
  try {
    const jwt = provider.jwt();
    const [registration, installation, hook] = await Promise.all([
      provider.request("/app", jwt),
      provider.installation(repo.installation_id),
      provider.request("/app/hook/config", jwt),
    ]);
    const webhook =
      registration.id === app.appId &&
      registration.slug === app.slug &&
      registration.events?.includes("pull_request") &&
      hook.url === `${origin}/api/github/webhook` &&
      hook.insecure_ssl === "0";
    result(
      webhook ? "PASS" : "BLOCKED",
      webhook
        ? "GitHub App webhook URL, TLS verification, and pull-request subscription."
        : "GitHub App registration or webhook settings do not match the worker configuration.",
    );
    if (
      registration.permissions?.checks !== "write" ||
      installation.permissions?.checks !== "write"
    ) {
      result("BLOCKED", "GitHub App and installation both need Checks write access.");
      return;
    }
    const grant = await provider.request(
      `/app/installations/${installation.id}/access_tokens`,
      jwt,
      "POST",
      {
        repository_ids: [repo.github_id],
        permissions: { contents: "read", pull_requests: "read", checks: "write" },
      },
    );
    const listing = await provider.request("/installation/repositories?per_page=2", grant.token);
    const scoped =
      listing.total_count === 1 &&
      listing.repositories?.[0]?.id === repo.github_id &&
      listing.repositories[0].full_name.toLowerCase() === qaRepository.toLowerCase() &&
      grant.permissions?.checks === "write" &&
      grant.permissions.contents === "read" &&
      grant.permissions.pull_requests === "read";
    result(
      scoped ? "PASS" : "FAIL",
      scoped
        ? "GitHub issued a token scoped to the QA repository with Checks write access."
        : "GitHub installation token did not have the expected repository scope or permissions.",
    );
  } catch (error) {
    const status = Number.isInteger(error?.status) ? ` (HTTP ${error.status})` : "";
    result(
      "FAIL",
      `GitHub App verification failed${status}. Check installation access and network trust.`,
    );
  }
}

async function verifyWeb(origin) {
  try {
    const response = await fetch(`${origin}/api/health`, {
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error("Unexpected health status");
    const health = await response.json();
    const webRelease = /^[a-f0-9]{40}$/.test(health?.release) ? health.release : "missing";
    const protocol = Number.isSafeInteger(health?.workerProtocol)
      ? health.workerProtocol
      : "missing";
    const matches = health?.status === "ok" && webRelease === release && protocol === 2;
    result(
      matches ? "PASS" : "BLOCKED",
      "Web health reports release " +
        webRelease +
        " and worker protocol " +
        protocol +
        ". Expected release " +
        release +
        " and worker protocol 2.",
    );
  } catch {
    result("FAIL", "The configured web health endpoint is unavailable.");
  }
}

async function main() {
  if (!["test", "start"].includes(mode) || !/^[a-f0-9]{40}$/.test(release)) {
    result("FAIL", "Invalid launcher arguments.");
    return;
  }
  let components;
  try {
    components = {
      ...require(join(web, "lib/github/config.ts")),
      ...require(join(web, "lib/github/provider.ts")),
      ...require(join(web, "lib/github/store.ts")),
      ...require(join(web, "lib/supabase/service.ts")),
    };
    require.resolve("@rollbackiq/scanner-core");
    result("PASS", "Installed worker dependencies and shared modules resolve.");
  } catch {
    result("FAIL", "Worker dependencies do not load. Install the pinned workspace dependencies.");
    return;
  }

  const sourceMatches = verifySource();
  result(
    sourceMatches ? "PASS" : "BLOCKED",
    sourceMatches
      ? `Local worker sources and dependency manifests match ${release}.`
      : `Local worker sources or dependency manifests differ from ${release}.`,
  );

  const file = parseEnv(readFileSync(envFile, "utf8"));
  for (const name of names) {
    if (process.env[name] === undefined && file[name] !== undefined) process.env[name] = file[name];
  }
  if (appUrl !== "-") process.env.APP_URL = appUrl;
  const missing = names.filter((name) => !process.env[name]);
  if (missing.length) {
    result("FAIL", `Missing worker settings: ${missing.join(", ")}.`);
    return;
  }
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0") {
    result("FAIL", "Node.js TLS verification must be enabled.");
    return;
  }

  const origin = httpsOrigin(process.env.APP_URL);
  const db = httpsOrigin(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const app = components.githubAppSettings();
  let key;
  try {
    if (app) key = createPrivateKey(app.privateKey);
  } catch {}
  const validApp =
    app && key?.asymmetricKeyType === "rsa" && key.asymmetricKeyDetails?.modulusLength >= 2048;
  if (!origin || !db || !validApp) {
    if (!origin) result("FAIL", "APP_URL must be an HTTPS origin.");
    if (!db) result("FAIL", "NEXT_PUBLIC_SUPABASE_URL must be an HTTPS origin.");
    if (!validApp)
      result("FAIL", "GitHub App settings need a valid RSA signing key of at least 2048 bits.");
    return;
  }
  result("PASS", "Required worker settings and GitHub signing key format.");
  const client = components.supabaseService();
  const provider = new components.Github(fetch, undefined, app);
  await Promise.all([
    verifyWeb(origin),
    verifySupabase(client, components.githubStore(true)).then((repo) =>
      verifyGitHub(provider, app, repo, origin),
    ),
  ]);
  if (mode !== "start" || exitCode !== 0) return;

  // Let the entrypoint own SIGINT/SIGTERM and run in this foreground Node process.
  process.env.ROLLBACKIQ_WORKER_PRODUCTION = "true";
  process.env.ROLLBACKIQ_RELEASE = release;
  delete process.env.VERCEL_GIT_COMMIT_SHA;
  process.env.WORKER_HEALTH_HOST = "127.0.0.1";
  process.env.WORKER_HEALTH_PORT = port;

  const logDirectory = join(process.env.LOCALAPPDATA, "RollbackIQ/windows-worker");
  mkdirSync(logDirectory, { recursive: true });
  console.info = console.warn = console.error = workerLogger(logDirectory, release);
  const disposeControl = installWorkerControl(logDirectory, release, Number(port));
  require(join(web, "scripts/github-worker.ts"));
  process.once("beforeExit", disposeControl);
}

try {
  await main();
  if (exitCode !== 0) process.exitCode = exitCode;
} catch {
  result("FAIL", "Worker setup could not complete. Check the local environment and dependencies.");
  process.exitCode = 1;
}

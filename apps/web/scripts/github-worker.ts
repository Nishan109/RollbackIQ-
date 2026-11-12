import { createPrivateKey } from "node:crypto";
import { githubAppSettings } from "../lib/github/config";
import { githubStore } from "../lib/github/store";
import { runWorkerService } from "../lib/github/worker-service";
import { releaseVersion } from "../lib/release";

async function main() {
  const settings = githubAppSettings();
  const release = releaseVersion();
  const production = process.env.ROLLBACKIQ_WORKER_PRODUCTION === "true";
  const dbUrl = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "invalid");
  const localDb = dbUrl.protocol === "http:" && ["localhost", "127.0.0.1"].includes(dbUrl.hostname);
  const port =
    process.env.WORKER_HEALTH_PORT === undefined
      ? undefined
      : Number(process.env.WORKER_HEALTH_PORT);
  if (
    !settings ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY ||
    !(dbUrl.protocol === "https:" || (!production && localDb)) ||
    dbUrl.username ||
    dbUrl.password ||
    dbUrl.pathname !== "/" ||
    dbUrl.search ||
    dbUrl.hash ||
    (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65535)) ||
    (production && (!release || !settings.origin.startsWith("https:") || port === undefined))
  )
    throw new Error("worker_configuration_invalid");
  const key = createPrivateKey(settings.privateKey);
  if (key.asymmetricKeyType !== "rsa" || (key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048)
    throw new Error("worker_configuration_invalid");
  const shutdown = new AbortController();
  const stop = () => shutdown.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    await runWorkerService({
      store: githubStore(true),
      release,
      origin: settings.origin,
      production,
      port,
      host: process.env.WORKER_HEALTH_HOST,
      once: process.argv.includes("--once"),
      signal: shutdown.signal,
    });
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
  }
}

void main().catch(() => {
  console.error(
    JSON.stringify({ event: "github_worker_exit", reason: "startup_or_dependency_failure" }),
  );
  process.exitCode = 1;
});

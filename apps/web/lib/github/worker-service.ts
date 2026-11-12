import { createServer } from "node:http";
import { setTimeout as sleep } from "node:timers/promises";
import { workerProtocol } from "../release";
import type { GithubRpc } from "./store";
import { runGithubJob } from "./worker";

type Options = {
  store: GithubRpc;
  release: string | null;
  origin: string;
  production: boolean;
  port?: number;
  host?: string;
  once?: boolean;
  signal: AbortSignal;
};

export async function verifyWorkerDependencies(
  store: GithubRpc,
  origin: string,
  release: string | null,
  production: boolean,
  fetcher = fetch,
) {
  const db = await store("health", {});
  if (typeof db !== "object" || !db || !("protocol" in db) || db.protocol !== workerProtocol)
    throw new Error("queue_protocol_mismatch");
  if (!production) return;
  const response = await fetcher(new URL("/api/health", origin), {
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error("web_unavailable");
  }
  const health: unknown = await response.json();
  if (
    !release ||
    !health ||
    typeof health !== "object" ||
    !("release" in health) ||
    health.release !== release ||
    !("workerProtocol" in health) ||
    health.workerProtocol !== workerProtocol
  )
    throw new Error("web_release_mismatch");
}

export function workerHealth(release: string | null, now = Date.now) {
  let lastContact: number | null = null;
  let draining = false;
  return {
    contact() {
      lastContact = now();
    },
    unavailable() {
      lastContact = null;
    },
    drain() {
      draining = true;
    },
    response(path: string) {
      if (path !== "/livez" && path !== "/readyz")
        return { code: 404, body: { status: "not_found" } };
      const ready = !draining && lastContact !== null && now() - lastContact < 75_000;
      const ok = path === "/livez" || ready;
      return {
        code: ok ? 200 : 503,
        body: {
          status: ok ? "ok" : draining ? "draining" : "unavailable",
          release,
          protocol: workerProtocol,
        },
      };
    },
  };
}

export async function runWorkerService(options: Options) {
  const { store, release, origin, production, signal } = options;
  const health = workerHealth(release);
  const log = (event: string, reason?: string) =>
    console.info(
      JSON.stringify({ event, release, protocol: workerProtocol, ...(reason ? { reason } : {}) }),
    );
  const server =
    options.port === undefined
      ? undefined
      : createServer(
          { requestTimeout: 5000, headersTimeout: 3000, maxHeaderSize: 8192 },
          (request, response) => {
            const result =
              request.method === "GET" || request.method === "HEAD"
                ? health.response(request.url ?? "")
                : { code: 405, body: { status: "method_not_allowed" } };
            response.writeHead(result.code, {
              "Content-Type": "application/json",
              "Cache-Control": "no-store",
            });
            response.end(request.method === "HEAD" ? undefined : JSON.stringify(result.body));
          },
        );
  if (server)
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(options.port, options.host ?? "127.0.0.1", resolve);
    });
  const drain = () => {
    health.drain();
    log("github_worker_draining");
  };
  signal.addEventListener("abort", drain, { once: true });
  log("github_worker_started");
  let lastProbe: number | undefined;
  let pause = 0;
  try {
    while (!signal.aborted) {
      try {
        if (lastProbe === undefined || Date.now() - lastProbe >= 30_000) {
          await verifyWorkerDependencies(store, origin, release, production);
          lastProbe = Date.now();
          health.contact();
        }
        if (signal.aborted) break;
        const worked = await runGithubJob(store, undefined, {
          release,
          onQueueContact: health.contact,
        });
        pause = worked ? 0 : 3000;
      } catch (error) {
        health.unavailable();
        lastProbe = undefined;
        const reason =
          error instanceof Error &&
          ["queue_protocol_mismatch", "web_unavailable", "web_release_mismatch"].includes(
            error.message,
          )
            ? error.message
            : "queue_or_dependency_unavailable";
        log("github_worker_unavailable", reason);
        if (options.once) throw new Error(reason);
        pause = Math.min(30_000, Math.max(5000, pause * 2));
      }
      if (options.once) break;
      if (pause > 0) await sleep(pause, undefined, { signal }).catch(() => undefined);
    }
  } finally {
    signal.removeEventListener("abort", drain);
    if (server) {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeIdleConnections();
      });
    }
    log("github_worker_stopped");
  }
}

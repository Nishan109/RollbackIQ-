import { isMigrationPath, scanMigrations } from "@rollbackiq/scanner-core";
import { z } from "zod";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 64 * 1024;
const MAX_SQL_BYTES = 32 * 1024;
const WINDOW_MS = 60_000;
const MAX_REQUESTS = 60;
const MAX_ACTIVE = 4;
const input = z.strictObject({
  files: z
    .array(
      z.strictObject({
        path: z.string().refine(isMigrationPath),
        sql: z.string().refine((sql) => sql.trim().length > 0 && !sql.includes("\0")),
      }),
    )
    .min(1)
    .max(5),
});

let windowStart = 0;
let requests = 0;
let active = 0;

function failure(status: number, error: string, extraHeaders?: Record<string, string>) {
  return Response.json(
    { error },
    { status, headers: { "Cache-Control": "no-store", ...extraHeaders } },
  );
}

async function readJson(request: Request) {
  if (!request.body) return null;
  const reader = request.body.getReader();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    void reader.cancel().catch(() => undefined);
  }, 5000);
  try {
    const chunks: Uint8Array[] = [];
    let length = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BODY_BYTES) {
        void reader.cancel().catch(() => undefined);
        return failure(413, "The scan request exceeds 64 KiB.");
      }
      chunks.push(value);
    }
    if (timedOut) return failure(408, "The scan request timed out.");
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, length)),
    ) as unknown;
  } catch {
    return failure(400, "The scan request must contain valid UTF-8 JSON.");
  } finally {
    clearTimeout(timeout);
    reader.releaseLock();
  }
}

export async function POST(request: Request) {
  if (
    request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json"
  ) {
    return failure(415, "Send the request as application/json.");
  }
  if (Number(request.headers.get("content-length")) > MAX_BODY_BYTES) {
    return failure(413, "The scan request exceeds 64 KiB.");
  }

  const now = Date.now();
  if (now - windowStart >= WINDOW_MS) {
    windowStart = now;
    requests = 0;
  }
  if (requests >= MAX_REQUESTS || active >= MAX_ACTIVE) {
    return failure(429, "The demo scanner is busy. Try again shortly.", {
      "Retry-After": String(
        requests >= MAX_REQUESTS
          ? Math.max(1, Math.ceil((windowStart + WINDOW_MS - now) / 1000))
          : 1,
      ),
    });
  }
  requests += 1;
  active += 1;
  try {
    const body = await readJson(request);
    if (body instanceof Response) return body;
    const validated = input.safeParse(body);
    if (!validated.success)
      return failure(400, "Provide 1–5 files with a relative .sql path and SQL text.");
    const { files } = validated.data;
    if (new Set(files.map(({ path }) => path)).size !== files.length)
      return failure(400, "Each migration path must be unique.");
    if (files.reduce((bytes, { sql }) => bytes + Buffer.byteLength(sql), 0) > MAX_SQL_BYTES) {
      return failure(413, "SQL text exceeds the combined 32 KiB limit.");
    }
    const start = performance.now();
    const report = await scanMigrations(files);
    return Response.json(
      { report, durationMs: Math.round(performance.now() - start) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    console.error(JSON.stringify({ event: "scan_failed", route: "/api/scan" }));
    return failure(500, "The scanner could not complete the request.");
  } finally {
    active -= 1;
  }
}

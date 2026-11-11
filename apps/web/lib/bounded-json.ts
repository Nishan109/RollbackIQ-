export function apiJson(value: unknown, status = 200, headers?: Record<string, string>) {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "private, no-store", ...headers },
  });
}

export async function readJsonBody(request: Request, limit: number) {
  if (
    request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json"
  )
    return apiJson({ error: "Send application/json." }, 415);
  if (Number(request.headers.get("content-length")) > limit)
    return apiJson({ error: "The request exceeds the size limit." }, 413);
  if (!request.body) return apiJson({ error: "A JSON body is required." }, 400);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    void reader.cancel().catch(() => undefined);
  }, 5000);
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        void reader.cancel().catch(() => undefined);
        return apiJson({ error: "The request exceeds the size limit." }, 413);
      }
      chunks.push(value);
    }
    if (timedOut) return apiJson({ error: "Reading the request timed out." }, 408);
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, total)),
    ) as unknown;
  } catch {
    return apiJson({ error: "The request must contain valid UTF-8 JSON." }, 400);
  } finally {
    clearTimeout(timeout);
    reader.releaseLock();
  }
}

export function sameOrigin(request: Request, siteOrigin: string) {
  const origin = request.headers.get("origin");
  return !origin || origin === siteOrigin;
}

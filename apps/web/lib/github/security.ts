import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const stateHash = (s: string) => createHash("sha256").update(s).digest("hex");
export const randomSecret = () => randomBytes(32).toString("base64url");
export const pkceChallenge = (s: string) => createHash("sha256").update(s).digest("base64url");
export function equalSecret(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
export function validSignature(raw: Uint8Array, signature: string | null, secret: string) {
  if (!signature || !/^sha256=[a-f0-9]{64}$/.test(signature)) return false;
  return equalSecret(signature.slice(7), createHmac("sha256", secret).update(raw).digest("hex"));
}
export async function boundedBytes(body: ReadableStream<Uint8Array> | null, limit: number) {
  if (!body) throw new Error("Missing request body");
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let expired = false;
  const timer = setTimeout(() => {
    expired = true;
    void reader.cancel().catch(() => undefined);
  }, 10_000);
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        void reader.cancel().catch(() => undefined);
        throw new Error("Request exceeds the size limit");
      }
      chunks.push(value);
    }
    if (expired) throw new Error("Reading the request timed out");
    return Buffer.concat(chunks, total);
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
  }
}

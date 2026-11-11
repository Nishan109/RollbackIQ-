import assert from "node:assert/strict";
import { test } from "node:test";
import { readJsonBody, sameOrigin } from "./bounded-json";

test("browser writes use the configured public origin behind a proxy", () => {
  const request = (origin: string) =>
    new Request("http://127.0.0.1:3000/api/scans", { headers: { Origin: origin } });
  assert.equal(sameOrigin(request("https://rollback.example"), "https://rollback.example"), true);
  assert.equal(sameOrigin(request("https://untrusted.example"), "https://rollback.example"), false);
});

test("JSON storage requests enforce byte limits without trusting Content-Length", async () => {
  const request = new Request("http://localhost/api/scans", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: "é".repeat(40) }),
  });
  const result = await readJsonBody(request, 64);
  assert.ok(result instanceof Response);
  assert.equal(result.status, 413);
});

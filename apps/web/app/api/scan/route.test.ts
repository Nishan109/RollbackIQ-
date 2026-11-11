import assert from "node:assert/strict";
import { test } from "node:test";
import { POST } from "./route";

const request = (body: string, contentType = "application/json") =>
  new Request("http://localhost/api/scan", {
    method: "POST",
    headers: { "Content-Type": contentType },
    body,
  });

test("scan endpoint returns live evidence without caching", async () => {
  const response = await POST(
    request(JSON.stringify({ files: [{ path: "m.sql", sql: "\nDROP TABLE orders;" }] })),
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const { report, durationMs } = await response.json();
  assert.equal(report.findings[0].ruleId, "PG001");
  assert.equal(report.findings[0].location.line, 2);
  assert.equal(typeof durationMs, "number");
});

test("scan endpoint rejects unsupported content types, invalid shapes and traversing paths", async () => {
  assert.equal((await POST(request("hello", "text/plain"))).status, 415);
  assert.equal((await POST(request("{"))).status, 400);
  assert.equal(
    (await POST(request(JSON.stringify({ files: [{ path: "../m.sql", sql: "SELECT 1" }] }))))
      .status,
    400,
  );
  assert.equal(
    (await POST(request(JSON.stringify({ files: [{ path: "a.sql", sql: " " }] })))).status,
    400,
  );
});

test("scan endpoint bounds streamed bodies and UTF-8 SQL size", async () => {
  assert.equal((await POST(request(" ".repeat(65537)))).status, 413);
  const sql = `-- ${"é".repeat(17000)}`;
  assert.equal(
    (await POST(request(JSON.stringify({ files: [{ path: "m.sql", sql }] })))).status,
    413,
  );
  assert.equal(
    (await POST(request(JSON.stringify({ files: [{ path: "m.sql", sql: "x".repeat(32769) }] }))))
      .status,
    413,
  );
});

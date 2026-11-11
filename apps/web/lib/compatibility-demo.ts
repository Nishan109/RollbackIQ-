import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { analyzeCompatibility } from "@rollbackiq/scanner-core/compatibility";
import { getDemo } from "./demo";

export async function getCompatibilityDemo() {
  const root = join(process.cwd(), "../../examples/demo-saas");
  const [previous, proposed, baseline, { samples }] = await Promise.all([
    readFile(join(root, "releases/previous/src/customers.ts"), "utf8"),
    readFile(join(root, "releases/proposed/src/customers.ts"), "utf8"),
    readFile(join(root, "schema.sql"), "utf8"),
    getDemo(),
  ]);
  return analyzeCompatibility({
    previous: {
      release: { ref: "demo-v1" },
      sources: [{ path: "src/customers.ts", text: previous }],
    },
    proposed: {
      release: { ref: "demo-v2" },
      sources: [{ path: "src/customers.ts", text: proposed }],
    },
    migrations: samples,
    baseline: { path: "schema.sql", sql: baseline },
  });
}

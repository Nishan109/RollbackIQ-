import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { type MigrationFile, scanMigrations } from "@rollbackiq/scanner-core";

const fixtures = [
  ["001_add_receipt_note.sql", "Add a nullable column"],
  ["002_drop_legacy_tier.sql", "Drop a legacy column"],
  ["003_rename_customer_name.sql", "Rename a customer column"],
  ["004_require_order_reference.sql", "Require an order reference"],
  ["005_restart_order_sequence.sql", "Restart an order sequence"],
] as const;

export type DemoSample = MigrationFile & { title: string };

async function loadDemo() {
  const samples = await Promise.all(
    fixtures.map(async ([name, title]): Promise<DemoSample> => {
      const path = `migrations/${name}`;
      const sql = await readFile(join(process.cwd(), "../../examples/demo-saas", path), "utf8");
      return { title, path, sql };
    }),
  );
  return { samples, report: await scanMigrations(samples) };
}

let demo: ReturnType<typeof loadDemo> | undefined;

export function getDemo() {
  demo ??= loadDemo().catch((error) => {
    demo = undefined;
    throw error;
  });
  return demo;
}

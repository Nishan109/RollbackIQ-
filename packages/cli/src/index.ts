import { open, stat } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import { parseArgs } from "node:util";
import {
  evaluatePolicy,
  MAX_FILE_BYTES,
  MAX_FILES,
  MAX_TOTAL_BYTES,
  scanMigrations,
  toSarif,
} from "@rollbackiq/scanner-core";
import { parsePolicy, policyOptions, serialize } from "./options";

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { ...policyOptions, format: { type: "string", default: "json" } },
  });
  if (values.help) {
    process.stdout.write(
      "Usage: pnpm scan [--format json|sarif] [--fail-on severity] [--fail-incomplete] <migration.sql>...\n",
    );
    return;
  }
  if (!positionals.length || positionals.length > MAX_FILES)
    throw new Error(`Provide 1 to ${MAX_FILES} SQL file paths.`);
  if (values.format !== "json" && values.format !== "sarif")
    throw new Error("--format accepts json or sarif.");
  const policy = parsePolicy(values["fail-on"], values["fail-incomplete"]);
  const files = [];
  let total = 0;
  for (const input of positionals) {
    const absolute = resolve(input);
    const relativePath = relative(process.cwd(), absolute);
    const path =
      isAbsolute(relativePath) || relativePath.startsWith(`..${sep}`)
        ? basename(absolute)
        : relativePath.split(sep).join("/");
    const metadata = await stat(absolute);
    if (!metadata.isFile() || metadata.size > MAX_FILE_BYTES)
      throw new Error("Expected a regular migration file within the size limit.");
    const handle = await open(absolute, "r");
    try {
      const bytes = Buffer.alloc(Math.min(MAX_FILE_BYTES, MAX_TOTAL_BYTES - total) + 1);
      let length = 0;
      while (length < bytes.length) {
        const { bytesRead } = await handle.read(bytes, length, bytes.length - length, length);
        if (!bytesRead) break;
        length += bytesRead;
      }
      if (length === bytes.length) throw new Error("Migration input exceeds the size limit.");
      total += length;
      files.push({
        path,
        sql: new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, length)),
      });
    } finally {
      await handle.close();
    }
  }
  const report = await scanMigrations(files);
  const decision = evaluatePolicy(report, policy);
  process.stdout.write(
    serialize(values.format === "sarif" ? toSarif(report) : { ...report, policy: decision }),
  );
  process.exitCode = decision.blocked ? 1 : 0;
}

main().catch((error: unknown) => {
  process.stderr.write(`RollbackIQ: ${error instanceof Error ? error.message : "Scan failed"}\n`);
  process.exitCode = 2;
});

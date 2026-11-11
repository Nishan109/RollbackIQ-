import {
  isMigrationPath,
  MAX_FILE_BYTES,
  MAX_FILES,
  MAX_TOTAL_BYTES,
} from "@rollbackiq/scanner-core";
import type {
  ChangedFile,
  CompatibilityInput,
  CoverageGap,
  SourceFile,
} from "@rollbackiq/scanner-core/compatibility/contracts";
import { z } from "zod";
import { type ScanConfiguration, sha } from "./contracts";
import type { Github } from "./provider";

const treeEntry = z.object({
  path: z.string(),
  mode: z.string(),
  type: z.string(),
  sha,
  size: z.number().int().nonnegative().optional(),
});
type Entry = z.infer<typeof treeEntry>;
const inDirectory = (path: string, dir: string) => dir === "." || path.startsWith(`${dir}/`);
export async function githubSnapshot(
  provider: Github,
  token: string,
  name: string,
  head: string,
  config: ScanConfiguration,
): Promise<CompatibilityInput> {
  const path = `/repos/${name}`;
  const commitSchema = z.object({ sha, commit: z.object({ tree: z.object({ sha }) }) });
  const previous = commitSchema.parse(
    await provider.request(`${path}/commits/${encodeURIComponent(config.previous)}`, token),
  );
  const proposed = commitSchema.parse(await provider.request(`${path}/commits/${head}`, token));
  if (proposed.sha !== head) throw new Error("Candidate commit could not be verified");
  async function tree(treeSha: string) {
    const result = z
      .object({ truncated: z.boolean(), tree: z.array(treeEntry).max(100_000) })
      .parse(await provider.request(`${path}/git/trees/${treeSha}?recursive=1`, token));
    if (result.truncated)
      throw new Error("Repository tree is incomplete; use a narrower repository or the local CLI");
    return new Map(result.tree.filter((e) => e.type !== "tree").map((e) => [e.path, e]));
  }
  const [oldTree, newTree] = await Promise.all([
    tree(previous.commit.tree.sha),
    tree(proposed.commit.tree.sha),
  ]);
  if (
    config.migrations !== "." &&
    ![...oldTree.keys(), ...newTree.keys()].some((p) => inDirectory(p, config.migrations))
  )
    throw new Error("Configured migration directory was not found");
  const diff: ChangedFile[] = [];
  for (const p of [...new Set([...oldTree.keys(), ...newTree.keys()])].sort()) {
    const old = oldTree.get(p),
      next = newTree.get(p);
    if (old?.sha !== next?.sha || old?.mode !== next?.mode)
      diff.push({ path: p, status: !old ? "added" : !next ? "deleted" : "modified" });
  }
  const gaps: CoverageGap[] = [];
  const comparison = z
    .object({ status: z.string() })
    .parse(await provider.request(`${path}/compare/${previous.sha}...${head}?per_page=1`, token));
  if (!["ahead", "identical"].includes(comparison.status))
    gaps.push({
      kind: "history",
      scope: "migrations",
      message: "The previous release is not a verified ancestor of the candidate commit.",
    });
  const migration = (p: string) =>
    p.toLowerCase().endsWith(".sql") && inDirectory(p, config.migrations);
  const source = (p: string) =>
    /\.(?:[cm]?[jt]s|[jt]sx|sql)$/i.test(p) &&
    !migration(p) &&
    p !== config.baseline &&
    p !== config.prisma &&
    !/\.d\.[cm]?ts$/i.test(p) &&
    !p
      .split("/")
      .some((x) => ["node_modules", "dist", "build", ".next", "coverage", "vendor"].includes(x)) &&
    config.sources.some((d) => inDirectory(p, d));
  const migrationChanges = diff.filter((c) => migration(c.path));
  for (const c of migrationChanges)
    if (c.status !== "added")
      gaps.push({
        kind: "migration",
        scope: "migrations",
        message: "An existing migration was changed or removed; verify executed migration history.",
        location: { path: c.path, line: 1, column: 1 },
      });
  const cache = new Map<string, string>();
  async function read(entry: Entry) {
    if (
      !isMigrationPath(`${entry.path}.sql`) ||
      !["100644", "100755"].includes(entry.mode) ||
      entry.type !== "blob" ||
      entry.size === undefined ||
      entry.size > MAX_FILE_BYTES
    )
      throw new Error("Unsupported or oversized repository blob");
    const cached = cache.get(entry.sha);
    if (cached !== undefined) return cached;
    const result = z
      .object({
        encoding: z.literal("base64"),
        content: z.string().max(400_000),
        size: z.number().max(MAX_FILE_BYTES),
      })
      .parse(await provider.request(`${path}/git/blobs/${entry.sha}`, token));
    const bytes = Buffer.from(result.content.replace(/\n/g, ""), "base64");
    if (bytes.byteLength !== result.size || bytes.byteLength !== entry.size)
      throw new Error("Repository blob size mismatch");
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (text.includes("\0")) throw new Error("Binary source cannot be analyzed");
    cache.set(entry.sha, text);
    return text;
  }
  async function files(
    entries: Entry[],
    scope: CoverageGap["scope"],
    count: number,
    totalLimit: number,
  ): Promise<SourceFile[]> {
    const result: SourceFile[] = [];
    let bytes = 0;
    for (const entry of entries) {
      const addGap = (message: string) =>
        gaps.push({
          kind: scope === "migrations" ? "migration" : scope === "schema" ? "schema" : "source",
          scope,
          message,
          location: { path: entry.path, line: 1, column: 1 },
        });
      if (result.length >= count || bytes + (entry.size ?? totalLimit + 1) > totalLimit) {
        addGap("Repository input exceeds the analysis limits.");
        continue;
      }
      try {
        const text = await read(entry);
        result.push({ path: entry.path, text });
        bytes += Buffer.byteLength(text);
      } catch {
        addGap("File is unavailable, binary, oversized or unsupported. Verify this file manually.");
      }
    }
    return result;
  }
  async function snapshot(
    side: "previous" | "proposed",
    entries: Map<string, Entry>,
    commit: string,
    ref: string,
  ) {
    const sources = await files(
      [...entries.values()]
        .filter((e) => source(e.path))
        .sort((a, b) => a.path.localeCompare(b.path)),
      side,
      400,
      6 * 1024 * 1024,
    );
    const prismaEntry = config.prisma ? entries.get(config.prisma) : undefined;
    const [prisma] = await files(prismaEntry ? [prismaEntry] : [], side, 1, MAX_FILE_BYTES);
    if (config.prisma && !prismaEntry)
      gaps.push({
        kind: "source",
        scope: side,
        message: "Configured Prisma schema is missing.",
        location: { path: config.prisma, line: 1, column: 1 },
      });
    return { release: { ref, commit }, sources, prisma };
  }
  const [oldSnapshot, newSnapshot, migrations, baseline] = await Promise.all([
    snapshot("previous", oldTree, previous.sha, config.previous),
    snapshot("proposed", newTree, head, head),
    files(
      migrationChanges.flatMap((c) => {
        const e = newTree.get(c.path);
        return e ? [e] : [];
      }),
      "migrations",
      MAX_FILES,
      MAX_TOTAL_BYTES,
    ),
    files(
      config.baseline && oldTree.has(config.baseline)
        ? [oldTree.get(config.baseline) as Entry]
        : [],
      "schema",
      1,
      MAX_FILE_BYTES,
    ),
  ]);
  if (config.baseline && !oldTree.has(config.baseline))
    gaps.push({
      kind: "schema",
      scope: "schema",
      message: "Configured schema baseline is missing.",
    });
  return {
    previous: oldSnapshot,
    proposed: newSnapshot,
    migrations: migrations.map((f) => ({ path: f.path, sql: f.text })),
    baseline: baseline[0] ? { path: baseline[0].path, sql: baseline[0].text } : undefined,
    migrationChanges,
    sourceChanges: diff.filter((c) => source(c.path) || c.path === config.prisma),
    gaps,
    defaultSchema: config.defaultSchema,
  };
}

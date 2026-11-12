import {
  isMigrationPath,
  MAX_FILE_BYTES,
  MAX_FILES,
  MAX_TOTAL_BYTES,
} from "@rollbackiq/scanner-core";
import { isTypescriptConfig } from "@rollbackiq/scanner-core/compatibility";
import type {
  ChangedFile,
  CompatibilityInput,
  CoverageGap,
  ReleaseSide,
  Snapshot,
} from "@rollbackiq/scanner-core/compatibility/contracts";
import { type GitReader, gitOid, gitReader, resolveGitCommit, utf8 } from "./git-read";

const MAX_SOURCE_FILES = 400;
const MAX_SOURCE_FILE_BYTES = 128 * 1024;
const MAX_SOURCE_BYTES = 6 * 1024 * 1024;
const SOURCE = /\.(?:[cm]?[jt]s|[jt]sx|sql)$/i;
const EXCLUDED = new Set(["node_modules", "dist", "build", ".next", "coverage", "vendor"]);

type TreeBlob = { path: string; oid: string; size: number | null };

export class CompatibilityGitError extends Error {
  constructor(
    readonly code: "COMPAT009" | "COMPAT010",
    message: string,
  ) {
    super(message);
  }
}

export function gitDirectory(path: string) {
  const normalized =
    path.replace(/^(?:\.\/)+/, "").replace(/\/+$/, "") || (path === "./" ? "." : "");
  if (normalized === ".") return normalized;
  if (!normalized || !isMigrationPath(`${normalized}/migration.sql`))
    throw new Error("Use repository-relative migration and source directories.");
  return normalized;
}

function inDirectory(path: string, directory: string) {
  return directory === "." || path.startsWith(`${directory}/`);
}

function sourcePath(path: string, directories: string[], migrations: string, baseline?: string) {
  return (
    SOURCE.test(path) &&
    !/\.d\.[cm]?ts$/i.test(path) &&
    path !== baseline &&
    !(path.toLowerCase().endsWith(".sql") && inDirectory(path, migrations)) &&
    directories.some((directory) => inDirectory(path, directory)) &&
    !path.split("/").some((part) => EXCLUDED.has(part))
  );
}

const orderPath = (left: { path: string }, right: { path: string }) =>
  left.path < right.path ? -1 : left.path > right.path ? 1 : 0;
const atFile = (path: string) => ({ path, line: 1, column: 1 });

async function readTree(git: GitReader, commit: string) {
  const records = utf8
    .decode(await git(["ls-tree", "-r", "-z", "-l", "--full-tree", commit]))
    .split("\0")
    .slice(0, -1);
  const tree = new Map<string, TreeBlob>();
  for (const record of records) {
    const tab = record.indexOf("\t");
    const [mode, type, oid, length] = record.slice(0, tab).split(/\s+/);
    const path = record.slice(tab + 1);
    const size = Number(length);
    if (!oid || !gitOid.test(oid) || tab < 0)
      throw new Error("Git returned an invalid tree entry.");
    tree.set(path, {
      path,
      oid,
      size:
        type === "blob" &&
        (mode === "100644" || mode === "100755") &&
        Number.isSafeInteger(size) &&
        size >= 0
          ? size
          : null,
    });
  }
  return tree;
}

async function readDiff(
  git: GitReader,
  previous: string,
  proposed: string,
): Promise<ChangedFile[]> {
  const data = utf8
    .decode(
      await git([
        "diff",
        "--name-status",
        "-z",
        "--no-ext-diff",
        "--no-textconv",
        "--no-relative",
        "--find-renames=100%",
        "-l500",
        previous,
        proposed,
        "--",
      ]),
    )
    .split("\0")
    .slice(0, -1);
  const changes: ChangedFile[] = [];
  for (let index = 0; index < data.length; ) {
    const status = data[index++];
    const path = data[index++];
    if (!status || !path) throw new Error("Git returned an invalid diff entry.");
    if (status.startsWith("R")) {
      const destination = data[index++];
      if (!destination) throw new Error("Git returned an invalid rename.");
      changes.push({ status: "renamed", path: destination, previousPath: path });
    } else {
      changes.push({
        status: status === "A" ? "added" : status === "D" ? "deleted" : "modified",
        path,
      });
    }
  }
  return changes.sort(orderPath);
}

async function readBlobs(
  git: GitReader,
  entries: TreeBlob[],
  bounds: { count: number; file: number; total: number },
  onSkip: (entry: TreeBlob, reason: string) => void,
) {
  const selected: TreeBlob[] = [];
  let size = 0;
  for (const entry of entries) {
    if (!isMigrationPath(`${entry.path}.sql`) || entry.size === null) {
      onSkip(
        entry,
        "The Git entry is outside supported paths or is a symlink, submodule, or other non-regular blob.",
      );
      continue;
    }
    if (
      entry.size > bounds.file ||
      size + entry.size > bounds.total ||
      selected.length >= bounds.count
    ) {
      onSkip(entry, "The Git blob exceeds the scan input limits.");
      continue;
    }
    selected.push(entry);
    size += entry.size;
  }
  if (!selected.length) return [];
  const data = await git(
    ["cat-file", "--batch"],
    size + selected.length * 128 + 1024,
    `${selected.map(({ oid }) => oid).join("\n")}\n`,
  );
  const files: { path: string; text: string }[] = [];
  let offset = 0;
  for (const entry of selected) {
    const endHeader = data.indexOf(10, offset);
    if (
      endHeader < 0 ||
      data.toString("ascii", offset, endHeader) !== `${entry.oid} blob ${entry.size}`
    ) {
      throw new Error(
        "A Git object could not be read. Fetch the complete objects for both revisions.",
      );
    }
    const end = endHeader + 1 + (entry.size ?? 0);
    if (data[end] !== 10) throw new Error("Git returned a truncated blob.");
    try {
      const text = utf8.decode(data.subarray(endHeader + 1, end));
      if (text.includes("\0")) throw new Error("Binary input");
      files.push({ path: entry.path, text });
    } catch {
      onSkip(entry, "The Git blob is binary or is outside UTF-8 text coverage.");
    }
    offset = end + 1;
  }
  return files;
}

export interface GitCompatibilityOptions {
  repo: string;
  previous: string;
  proposed: string;
  migrations: string;
  sources: string[];
  prisma?: string;
  baseline?: string;
  defaultSchema?: string;
}

export async function readCompatibilityInput(
  options: GitCompatibilityOptions,
): Promise<CompatibilityInput> {
  const migrationsDir = gitDirectory(options.migrations);
  const directories = options.sources.map(gitDirectory);
  if (!directories.length || directories.length > 16)
    throw new Error("Provide 1–16 source directories.");
  const prisma = options.prisma ?? "prisma/schema.prisma";
  if (
    !prisma.endsWith(".prisma") ||
    !isMigrationPath(`${prisma}.sql`) ||
    (options.baseline && !isMigrationPath(options.baseline))
  ) {
    throw new Error("Use a repository-relative .prisma schema and .sql database baseline.");
  }
  const git = gitReader(options.repo, AbortSignal.timeout(45000));
  try {
    await git(["rev-parse", "--git-dir"], 8192);
  } catch {
    throw new CompatibilityGitError(
      "COMPAT010",
      "Open a readable local Git checkout with Git 2.47 or later and pass its path with --repo.",
    );
  }
  async function commit(side: ReleaseSide) {
    const ref = options[side];
    try {
      return await resolveGitCommit(git, ref);
    } catch {
      const missing = side === "previous" ? "COMPAT009" : "COMPAT010";
      throw new CompatibilityGitError(
        missing,
        `Cannot resolve the ${side} release to a commit. Check --${side} and fetch the commit and tags if the checkout is shallow.`,
      );
    }
  }
  const previousCommit = await commit("previous");
  const proposedCommit = await commit("proposed");
  const [previousTree, proposedTree, diff] = await Promise.all([
    readTree(git, previousCommit),
    readTree(git, proposedCommit),
    readDiff(git, previousCommit, proposedCommit),
  ]);
  const gaps: CoverageGap[] = [];
  try {
    await git(["merge-base", "--is-ancestor", previousCommit, proposedCommit], 1024);
  } catch {
    gaps.push({
      kind: "history",
      scope: "migrations",
      message:
        "The proposed revision does not have a verified ancestry from the previous release. Check the base reference and fetch full Git history.",
    });
  }
  if (
    migrationsDir !== "." &&
    ![...previousTree.keys(), ...proposedTree.keys()].some((path) =>
      inDirectory(path, migrationsDir),
    )
  ) {
    throw new Error(
      "The migration directory has no tracked entries in either release. Check --migrations.",
    );
  }
  const isMigration = (path: string) =>
    path.toLowerCase().endsWith(".sql") && inDirectory(path, migrationsDir);
  const matches = (file: ChangedFile, predicate: (path: string) => boolean) =>
    predicate(file.path) || (file.previousPath !== undefined && predicate(file.previousPath));
  const migrationChanges = diff.filter((file) => matches(file, isMigration));
  const sourceChanges = diff.filter((file) =>
    matches(
      file,
      (path) => sourcePath(path, directories, migrationsDir, options.baseline) || path === prisma,
    ),
  );
  const migrationEntries = migrationChanges.flatMap((change) => {
    if (change.status !== "added") {
      gaps.push({
        kind: "migration",
        scope: "migrations",
        location: atFile(change.path),
        message:
          "An existing migration was edited, moved or removed. The executed migration history requires verification.",
      });
    }
    const entry = isMigration(change.path) ? proposedTree.get(change.path) : undefined;
    return entry ? [entry] : [];
  });

  async function snapshot(
    side: ReleaseSide,
    tree: Map<string, TreeBlob>,
    commit: string,
  ): Promise<Snapshot> {
    const entries = [...tree.values()]
      .filter(({ path }) => sourcePath(path, directories, migrationsDir, options.baseline))
      .sort(orderPath);
    const onSkip = (entry: TreeBlob, message: string) =>
      gaps.push({ kind: "source", scope: side, message, location: atFile(entry.path) });
    const sources = await readBlobs(
      git,
      entries,
      { count: MAX_SOURCE_FILES, file: MAX_SOURCE_FILE_BYTES, total: MAX_SOURCE_BYTES },
      onSkip,
    );
    const schema = tree.get(prisma);
    const [prismaFile] = await readBlobs(
      git,
      schema ? [schema] : [],
      { count: 1, file: MAX_FILE_BYTES, total: MAX_FILE_BYTES },
      onSkip,
    );
    if (options.prisma && !schema)
      gaps.push({
        kind: "schema",
        scope: side,
        location: atFile(prisma),
        message: "The configured Prisma schema is missing from this release.",
      });
    const typescriptConfigs = await readBlobs(
      git,
      [...tree.values()].filter(({ path }) => isTypescriptConfig(path)).sort(orderPath),
      { count: 32, file: MAX_FILE_BYTES, total: 1024 * 1024 },
      onSkip,
    );
    return {
      release: { ref: options[side], commit },
      sources,
      prisma: prismaFile,
      typescriptConfigs,
    };
  }

  const baselineEntry = options.baseline ? previousTree.get(options.baseline) : undefined;
  const [previous, proposed, migrationFiles, baselineFiles] = await Promise.all([
    snapshot("previous", previousTree, previousCommit),
    snapshot("proposed", proposedTree, proposedCommit),
    readBlobs(
      git,
      migrationEntries,
      { count: MAX_FILES, file: MAX_FILE_BYTES, total: MAX_TOTAL_BYTES },
      (entry, message) =>
        gaps.push({
          kind: "migration",
          scope: "migrations",
          message,
          location: atFile(entry.path),
        }),
    ),
    readBlobs(
      git,
      baselineEntry ? [baselineEntry] : [],
      { count: 1, file: MAX_FILE_BYTES, total: MAX_FILE_BYTES },
      (entry, message) =>
        gaps.push({ kind: "schema", scope: "schema", message, location: atFile(entry.path) }),
    ),
  ]);
  const baseline = baselineFiles[0];
  if (options.baseline && !baselineEntry)
    gaps.push({
      kind: "schema",
      scope: "schema",
      message: "The configured SQL baseline is missing from the previous release.",
      location: atFile(options.baseline),
    });
  return {
    previous,
    proposed,
    migrations: migrationFiles.map(({ path, text }) => ({ path, sql: text })),
    migrationChanges,
    sourceChanges,
    baseline: baseline && { path: baseline.path, sql: baseline.text },
    defaultSchema: options.defaultSchema,
    gaps,
  };
}

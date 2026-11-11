import { execFile } from "node:child_process";
import { resolve } from "node:path";

export const gitOid = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
export const utf8 = new TextDecoder("utf-8", { fatal: true });

export function gitReader(repo: string, signal?: AbortSignal) {
  const directory = resolve(repo);
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith("GIT_")),
  );
  return (args: string[], maxBuffer = 4 * 1024 * 1024, input?: string) =>
    new Promise<Buffer>((done, fail) => {
      const child = execFile(
        "git",
        [
          "--no-replace-objects",
          "--no-optional-locks",
          "--no-lazy-fetch",
          "-C",
          directory,
          ...args,
        ],
        {
          encoding: "buffer",
          maxBuffer,
          timeout: 15000,
          signal,
          windowsHide: true,
          env: { ...env, GIT_TERMINAL_PROMPT: "0", GIT_CONFIG_COUNT: "0" },
        },
        (error, stdout) => (error ? fail(error) : done(stdout)),
      );
      child.stdin?.on("error", () => undefined);
      child.stdin?.end(input);
    });
}

export type GitReader = ReturnType<typeof gitReader>;

export function isReleaseRef(ref: string) {
  return !!ref && ref.length <= 256 && !ref.startsWith("-") && !/[\s\p{Cc}\p{Cf}]/u.test(ref);
}

export async function resolveGitCommit(git: GitReader, ref: string) {
  if (!isReleaseRef(ref)) throw new Error("Expected a valid Git branch, tag or commit reference.");
  const sha = utf8
    .decode(await git(["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`], 1024))
    .trim();
  if (!gitOid.test(sha)) throw new Error("Git did not return a commit ID.");
  return sha;
}

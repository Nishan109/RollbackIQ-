import { setTimeout } from "node:timers/promises";
import { githubReady } from "../lib/github/config";
import { githubStore } from "../lib/github/store";
import { runGithubJob } from "../lib/github/worker";

async function main() {
  if (!githubReady()) {
    console.error(
      "Configure the GitHub App and Supabase in apps/web/.env.local before starting the worker.",
    );
    process.exitCode = 1;
  } else {
    let stopped = false;
    process.on("SIGINT", () => {
      stopped = true;
    });
    process.on("SIGTERM", () => {
      stopped = true;
    });
    const store = githubStore();
    console.log("RollbackIQ GitHub worker started.");
    while (!stopped) {
      try {
        const worked = await runGithubJob(store);
        if (!worked || stopped) {
          if (process.argv.includes("--once")) break;
          await setTimeout(3000);
        }
      } catch {
        console.error("GitHub queue unavailable. Check configuration and migrations.");
        if (process.argv.includes("--once")) {
          process.exitCode = 1;
          break;
        }
        await setTimeout(5000);
      }
      if (process.argv.includes("--once")) break;
    }
  }
}
void main().catch(() => {
  console.error("GitHub worker stopped unexpectedly.");
  process.exitCode = 1;
});

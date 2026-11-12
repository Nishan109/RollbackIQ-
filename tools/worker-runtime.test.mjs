import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { installWorkerControl, workerLogger } from "./worker-runtime.mjs";

test("worker logs retain correlation IDs, discard secret fields and rotate within a fixed bound", () => {
  const directory = mkdtempSync(join(tmpdir(), "rollbackiq-logging-"));
  try {
    const emitted = [];
    const log = workerLogger(directory, "a".repeat(40), (line) => emitted.push(line));
    const job = "00000000-0000-4000-8000-000000000001";
    log(JSON.stringify({ event: "github_job_started", job_id: job, attempt: 1, token: "secret" }));
    log(
      JSON.stringify({
        event: "github_job_failed",
        job_id: "secret",
        reason: "secret",
        message: "secret",
      }),
    );
    log("secret");
    assert.equal(JSON.parse(emitted[0]).job_id, job);
    assert.equal(JSON.parse(emitted[0]).attempt, 1);
    assert.doesNotMatch(emitted.join(""), /secret/);
    for (let i = 0; i < 3; i++) {
      writeFileSync(join(directory, "worker.log"), "x".repeat(1024 * 1024));
      log(JSON.stringify({ event: "github_worker_started" }));
    }
    assert.ok(readFileSync(join(directory, "worker.log")).byteLength < 1024);
    assert.equal(readFileSync(join(directory, "worker.log.1")).byteLength, 1024 * 1024);
    assert.equal(readFileSync(join(directory, "worker.log.2")).byteLength, 1024 * 1024);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a hidden worker accepts a private stop marker, drains and starts again", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rollbackiq-control-"));
  const moduleUrl = new URL("./worker-runtime.mjs", import.meta.url).href;
  const childSource = `
    import { installWorkerControl } from ${JSON.stringify(moduleUrl)};
    const idle = setInterval(() => {}, 1000);
    process.once('SIGINT', () => { clearInterval(idle); console.log('drained'); });
    installWorkerControl(process.argv[1], 'a'.repeat(40), 0);
    console.log('ready');
  `;
  try {
    for (let run = 0; run < 2; run++) {
      const child = spawn(
        process.execPath,
        ["--input-type=module", "--eval", childSource, directory],
        {
          windowsHide: true,
          stdio: ["ignore", "pipe", "inherit"],
        },
      );
      const exited = once(child, "exit");
      let output = "";
      child.stdout.on("data", (data) => {
        output += data.toString();
      });
      try {
        const deadline = Date.now() + 5000;
        while (!output.includes("ready") && Date.now() < deadline) await sleep(25);
        assert.match(output, /ready/);
        const control = JSON.parse(readFileSync(join(directory, "worker-control.json"), "utf8"));
        assert.equal(control.pid, child.pid);
        assert.equal(control.release, "a".repeat(40));
        writeFileSync(join(directory, control.stopFile), "drain");
        const result = await Promise.race([exited, sleep(5000, null, { ref: false })]);
        assert.deepEqual(result, [0, null]);
        assert.match(output, /drained/);
      } finally {
        if (child.exitCode === null) child.kill();
        await exited;
      }
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("worker control refuses a second owner of a live control record", () => {
  const directory = mkdtempSync(join(tmpdir(), "rollbackiq-control-lock-"));
  const dispose = installWorkerControl(directory, "a".repeat(40), 0);
  try {
    assert.throws(() => installWorkerControl(directory, "a".repeat(40), 0), /already active/);
  } finally {
    dispose();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Windows stop command rejects a mismatched release and gracefully stops only its fixture", {
  skip: process.platform !== "win32",
}, async () => {
  const directory = mkdtempSync(join(tmpdir(), "rollbackiq-stop-script-"));
  const runtime = join(directory, "RollbackIQ/windows-worker");
  mkdirSync(runtime, { recursive: true });
  const entrypoint = join(directory, "rollbackiq-worker.mjs");
  const moduleUrl = new URL("./worker-runtime.mjs", import.meta.url).href;
  writeFileSync(
    entrypoint,
    `
    import { installWorkerControl } from ${JSON.stringify(moduleUrl)};
    const idle = setInterval(() => {}, 1000);
    process.once('SIGINT', () => { clearInterval(idle); });
    installWorkerControl(${JSON.stringify(runtime)}, 'a'.repeat(40), 0);
    console.log('ready');
  `,
  );
  const child = spawn(process.execPath, [entrypoint, "start"], {
    windowsHide: true,
    stdio: ["ignore", "pipe", "inherit"],
  });
  const exited = once(child, "exit");
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  async function stop(release) {
    const powershell =
      process.env.ROLLBACKIQ_TEST_POWERSHELL ??
      join(process.env.SystemRoot, "System32/WindowsPowerShell/v1.0/powershell.exe");
    const script = fileURLToPath(new URL("./stop-rollbackiq-worker.ps1", import.meta.url));
    const command = spawn(
      powershell,
      [
        "-NoProfile",
        "-NonInteractive",
        "-File",
        script,
        "-ExpectedRelease",
        release,
        "-TimeoutSeconds",
        "5",
      ],
      {
        env: { ...process.env, LOCALAPPDATA: directory },
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let messages = "";
    command.stdout.on("data", (chunk) => {
      messages += chunk.toString();
    });
    command.stderr.on("data", (chunk) => {
      messages += chunk.toString();
    });
    return { exit: (await once(command, "exit"))[0], messages };
  }
  try {
    const deadline = Date.now() + 5000;
    while (!output.includes("ready") && Date.now() < deadline) await sleep(25);
    assert.match(output, /ready/);
    const control = JSON.parse(readFileSync(join(runtime, "worker-control.json"), "utf8"));
    assert.equal((await stop("b".repeat(40))).exit, 1);
    assert.equal(existsSync(join(runtime, control.stopFile)), false);
    assert.equal(child.exitCode, null);
    const result = await stop("a".repeat(40));
    assert.equal(result.exit, 0, result.messages);
    assert.deepEqual(await exited, [0, null]);
    assert.equal(existsSync(join(runtime, "worker-control.json")), false);
  } finally {
    if (child.exitCode === null) child.kill();
    await exited;
    rmSync(directory, { recursive: true, force: true });
  }
});

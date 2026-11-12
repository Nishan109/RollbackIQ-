import { randomUUID } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  lstatSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

const events = new Set([
  "github_worker_started",
  "github_worker_draining",
  "github_worker_stopped",
  "github_worker_unavailable",
  "github_worker_exit",
  "github_job_started",
  "github_job_completed",
  "github_job_cancelled",
  "github_job_failed",
  "github_job_lease_lost",
  "github_job_retry",
  "github_check_unpublished",
  "github_check_terminal_update_failed",
]);
const reasons = new Set([
  "queue_protocol_mismatch",
  "web_unavailable",
  "web_release_mismatch",
  "queue_or_dependency_unavailable",
  "startup_or_dependency_failure",
]);
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export function workerLogger(directory, release, output = (line) => process.stdout.write(line)) {
  const path = join(directory, "worker.log");
  return (value) => {
    let event;
    try {
      event = JSON.parse(value);
    } catch {}
    const record = {
      at: new Date().toISOString(),
      event: events.has(event?.event) ? event.event : "worker_message",
      release,
    };
    if (reasons.has(event?.reason)) record.reason = event.reason;
    for (const key of ["job_id", "scan_id"]) {
      if (typeof event?.[key] === "string" && uuid.test(event[key])) record[key] = event[key];
    }
    for (const key of ["repository_id", "pull_number", "attempt", "duration_ms", "check_id"]) {
      if (Number.isSafeInteger(event?.[key]) && event[key] >= 0) record[key] = event[key];
    }
    if (/^[a-f0-9]{40}$/.test(event?.head_sha ?? "")) record.head_sha = event.head_sha;
    const line = `${JSON.stringify(record)}\n`;
    output(line);
    try {
      if (existsSync(path) && statSync(path).size + Buffer.byteLength(line) > 1024 * 1024) {
        if (existsSync(`${path}.2`)) unlinkSync(`${path}.2`);
        if (existsSync(`${path}.1`)) renameSync(`${path}.1`, `${path}.2`);
        renameSync(path, `${path}.1`);
      }
      appendFileSync(path, line);
    } catch {
      // Lifecycle output remains available in the launcher's standard output log.
    }
  };
}

// The PowerShell launcher verifies this directory is writable only by its owner,
// SYSTEM and Administrators before creating a file-based shutdown channel.
export function installWorkerControl(
  directory,
  release,
  port,
  stop = () => process.emit("SIGINT"),
) {
  const metadataPath = join(directory, "worker-control.json");
  if (existsSync(metadataPath)) {
    if (!lstatSync(metadataPath).isFile() || lstatSync(metadataPath).isSymbolicLink())
      throw new Error("Worker control must be a regular file");
    const previous = JSON.parse(readFileSync(metadataPath, "utf8"));
    if (!Number.isSafeInteger(previous.pid) || previous.pid < 1)
      throw new Error("Invalid worker control record");
    try {
      process.kill(previous.pid, 0);
      throw new Error("Worker control is already active");
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
    unlinkSync(metadataPath);
  }
  const stopFile = `worker-${process.pid}-${randomUUID()}.stop`;
  const stopPath = join(directory, stopFile);
  writeFileSync(
    metadataPath,
    JSON.stringify({
      pid: process.pid,
      release,
      port,
      processStartedAt: new Date(Date.now() - process.uptime() * 1000).toISOString(),
      stopFile,
    }),
    { flag: "wx", mode: 0o600 },
  );
  const timer = setInterval(() => {
    if (existsSync(stopPath)) {
      clearInterval(timer);
      stop();
    }
  }, 300);
  timer.unref();
  const dispose = () => {
    clearInterval(timer);
    process.removeListener("exit", dispose);
    try {
      const current = JSON.parse(readFileSync(metadataPath, "utf8"));
      if (current.pid === process.pid && current.stopFile === stopFile) unlinkSync(metadataPath);
      if (existsSync(stopPath)) unlinkSync(stopPath);
    } catch {}
  };
  process.once("exit", dispose);
  return dispose;
}

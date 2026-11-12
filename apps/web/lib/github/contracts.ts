import { isMigrationPath } from "@rollbackiq/scanner-core";
import { z } from "zod";

export const githubId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const sha = z.string().regex(/^[a-f0-9]{40}$/);
export const fullName = z
  .string()
  .max(140)
  .regex(/^[\w.-]+\/[\w.-]+$/)
  .refine((name) => name.split("/").every((part) => part !== "." && part !== ".."));
const directory = z
  .string()
  .max(200)
  .refine((s) => s === "." || isMigrationPath(`${s}/x.sql`));
const file = z
  .string()
  .max(200)
  .refine((s) => !s || isMigrationPath(`${s}.sql`));
export const scanConfiguration = z.strictObject({
  migrations: directory,
  sources: z.array(directory).min(1).max(10),
  prisma: file.default(""),
  baseline: file.default(""),
  previous: z
    .string()
    .min(1)
    .max(200)
    .regex(/^[A-Za-z0-9_][A-Za-z0-9_./-]*$/),
  defaultSchema: z
    .string()
    .min(1)
    .refine((s) => Buffer.byteLength(s) <= 63 && !/[\p{Cc}\p{Cf}]/u.test(s))
    .default("public"),
  publishChecks: z.boolean().default(true),
  checkPolicy: z
    .strictObject({
      failOn: z.enum(["critical", "high", "medium", "low", "info", "none"]),
      incomplete: z.enum(["action_required", "failure"]),
    })
    .optional(),
});
export type ScanConfiguration = z.infer<typeof scanConfiguration>;
export const repository = z.object({
  id: githubId,
  full_name: fullName,
  permissions: z.object({ admin: z.boolean().optional() }).optional(),
});
export const installation = z.object({
  id: githubId,
  app_id: githubId,
  account: z.object({ id: githubId, login: z.string().min(1).max(100) }),
  suspended_at: z.string().nullable().optional(),
  permissions: z.object({ checks: z.string().optional() }).optional(),
});
export const choices = z.object({ installation, repositories: z.array(repository).max(1000) });
export const jobSchema = z.object({
  id: z.uuid(),
  organization_id: z.uuid(),
  repository_id: z.uuid(),
  installation_id: githubId,
  github_id: githubId,
  full_name: fullName,
  pull_number: z.number().int().positive(),
  head_sha: sha,
  lease_token: z.uuid(),
  check_id: githubId.nullable(),
  configuration: scanConfiguration,
  attempts: z.number().int(),
  scan_id: z.uuid().nullable(),
  check_state: z
    .enum(["disabled", "pending", "in_progress", "published", "blocked", "failed"])
    .nullish(),
  check_error: z.string().nullish(),
  check_conclusion: z.string().nullish(),
});
export type GithubJob = z.infer<typeof jobSchema>;

// Unknown provider fields are stripped before persistence. No source, comment,
// commit message, email or tenant identity is accepted from webhook payloads.
export const webhookPayload = z.object({
  action: z.string().max(100).optional(),
  installation: z.object({ id: githubId }).optional(),
  repository: z.object({ id: githubId, full_name: fullName }).optional(),
  pull_request: z
    .object({ number: z.number().int().positive(), head: z.object({ sha }) })
    .optional(),
  repositories_removed: z
    .array(z.object({ id: githubId }))
    .max(1000)
    .optional(),
});

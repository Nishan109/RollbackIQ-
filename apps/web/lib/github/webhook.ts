import { randomUUID } from "node:crypto";
import { z } from "zod";
import { apiJson } from "../bounded-json";
import { webhookPayload } from "./contracts";
import { boundedBytes, validSignature } from "./security";
import type { GithubRpc } from "./store";

export async function receiveWebhook(request: Request, secret: string, store: GithubRpc) {
  const requestId = randomUUID();
  const started = Date.now();
  let delivery: string | undefined;
  const reply = (body: unknown, status: number, context: Record<string, unknown> = {}) => {
    console.info(
      JSON.stringify({
        event: "github_webhook",
        request_id: requestId,
        delivery_id: delivery,
        status,
        duration_ms: Date.now() - started,
        ...context,
      }),
    );
    return apiJson(body, status, { "X-Request-ID": requestId });
  };
  try {
    if (Number(request.headers.get("content-length")) > 1024 * 1024)
      return reply({ error: "Webhook exceeds 1 MiB." }, 413, { reason: "size_limit" });
    if (request.headers.get("content-type")?.split(";")[0] !== "application/json")
      return reply({ error: "Send application/json." }, 415, { reason: "content_type" });
    const raw = await boundedBytes(request.body, 1024 * 1024);
    if (!validSignature(raw, request.headers.get("x-hub-signature-256"), secret))
      return reply({ error: "Invalid webhook signature." }, 401, { reason: "signature_invalid" });
    delivery = z.uuid().parse(request.headers.get("x-github-delivery"));
    const event = z
      .enum([
        "ping",
        "installation",
        "installation_repositories",
        "repository",
        "pull_request",
        "github_app_authorization",
      ])
      .safeParse(request.headers.get("x-github-event"));
    if (!event.success)
      return reply({ accepted: true, ignored: true }, 202, { reason: "unsupported_event" });
    let decoded: string;
    try {
      decoded = new TextDecoder("utf-8", { fatal: true }).decode(raw);
    } catch {
      return reply({ error: "Invalid webhook payload." }, 400, { reason: "invalid_utf8" });
    }
    const payload = webhookPayload.parse(JSON.parse(decoded) as unknown);
    if (event.data === "ping" || event.data === "github_app_authorization")
      return reply({ accepted: true }, 202, { github_event: event.data });
    if (
      !payload.installation ||
      (event.data === "pull_request" &&
        (!payload.repository || !payload.pull_request || !payload.action)) ||
      (event.data === "repository" && !payload.repository)
    )
      return reply({ error: "Invalid event payload." }, 400, { reason: "payload_incomplete" });
    const result = await store("webhook", { delivery, event: event.data, payload });
    return reply({ accepted: true, result }, 202, {
      github_event: event.data,
      repository_id: payload.repository?.id,
      pull_number: payload.pull_request?.number,
      head_sha: payload.pull_request?.head.sha,
    });
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError)
      return reply({ error: "Invalid webhook payload." }, 400, { reason: "payload_invalid" });
    if (error instanceof Error && error.message.includes("size limit"))
      return reply({ error: "Webhook exceeds 1 MiB." }, 413, { reason: "size_limit" });
    return reply({ error: "Webhook could not be saved. Retry this delivery." }, 503, {
      reason: "queue_unavailable",
    });
  }
}

import { z } from "zod";
import { apiJson } from "../bounded-json";
import { webhookPayload } from "./contracts";
import { boundedBytes, validSignature } from "./security";
import type { GithubRpc } from "./store";

export async function receiveWebhook(request: Request, secret: string, store: GithubRpc) {
  try {
    if (Number(request.headers.get("content-length")) > 1024 * 1024)
      return apiJson({ error: "Webhook exceeds 1 MiB." }, 413);
    if (request.headers.get("content-type")?.split(";")[0] !== "application/json")
      return apiJson({ error: "Send application/json." }, 415);
    const raw = await boundedBytes(request.body, 1024 * 1024);
    if (!validSignature(raw, request.headers.get("x-hub-signature-256"), secret))
      return apiJson({ error: "Invalid webhook signature." }, 401);
    const delivery = z.uuid().parse(request.headers.get("x-github-delivery"));
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
    if (!event.success) return apiJson({ accepted: true, ignored: true }, 202);
    const payload = webhookPayload.parse(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw)) as unknown,
    );
    if (event.data === "ping" || event.data === "github_app_authorization")
      return apiJson({ accepted: true }, 202);
    if (
      !payload.installation ||
      (event.data === "pull_request" &&
        (!payload.repository || !payload.pull_request || !payload.action)) ||
      (event.data === "repository" && !payload.repository)
    )
      return apiJson({ error: "Invalid event payload." }, 400);
    const result = await store("webhook", { delivery, event: event.data, payload });
    return apiJson({ accepted: true, result }, 202);
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError)
      return apiJson({ error: "Invalid webhook payload." }, 400);
    if (error instanceof Error && error.message.includes("size limit"))
      return apiJson({ error: "Webhook exceeds 1 MiB." }, 413);
    return apiJson({ error: "Webhook could not be saved. Retry this delivery." }, 503);
  }
}

import { cookies } from "next/headers";
import { z } from "zod";
import { apiJson } from "../bounded-json";
import { supabaseIdentity } from "../supabase/server";
import { beginAuthorization, consumeAuthorization, type FlowCookie } from "./authorization";
import { githubReady, githubSettings } from "./config";
import { choices, githubId, scanConfiguration } from "./contracts";
import { Github } from "./provider";
import { boundedBytes } from "./security";
import { githubStore } from "./store";

const COOKIE = "rollbackiq-github";
function navigate(path: string) {
  return new Response(null, {
    status: 303,
    headers: {
      Location: path,
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}
async function putCookie(cookie: FlowCookie | null) {
  (await cookies()).set(COOKIE, cookie ? JSON.stringify(cookie) : "", {
    httpOnly: true,
    sameSite: "lax",
    secure: githubSettings()?.origin.startsWith("https:"),
    path: "/api/github",
    maxAge: cookie ? 600 : 0,
  });
}
async function formBody(request: Request) {
  const bytes = await boundedBytes(request.body, 64 * 1024);
  const contentType = request.headers.get("content-type")?.split(";")[0];
  if (contentType === "application/json")
    return JSON.parse(bytes.toString("utf8")) as Record<string, unknown>;
  if (contentType !== "application/x-www-form-urlencoded")
    throw new Error("Unsupported form encoding");
  const values = new URLSearchParams(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  const result: Record<string, unknown> = {};
  for (const key of new Set(values.keys())) {
    const all = values.getAll(key);
    result[key] = key === "repositories" ? all : all[0];
  }
  return result;
}
export function githubPost(action: "connect" | "repositories" | "disconnect" | "configure") {
  return async (request: Request) => {
    if (!githubReady())
      return apiJson({ error: "Configure Supabase and the GitHub App before connecting." }, 503);
    const settings = githubSettings();
    if (!settings) return apiJson({ error: "GitHub is unconfigured." }, 503);
    if (request.headers.get("origin") !== settings.origin)
      return apiJson({ error: "Invalid request origin." }, 403);
    const identity = await supabaseIdentity();
    if (!identity) return apiJson({ error: "Sign in to connect GitHub." }, 401);
    let organization: string | undefined;
    try {
      const body = await formBody(request);
      organization = z.uuid().parse(body.organization);
      const store = githubStore();
      const common = { actor: identity.user.id, organization };
      if (action === "connect") {
        const id = body.installation ? githubId.parse(Number(body.installation)) : undefined;
        const flow = await beginAuthorization(
          store,
          new Github(),
          identity.user.id,
          organization,
          id,
        );
        await putCookie(flow.cookie);
        return navigate(flow.url);
      }
      if (action === "repositories") {
        const choice = z.uuid().parse(body.choice);
        const repositories = z
          .array(z.coerce.number().pipe(githubId))
          .min(1)
          .max(100)
          .parse(body.repositories);
        // Recheck installation access immediately before committing a selection.
        const dashboard = z
          .object({ choices: z.object({ id: z.uuid(), payload: choices }).nullable() })
          .parse(await store("dashboard", common));
        if (!dashboard.choices || dashboard.choices.id !== choice)
          throw new Error("Selection expired");
        const provider = new Github();
        const selected = dashboard.choices.payload;
        await provider.installation(selected.installation.id);
        for (const id of repositories) {
          const expected = selected.repositories.find((r) => r.id === id);
          if (!expected) throw new Error("Repository not authorized");
          const token = await provider.token(selected.installation.id, id);
          const actual = z
            .object({ id: githubId, full_name: z.string() })
            .parse(await provider.request(`/repos/${expected.full_name}`, token));
          if (actual.id !== id || actual.full_name !== expected.full_name)
            throw new Error("Repository identity changed; refresh authorization");
        }
        await store("select", { ...common, choice, repositories });
      } else if (action === "disconnect") {
        await store("disconnect", {
          ...common,
          ...(body.repository ? { repository: z.uuid().parse(body.repository) } : {}),
        });
      } else {
        const configuration = scanConfiguration.parse({
          migrations: body.migrations,
          sources: String(body.sources ?? "")
            .split(",")
            .map((s) => s.trim()),
          prisma: body.prisma || "",
          baseline: body.baseline || "",
          previous: body.previous,
          defaultSchema: body.defaultSchema || "public",
          publishChecks: body.publishChecks === "on" || body.publishChecks === true,
        });
        await store("configure", {
          ...common,
          repository: z.uuid().parse(body.repository),
          configuration,
          enabled: body.enabled === "on" || body.enabled === true,
        });
      }
      return navigate(
        `/team/github?organization=${organization}&notice=${action === "disconnect" ? "disconnected" : "saved"}`,
      );
    } catch {
      return navigate(
        organization
          ? `/team/github?organization=${organization}&notice=failed`
          : "/team?notice=invalid",
      );
    }
  };
}
export async function githubSetup(request: Request) {
  if (!githubReady()) return apiJson({ error: "GitHub App is unconfigured." }, 503);
  const identity = await supabaseIdentity();
  if (!identity) return navigate("/auth");
  try {
    const params = new URL(request.url).searchParams;
    const store = githubStore();
    const flow = await consumeAuthorization(
      store,
      identity.user.id,
      (await cookies()).get(COOKIE)?.value,
      params.get("state"),
      "install",
    );
    await putCookie(null);
    if (params.get("setup_action") === "request")
      return navigate(`/team/github?organization=${flow.organization}&notice=pending`);
    const id = githubId.parse(Number(params.get("installation_id")));
    const next = await beginAuthorization(
      store,
      new Github(),
      identity.user.id,
      flow.organization,
      id,
    );
    await putCookie(next.cookie);
    return navigate(next.url);
  } catch {
    await putCookie(null);
    return navigate("/team?notice=github_failed");
  }
}
export async function githubCallback(request: Request) {
  if (!githubReady()) return apiJson({ error: "GitHub App is unconfigured." }, 503);
  const identity = await supabaseIdentity();
  if (!identity) return navigate("/auth");
  try {
    const params = new URL(request.url).searchParams;
    const store = githubStore();
    const flow = await consumeAuthorization(
      store,
      identity.user.id,
      (await cookies()).get(COOKIE)?.value,
      params.get("state"),
      "oauth",
    );
    await putCookie(null);
    if (params.has("error"))
      return navigate(`/team/github?organization=${flow.organization}&notice=cancelled`);
    const code = z.string().min(1).max(512).parse(params.get("code"));
    if (!flow.cookie.installation) throw new Error("Missing installation");
    const provider = new Github();
    const token = await provider.exchange(code, flow.cookie.verifier);
    const payload = await provider.authorizedChoices(token, flow.cookie.installation);
    // Only a five-minute, verified repository selection is persisted. The user
    // token and any refresh token are deliberately discarded after this request.
    await store("choices", { actor: identity.user.id, organization: flow.organization, payload });
    return navigate(`/team/github?organization=${flow.organization}&notice=authorized`);
  } catch {
    await putCookie(null);
    return navigate("/team?notice=github_failed");
  }
}

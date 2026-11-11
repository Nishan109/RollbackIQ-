import { z } from "zod";
import type { Github } from "./provider";
import { equalSecret, pkceChallenge, randomSecret, stateHash } from "./security";
import type { GithubRpc } from "./store";

export const flowCookie = z.object({
  state: z.string().regex(/^[\w-]{43}$/),
  verifier: z.string().regex(/^[\w-]{43}$/),
  phase: z.enum(["install", "oauth"]),
  installation: z.number().int().positive().optional(),
});
export type FlowCookie = z.infer<typeof flowCookie>;
export async function beginAuthorization(
  store: GithubRpc,
  provider: Github,
  actor: string,
  organization: string,
  installation?: number,
) {
  const cookie: FlowCookie = {
    state: randomSecret(),
    verifier: randomSecret(),
    phase: installation ? "oauth" : "install",
    installation,
  };
  await store("begin", { actor, organization, hash: stateHash(cookie.state), phase: cookie.phase });
  const url = installation
    ? new URL("https://github.com/login/oauth/authorize")
    : new URL(`https://github.com/apps/${provider.settings.slug}/installations/new`);
  url.searchParams.set("state", cookie.state);
  if (installation) {
    url.searchParams.set("client_id", provider.settings.clientId);
    url.searchParams.set("redirect_uri", `${provider.settings.origin}/api/github/callback`);
    url.searchParams.set("code_challenge", pkceChallenge(cookie.verifier));
    url.searchParams.set("code_challenge_method", "S256");
  }
  return { cookie, url: url.toString() };
}
export async function consumeAuthorization(
  store: GithubRpc,
  actor: string,
  rawCookie: string | undefined,
  returnedState: string | null,
  phase: "install" | "oauth",
) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawCookie ?? "null");
  } catch {
    throw new Error("Invalid authorization cookie");
  }
  const cookie = flowCookie.parse(parsed);
  if (!returnedState || cookie.phase !== phase || !equalSecret(cookie.state, returnedState))
    throw new Error("Invalid authorization state");
  const result = z
    .object({ organization: z.uuid() })
    .parse(await store("consume", { actor, hash: stateHash(cookie.state), phase }));
  return { cookie, organization: result.organization };
}

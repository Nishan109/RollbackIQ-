import { createPrivateKey, sign } from "node:crypto";
import { z } from "zod";
import { githubSettings } from "./config";
import { choices, githubId, installation, repository } from "./contracts";
import { boundedBytes } from "./security";

export class GithubError extends Error {
  constructor(readonly status: number) {
    super(`GitHub request failed (${status}). Reauthorize or try again later.`);
  }
}
export class Github {
  readonly settings;
  constructor(
    readonly fetcher: typeof fetch = fetch,
    readonly signal?: AbortSignal,
  ) {
    const settings = githubSettings();
    if (!settings) throw new Error("GitHub App is not configured");
    this.settings = settings;
  }
  jwt() {
    const now = Math.floor(Date.now() / 1000);
    const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
    const body = Buffer.from(
      JSON.stringify({ iat: now - 60, exp: now + 540, iss: this.settings.clientId }),
    ).toString("base64url");
    const unsigned = `${header}.${body}`;
    const key = createPrivateKey(this.settings.privateKey);
    if (key.asymmetricKeyType !== "rsa") throw new Error("GitHub requires an RSA private key");
    return `${unsigned}.${sign("RSA-SHA256", Buffer.from(unsigned), key).toString("base64url")}`;
  }
  async request(path: string, token: string, method = "GET", body?: unknown) {
    if (!path.startsWith("/") || path.startsWith("//")) throw new Error("Invalid GitHub API path");
    const response = await this.fetcher(`https://api.github.com${path}`, {
      method,
      redirect: "error",
      cache: "no-store",
      signal: this.signal
        ? AbortSignal.any([this.signal, AbortSignal.timeout(15_000)])
        : AbortSignal.timeout(15_000),
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2026-03-10",
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new GithubError(response.status);
    }
    const bytes = await boundedBytes(response.body, 12 * 1024 * 1024);
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  }
  async exchange(code: string, verifier: string) {
    const response = await this.fetcher("https://github.com/login/oauth/access_token", {
      method: "POST",
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: this.settings.clientId,
        client_secret: this.settings.clientSecret,
        code,
        code_verifier: verifier,
        redirect_uri: `${this.settings.origin}/api/github/callback`,
      }),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new GithubError(response.status);
    }
    const value: unknown = JSON.parse(
      (await boundedBytes(response.body, 16 * 1024)).toString("utf8"),
    );
    return z.object({ access_token: z.string().min(1).max(512) }).parse(value).access_token;
  }
  async installation(id: number) {
    const value = installation.parse(await this.request(`/app/installations/${id}`, this.jwt()));
    if (value.app_id !== this.settings.appId || value.suspended_at)
      throw new Error("Installation is unavailable");
    return value;
  }
  async token(id: number, repositoryId?: number) {
    return z
      .object({ token: z.string().min(1), expires_at: z.string() })
      .parse(
        await this.request(
          `/app/installations/${id}/access_tokens`,
          this.jwt(),
          "POST",
          repositoryId ? { repository_ids: [repositoryId] } : {},
        ),
      ).token;
  }
  async authorizedChoices(token: string, id: number) {
    // This endpoint proves the user can access this specific installation. A
    // repository must additionally grant that user administrative authority.
    const repos: z.infer<typeof repository>[] = [];
    for (let page = 1; page <= 10; page++) {
      const result = z
        .object({ total_count: z.number().int().nonnegative(), repositories: z.array(repository) })
        .parse(
          await this.request(
            `/user/installations/${id}/repositories?per_page=100&page=${page}`,
            token,
          ),
        );
      if (result.total_count > 1000)
        throw new Error("Installation exceeds the supported 1,000 repository limit");
      repos.push(...result.repositories);
      if (repos.length >= result.total_count) break;
      if (page === 10 || !result.repositories.length)
        throw new Error("Repository listing is incomplete");
    }
    const user = z.object({ id: githubId }).parse(await this.request("/user", token));
    const appInstallation = await this.installation(id);
    return choices.parse({
      installation: appInstallation,
      repositories: repos.filter(
        (r) => r.permissions?.admin === true || appInstallation.account.id === user.id,
      ),
    });
  }
}

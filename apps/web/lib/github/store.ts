import { createClient } from "@supabase/supabase-js";
import type { Database } from "../supabase/database";

export type GithubRpc = (action: string, data: Record<string, unknown>) => Promise<unknown>;
export function githubStore(): GithubRpc {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("GitHub persistence is not configured");
  const client = createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) =>
        fetch(input, {
          ...init,
          signal: init?.signal
            ? AbortSignal.any([init.signal, AbortSignal.timeout(15_000)])
            : AbortSignal.timeout(15_000),
        }),
    },
  });
  return async (action, data) => {
    const result = await client.rpc("rollbackiq_github_service", {
      p_action: action,
      p_data: data,
    });
    if (result.error)
      throw new Error("GitHub data operation failed. Check permissions and database migrations.");
    return result.data;
  };
}

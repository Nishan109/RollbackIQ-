import { supabaseService } from "../supabase/service";

export type GithubRpc = (action: string, data: Record<string, unknown>) => Promise<unknown>;
export function githubStore(worker = false): GithubRpc {
  const client = supabaseService();
  return async (action, data) => {
    const result = await client.rpc(
      worker ? "rollbackiq_github_worker" : "rollbackiq_github_service",
      {
        p_action: action,
        p_data: data,
      },
    );
    if (result.error)
      throw new Error("GitHub data operation failed. Check permissions and database migrations.");
    return result.data;
  };
}

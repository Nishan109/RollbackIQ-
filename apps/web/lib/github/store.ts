import { supabaseService } from "../supabase/service";

export type GithubRpc = (action: string, data: Record<string, unknown>) => Promise<unknown>;

export class InstallationAlreadyLinked extends Error {}

export async function ensureInstallationAvailable(installation: number, organization: string) {
  const { data, error } = await supabaseService()
    .from("github_connections")
    .select("organization_id")
    .eq("installation_id", installation)
    .maybeSingle();
  if (error) throw new Error("Could not check the installation's workspace.");
  if (data && data.organization_id !== organization) throw new InstallationAlreadyLinked();
}

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
    if (result.error) {
      if (
        action === "select" &&
        result.error.code === "42501" &&
        result.error.message === "Installation is already associated"
      )
        throw new InstallationAlreadyLinked();
      throw new Error("GitHub data operation failed. Check permissions and database migrations.");
    }
    return result.data;
  };
}

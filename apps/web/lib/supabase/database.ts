export type TenantRole = "owner" | "admin" | "developer" | "viewer";
export type ReviewDecision = "needs_review" | "reviewed";

type Table<Row> = { Row: Row; Insert: never; Update: never; Relationships: [] };
type Rpc<Args, Returns = string> = { Args: Args; Returns: Returns };

export interface Database {
  public: {
    Tables: {
      organizations: Table<{ id: string; name: string; created_at: string }>;
      github_connections: Table<{
        installation_id: number;
        organization_id: string;
        status: string;
      }>;
      github_jobs: Table<{
        id: string;
        organization_id: string;
        repository_id: string;
        pull_number: number;
        head_sha: string;
        status: string;
        check_id: number | null;
        check_state: string | null;
        check_error: string | null;
        check_conclusion: string | null;
        worker_release: string | null;
        attempts: number;
        error: string | null;
        scan_id: string | null;
        created_at: string;
      }>;
      github_repositories: Table<{
        repository_id: string;
        organization_id: string;
        installation_id: number;
        full_name: string;
        status: string;
        enabled: boolean;
        configuration: unknown;
      }>;
      organization_members: Table<{
        organization_id: string;
        user_id: string;
        role: TenantRole;
        created_at: string;
      }>;
      repositories: Table<{
        id: string;
        organization_id: string;
        name: string;
        created_at: string;
      }>;
      scans: Table<{
        id: string;
        organization_id: string;
        repository_id: string;
        created_at: string;
        status: string;
        finding_count: number;
        previous_sha: string;
        proposed_sha: string;
        report: unknown;
      }>;
      scan_reviews: Table<{
        organization_id: string;
        scan_id: string;
        decision: ReviewDecision;
        reviewer_id: string;
        reviewed_at: string;
      }>;
    };
    Views: Record<never, never>;
    Functions: {
      rollbackiq_github_service: Rpc<{ p_action: string; p_data: unknown }, unknown>;
      rollbackiq_github_worker: Rpc<{ p_action: string; p_data: unknown }, unknown>;
      rollbackiq_reserve_explanation: Rpc<
        { p_actor: string; p_user_limit: number; p_total_limit: number },
        boolean
      >;
      rollbackiq_create_organization: Rpc<{ p_name: string }>;
      rollbackiq_add_repository: Rpc<{ p_organization_id: string; p_name: string }>;
      rollbackiq_set_member: Rpc<
        { p_organization_id: string; p_user_id: string; p_role: Exclude<TenantRole, "owner"> },
        undefined
      >;
      rollbackiq_ingest_scan: Rpc<{
        p_repository_id: string;
        p_idempotency_key: string;
        p_report: unknown;
      }>;
      rollbackiq_review_scan: Rpc<{ p_scan_id: string; p_decision: ReviewDecision }, undefined>;
    };
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
  };
}

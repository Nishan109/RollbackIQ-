-- Client grants already deny access to this schema's storage. RLS also denies
-- access if a client grant is accidentally added later. Owner-executed server
-- RPCs retain access; these tables intentionally have no client policies.
alter table rollbackiq_private.github_states enable row level security;
alter table rollbackiq_private.github_choices enable row level security;
alter table rollbackiq_private.github_deliveries enable row level security;

-- Cover the foreign-key column order used by PostgreSQL's referential checks.
create index finding_evidence_finding_org_idx on public.finding_evidence(finding_id,organization_id);
create index github_connections_actor_idx on public.github_connections(connected_by);
create index github_jobs_repository_org_installation_idx on public.github_jobs(repository_id,organization_id,installation_id);
create index github_jobs_scan_idx on public.github_jobs(scan_id);
create index github_repositories_installation_org_idx on public.github_repositories(installation_id,organization_id);
create index releases_repository_org_idx on public.releases(repository_id,organization_id);
create index scan_coverage_scan_org_idx on public.scan_coverage(scan_id,organization_id);
create index scan_findings_scan_org_idx on public.scan_findings(scan_id,organization_id);
create index scan_reviews_scan_org_idx on public.scan_reviews(scan_id,organization_id);
create index scans_repository_org_idx on public.scans(repository_id,organization_id);
create index github_choices_actor_expiry_idx on rollbackiq_private.github_choices(actor_id,expires_at);
create index github_choices_organization_idx on rollbackiq_private.github_choices(organization_id);
create index github_states_actor_expiry_idx on rollbackiq_private.github_states(actor_id,expires_at);
create index github_states_organization_idx on rollbackiq_private.github_states(organization_id);

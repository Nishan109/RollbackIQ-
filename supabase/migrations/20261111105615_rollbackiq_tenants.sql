create schema rollbackiq_private;
revoke all on schema rollbackiq_private from public;
grant usage on schema rollbackiq_private to authenticated;

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 100),
  created_at timestamptz not null default now()
);

create table public.organization_members (
  organization_id uuid not null references public.organizations on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  role text not null check (role in ('owner', 'admin', 'developer', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);
create index organization_members_user_idx on public.organization_members (user_id, organization_id);

create table public.repositories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations on delete cascade,
  name text not null check (length(trim(name)) between 1 and 140),
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (organization_id, name)
);

create table public.releases (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  repository_id uuid not null,
  commit_sha text not null check (commit_sha ~ '^[a-f0-9]{40}$|^[a-f0-9]{64}$'),
  ref text not null check (length(ref) between 1 and 256),
  created_at timestamptz not null default now(),
  unique (id, repository_id, organization_id),
  unique (repository_id, commit_sha),
  foreign key (repository_id, organization_id) references public.repositories (id, organization_id) on delete cascade
);
create index releases_tenant_idx on public.releases (organization_id, repository_id);

create table public.scans (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  repository_id uuid not null,
  previous_release_id uuid not null,
  proposed_release_id uuid not null,
  previous_sha text not null,
  proposed_sha text not null,
  idempotency_key text not null check (idempotency_key ~ '^[a-f0-9]{64}$'),
  status text not null check (status in ('incompatible', 'potentially_incompatible', 'compatible_within_analyzed_scope', 'unknown')),
  finding_count integer not null check (finding_count >= 0),
  report jsonb not null check (octet_length(report::text) <= 2097152),
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  unique (id, organization_id),
  unique (repository_id, idempotency_key),
  foreign key (repository_id, organization_id) references public.repositories (id, organization_id) on delete cascade,
  foreign key (previous_release_id, repository_id, organization_id) references public.releases (id, repository_id, organization_id),
  foreign key (proposed_release_id, repository_id, organization_id) references public.releases (id, repository_id, organization_id)
);
create index scans_history_idx on public.scans (organization_id, repository_id, created_at desc, id desc);
create index scans_previous_release_idx on public.scans (previous_release_id, repository_id, organization_id);
create index scans_proposed_release_idx on public.scans (proposed_release_id, repository_id, organization_id);
create index scans_created_by_idx on public.scans (created_by);

create table public.scan_findings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  scan_id uuid not null,
  finding_key text not null check (length(finding_key) between 1 and 512),
  rule_id text not null check (rule_id ~ '^COMPAT00[1-9]$|^COMPAT010$'),
  severity text not null check (severity in ('critical', 'high', 'medium', 'low', 'info')),
  status text not null check (status in ('incompatible', 'potentially_incompatible', 'unknown')),
  confidence text not null check (confidence in ('high', 'medium', 'low')),
  object_name text,
  location jsonb,
  unique (scan_id, finding_key),
  unique (id, organization_id),
  foreign key (scan_id, organization_id) references public.scans (id, organization_id) on delete cascade
);
create index scan_findings_tenant_idx on public.scan_findings (organization_id, scan_id);

create table public.finding_evidence (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  finding_id uuid not null,
  release_side text not null check (release_side in ('previous', 'proposed')),
  source_path text not null check (length(source_path) between 1 and 512),
  source_line bigint not null check (source_line > 0),
  source_column bigint not null check (source_column > 0),
  evidence_kind text not null check (evidence_kind in ('static-sql-reference', 'prisma-reference')),
  foreign key (finding_id, organization_id) references public.scan_findings (id, organization_id) on delete cascade
);
create index finding_evidence_tenant_idx on public.finding_evidence (organization_id, finding_id);

create table public.scan_coverage (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  scan_id uuid not null,
  kind text not null,
  scope text not null,
  message text not null,
  location jsonb,
  foreign key (scan_id, organization_id) references public.scans (id, organization_id) on delete cascade
);
create index scan_coverage_tenant_idx on public.scan_coverage (organization_id, scan_id);

create table public.scan_reviews (
  organization_id uuid not null,
  scan_id uuid not null,
  reviewer_id uuid not null references auth.users on delete cascade,
  decision text not null check (decision in ('needs_review', 'reviewed')),
  reviewed_at timestamptz not null default clock_timestamp(),
  primary key (scan_id, reviewer_id),
  foreign key (scan_id, organization_id) references public.scans (id, organization_id) on delete cascade
);
create index scan_reviews_tenant_idx on public.scan_reviews (organization_id, scan_id, reviewed_at desc);
create index scan_reviews_reviewer_idx on public.scan_reviews (reviewer_id);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations on delete cascade,
  actor_id uuid references auth.users on delete set null,
  event_type text not null,
  resource_id uuid not null,
  created_at timestamptz not null default clock_timestamp()
);
create index audit_logs_tenant_idx on public.audit_logs (organization_id, created_at desc);
create index audit_logs_actor_idx on public.audit_logs (actor_id);

create function rollbackiq_private.actor() returns uuid
language sql stable set search_path = '' as $$
  select case when coalesce(auth.jwt()->>'is_anonymous', 'false') = 'true' then null else auth.uid() end
$$;

create function rollbackiq_private.member_role(p_org uuid) returns text
language sql stable security definer set search_path = '' as $$
  select role from public.organization_members
  where organization_id = p_org and user_id = (select rollbackiq_private.actor())
$$;

do $$
declare relation text;
begin
  foreach relation in array array['organizations','organization_members','repositories','releases','scans','scan_findings','finding_evidence','scan_coverage','scan_reviews','audit_logs'] loop
    execute format('alter table public.%I enable row level security', relation);
    execute format('revoke all on public.%I from public, anon, authenticated', relation);
    execute format('grant select on public.%I to authenticated', relation);
    if relation not in ('organizations','audit_logs') then
      execute format('create policy tenant_read on public.%I for select to authenticated using (rollbackiq_private.member_role(organization_id) is not null)', relation);
    end if;
  end loop;
end
$$;

create policy organization_read on public.organizations for select to authenticated
  using (rollbackiq_private.member_role(id) is not null);
create policy audit_read on public.audit_logs for select to authenticated
  using (rollbackiq_private.member_role(organization_id) in ('owner', 'admin'));

create function rollbackiq_private.create_organization(p_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare caller uuid := rollbackiq_private.actor(); organization uuid;
begin
  if caller is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  insert into public.organizations (name) values (trim(p_name)) returning id into organization;
  insert into public.organization_members (organization_id, user_id, role) values (organization, caller, 'owner');
  insert into public.audit_logs (organization_id, actor_id, event_type, resource_id) values (organization, caller, 'organization.created', organization);
  return organization;
end
$$;

create function rollbackiq_private.add_repository(p_organization_id uuid, p_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare repository uuid;
begin
  if coalesce(rollbackiq_private.member_role(p_organization_id), '') not in ('owner','admin') then
    raise exception 'Repository management requires owner or admin access' using errcode = '42501';
  end if;
  insert into public.repositories (organization_id, name) values (p_organization_id, trim(p_name)) returning id into repository;
  insert into public.audit_logs (organization_id, actor_id, event_type, resource_id) values (p_organization_id, rollbackiq_private.actor(), 'repository.created', repository);
  return repository;
end
$$;

create function rollbackiq_private.set_member(p_organization_id uuid, p_user_id uuid, p_role text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if rollbackiq_private.member_role(p_organization_id) is distinct from 'owner' then
    raise exception 'Membership management requires owner access' using errcode = '42501';
  end if;
  if p_role is null or p_role not in ('admin', 'developer', 'viewer') then raise exception 'Unsupported membership role' using errcode = '22023'; end if;
  insert into public.organization_members (organization_id, user_id, role) values (p_organization_id, p_user_id, p_role)
    on conflict (organization_id, user_id) do update set role = excluded.role where organization_members.role <> 'owner';
  if not found then raise exception 'The owner role cannot be changed here' using errcode = '42501'; end if;
  insert into public.audit_logs (organization_id, actor_id, event_type, resource_id) values (p_organization_id, rollbackiq_private.actor(), 'membership.updated', p_user_id);
end
$$;

create function rollbackiq_private.ingest_scan(p_repository_id uuid, p_idempotency_key text, p_report jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  organization uuid;
  caller uuid := rollbackiq_private.actor();
  previous text := p_report #>> '{previous,commit}';
  proposed text := p_report #>> '{proposed,commit}';
  previous_release uuid;
  proposed_release uuid;
  scan uuid;
  stored_report jsonb;
  finding jsonb;
  finding_uuid uuid;
begin
  select organization_id into organization from public.repositories where id = p_repository_id;
  if caller is null or coalesce(rollbackiq_private.member_role(organization), '') not in ('owner','admin','developer') then
    raise exception 'Repository write access required' using errcode = '42501';
  end if;
  if coalesce(p_report->>'kind','') <> 'release-compatibility' or p_report->>'schemaVersion' is distinct from '1'
    or octet_length(p_report::text) > 2097152
    or coalesce(previous,'') !~ '^[a-f0-9]{40}$|^[a-f0-9]{64}$'
    or coalesce(proposed,'') !~ '^[a-f0-9]{40}$|^[a-f0-9]{64}$'
    or jsonb_typeof(p_report->'findings') is distinct from 'array'
    or jsonb_typeof(p_report #> '{coverage,gaps}') is distinct from 'array' then
    raise exception 'Invalid compatibility report' using errcode = '22023';
  end if;

  insert into public.releases (organization_id, repository_id, commit_sha, ref)
    values (organization, p_repository_id, previous, p_report #>> '{previous,ref}'),
           (organization, p_repository_id, proposed, p_report #>> '{proposed,ref}')
    on conflict (repository_id, commit_sha) do nothing;
  select id into previous_release from public.releases where repository_id = p_repository_id and commit_sha = previous;
  select id into proposed_release from public.releases where repository_id = p_repository_id and commit_sha = proposed;

  insert into public.scans (organization_id, repository_id, previous_release_id, proposed_release_id, previous_sha, proposed_sha, idempotency_key, status, finding_count, report, created_by)
    values (organization, p_repository_id, previous_release, proposed_release, previous, proposed, p_idempotency_key, p_report->>'status', jsonb_array_length(p_report->'findings'), p_report, caller)
    on conflict (repository_id, idempotency_key) do nothing returning id into scan;
  if scan is null then
    select id, report into scan, stored_report from public.scans where repository_id = p_repository_id and idempotency_key = p_idempotency_key;
    if stored_report is distinct from p_report then raise exception 'Idempotency key conflicts with an existing scan' using errcode = '23505'; end if;
    return scan;
  end if;

  for finding in select value from jsonb_array_elements(p_report->'findings') loop
    insert into public.scan_findings (organization_id, scan_id, finding_key, rule_id, severity, status, confidence, object_name, location)
      values (organization, scan, finding->>'id', finding->>'ruleId', finding->>'severity', finding->>'status', finding->>'confidence', finding->>'object', finding->'location') returning id into finding_uuid;
    insert into public.finding_evidence (organization_id, finding_id, release_side, source_path, source_line, source_column, evidence_kind)
      select organization, finding_uuid, evidence.side, value #>> '{location,path}', (value #>> '{location,line}')::bigint, (value #>> '{location,column}')::bigint, value->>'kind'
      from (select 'previous' as side, value from jsonb_array_elements(finding->'previousEvidence')
        union all select 'proposed', value from jsonb_array_elements(finding->'proposedEvidence')) as evidence;
  end loop;

  insert into public.scan_coverage (organization_id, scan_id, kind, scope, message, location)
    select organization, scan, value->>'kind', value->>'scope', value->>'message', value->'location'
    from jsonb_array_elements(p_report #> '{coverage,gaps}');
  insert into public.audit_logs (organization_id, actor_id, event_type, resource_id) values (organization, caller, 'scan.imported', scan);
  return scan;
end
$$;

create function rollbackiq_private.review_scan(p_scan_id uuid, p_decision text) returns void
language plpgsql security definer set search_path = '' as $$
declare organization uuid;
begin
  select organization_id into organization from public.scans where id = p_scan_id;
  if coalesce(rollbackiq_private.member_role(organization), '') not in ('owner','admin','developer') then
    raise exception 'Scan review access required' using errcode = '42501';
  end if;
  insert into public.scan_reviews (organization_id, scan_id, reviewer_id, decision)
    values (organization, p_scan_id, rollbackiq_private.actor(), p_decision)
    on conflict (scan_id, reviewer_id) do update set decision = excluded.decision, reviewed_at = clock_timestamp();
  insert into public.audit_logs (organization_id, actor_id, event_type, resource_id) values (organization, rollbackiq_private.actor(), 'scan.reviewed', p_scan_id);
end
$$;

create function public.rollbackiq_create_organization(p_name text) returns uuid
language sql security invoker set search_path = '' as $$ select rollbackiq_private.create_organization(p_name) $$;
create function public.rollbackiq_add_repository(p_organization_id uuid, p_name text) returns uuid
language sql security invoker set search_path = '' as $$ select rollbackiq_private.add_repository(p_organization_id, p_name) $$;
create function public.rollbackiq_set_member(p_organization_id uuid, p_user_id uuid, p_role text) returns void
language sql security invoker set search_path = '' as $$ select rollbackiq_private.set_member(p_organization_id, p_user_id, p_role) $$;
create function public.rollbackiq_ingest_scan(p_repository_id uuid, p_idempotency_key text, p_report jsonb) returns uuid
language sql security invoker set search_path = '' as $$ select rollbackiq_private.ingest_scan(p_repository_id, p_idempotency_key, p_report) $$;
create function public.rollbackiq_review_scan(p_scan_id uuid, p_decision text) returns void
language sql security invoker set search_path = '' as $$ select rollbackiq_private.review_scan(p_scan_id, p_decision) $$;

revoke execute on all functions in schema rollbackiq_private from public, anon;
grant execute on all functions in schema rollbackiq_private to authenticated;
revoke execute on function public.rollbackiq_create_organization(text), public.rollbackiq_add_repository(uuid,text), public.rollbackiq_set_member(uuid,uuid,text), public.rollbackiq_ingest_scan(uuid,text,jsonb), public.rollbackiq_review_scan(uuid,text) from public, anon;
grant execute on function public.rollbackiq_create_organization(text), public.rollbackiq_add_repository(uuid,text), public.rollbackiq_set_member(uuid,uuid,text), public.rollbackiq_ingest_scan(uuid,text,jsonb), public.rollbackiq_review_scan(uuid,text) to authenticated;

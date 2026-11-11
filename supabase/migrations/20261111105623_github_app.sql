-- GitHub credentials stay in the server environment. No provider tokens are stored here.
create table public.github_connections (
  installation_id bigint primary key check (installation_id > 0),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  account_id bigint not null,
  account_login text not null,
  status text not null check (status in ('connected','suspended','revoked','disconnected','needs_refresh')),
  connected_by uuid not null references auth.users(id),
  synchronized_at timestamptz not null default now(),
  unique (installation_id, organization_id)
);
create table public.github_repositories (
  repository_id uuid primary key,
  organization_id uuid not null,
  installation_id bigint not null,
  github_id bigint not null unique check (github_id > 0),
  full_name text not null,
  status text not null check (status in ('connected','revoked','disconnected')),
  enabled boolean not null default false,
  configuration jsonb not null default '{}',
  synchronized_at timestamptz not null default now(),
  foreign key (repository_id, organization_id) references public.repositories(id,organization_id) on delete cascade,
  foreign key (installation_id, organization_id) references public.github_connections(installation_id,organization_id) on delete cascade,
  unique (repository_id, organization_id, installation_id)
);
create table public.github_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  repository_id uuid not null,
  installation_id bigint not null,
  pull_number integer not null check (pull_number > 0),
  head_sha text not null check (head_sha ~ '^[a-f0-9]{40}$'),
  configuration jsonb not null,
  status text not null default 'queued' check (status in ('queued','running','completed','failed','cancelled')),
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  lease_until timestamptz,
  lease_token uuid,
  check_id bigint,
  scan_id uuid references public.scans(id) on delete set null,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (repository_id,organization_id,installation_id) references public.github_repositories(repository_id,organization_id,installation_id) on update cascade on delete cascade,
  unique (repository_id,pull_number,head_sha)
);
create index github_jobs_ready on public.github_jobs(status,available_at);
create index github_connections_org on public.github_connections(organization_id);
create index github_repositories_org on public.github_repositories(organization_id,installation_id);
create index github_jobs_history on public.github_jobs(organization_id,repository_id,created_at desc);
create table rollbackiq_private.github_states (
  state_hash text primary key check (state_hash ~ '^[a-f0-9]{64}$'),
  actor_id uuid not null references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  phase text not null check (phase in ('install','oauth')),
  expires_at timestamptz not null default now() + interval '10 minutes'
);
create table rollbackiq_private.github_choices (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  payload jsonb not null,
  expires_at timestamptz not null default now() + interval '5 minutes'
);
create table rollbackiq_private.github_deliveries (
  delivery_id uuid primary key,
  event text not null,
  received_at timestamptz not null default now()
);

do $$ declare t text; begin
  foreach t in array array['github_connections','github_repositories','github_jobs'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated',t);
    execute format('grant select on public.%I to authenticated',t);
    execute format('create policy tenant_read on public.%I for select to authenticated using (rollbackiq_private.member_role(organization_id) is not null)',t);
  end loop;
end $$;
revoke all on rollbackiq_private.github_states,rollbackiq_private.github_choices,rollbackiq_private.github_deliveries from public,anon,authenticated;

-- Only the server's service-role client can invoke this RPC. User operations also
-- check the live membership of the authenticated actor passed by the server.
create function public.rollbackiq_github_service(p_action text, p_data jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := nullif(p_data->>'actor','')::uuid;
  org uuid := nullif(p_data->>'organization','')::uuid;
  state rollbackiq_private.github_states;
  choice rollbackiq_private.github_choices;
  job public.github_jobs;
  conn public.github_connections;
  repo public.github_repositories;
  item jsonb;
  installation bigint;
  local_id uuid;
  scan uuid;
  old_sub text;
  old_claims text;
begin
  if p_action = 'consume' then
    delete from rollbackiq_private.github_states where state_hash=p_data->>'hash'
      and actor_id=actor and phase=p_data->>'phase' and expires_at>now() returning * into state;
    if state.state_hash is null then raise exception 'Authorization expired or already used' using errcode='42501'; end if;
    org := state.organization_id;
  end if;
  if p_action in ('begin','consume','choices','dashboard','select','disconnect','configure') then
    if actor is null or not exists(select 1 from public.organization_members where organization_id=org and user_id=actor and role in ('owner','admin')) then
      raise exception 'Organization owner or admin access required' using errcode='42501';
    end if;
  end if;
  if p_action='begin' then
    delete from rollbackiq_private.github_states where actor_id=actor and expires_at<now();
    if (select count(*) from rollbackiq_private.github_states where actor_id=actor)>10 then raise exception 'Too many authorization attempts'; end if;
    insert into rollbackiq_private.github_states(state_hash,actor_id,organization_id,phase) values(p_data->>'hash',actor,org,p_data->>'phase');
    return jsonb_build_object('organization',org);
  elsif p_action='consume' then
    return jsonb_build_object('organization',org);
  elsif p_action='choices' then
    delete from rollbackiq_private.github_choices where actor_id=actor and organization_id=org;
    insert into rollbackiq_private.github_choices(actor_id,organization_id,payload) values(actor,org,p_data->'payload') returning id into local_id;
    return jsonb_build_object('id',local_id);
  elsif p_action='dashboard' then
    return jsonb_build_object(
      'choices',(select jsonb_build_object('id',id,'payload',payload) from rollbackiq_private.github_choices where actor_id=actor and organization_id=org and expires_at>now() limit 1),
      'connections',coalesce((select jsonb_agg(to_jsonb(c)) from public.github_connections c where organization_id=org),'[]'::jsonb),
      'repositories',coalesce((select jsonb_agg(to_jsonb(r)) from public.github_repositories r where organization_id=org),'[]'::jsonb));
  elsif p_action='select' then
    select * into choice from rollbackiq_private.github_choices where id=(p_data->>'choice')::uuid and actor_id=actor and organization_id=org and expires_at>now() for update;
    if choice.id is null then raise exception 'Repository selection expired' using errcode='42501'; end if;
    installation := (choice.payload #>> '{installation,id}')::bigint;
    perform pg_advisory_xact_lock(installation);
    if exists(select 1 from public.github_connections where installation_id=installation and organization_id<>org) then raise exception 'Installation is already associated' using errcode='42501'; end if;
    if jsonb_array_length(p_data->'repositories') not between 1 and 100 then raise exception 'Select 1 to 100 repositories'; end if;
    insert into public.github_connections(installation_id,organization_id,account_id,account_login,status,connected_by)
      values(installation,org,(choice.payload #>> '{installation,account,id}')::bigint,choice.payload #>> '{installation,account,login}','connected',actor)
      on conflict(installation_id) do update set status='connected',connected_by=actor,account_login=excluded.account_login,synchronized_at=now();
    for item in select value from jsonb_array_elements(p_data->'repositories') loop
      if not exists(select 1 from jsonb_array_elements(choice.payload->'repositories') r where r->>'id'=item#>>'{}') then raise exception 'Repository was not authorized' using errcode='42501'; end if;
      select value into item from jsonb_array_elements(choice.payload->'repositories') r where r->>'id'=item#>>'{}';
      select repository_id into local_id from public.github_repositories where github_id=(item->>'id')::bigint and organization_id=org;
      if local_id is null then
        select id into local_id from public.repositories r where r.organization_id=org and r.name=item->>'full_name'
          and not exists(select 1 from public.github_repositories g where g.repository_id=r.id);
      end if;
      if local_id is null then insert into public.repositories(organization_id,name) values(org,item->>'full_name') returning id into local_id; end if;
      insert into public.github_repositories(repository_id,organization_id,installation_id,github_id,full_name,status)
        values(local_id,org,installation,(item->>'id')::bigint,item->>'full_name','connected')
        on conflict(repository_id) do update set status='connected',installation_id=excluded.installation_id,full_name=excluded.full_name,synchronized_at=now();
    end loop;
    delete from rollbackiq_private.github_choices where id=choice.id;
    insert into public.audit_logs(organization_id,actor_id,event_type,resource_id) values(org,actor,'github.connected',org);
    return '{}';
  elsif p_action='disconnect' then
    update public.github_repositories set status='disconnected',enabled=false where organization_id=org
      and (not p_data ? 'repository' or repository_id=(p_data->>'repository')::uuid);
    if not p_data ? 'repository' then update public.github_connections set status='disconnected' where organization_id=org; end if;
    update public.github_jobs set status='cancelled',error='Connection disconnected',updated_at=now() where organization_id=org and status in ('queued','running')
      and (not p_data ? 'repository' or repository_id=(p_data->>'repository')::uuid);
    insert into public.audit_logs(organization_id,actor_id,event_type,resource_id) values(org,actor,'github.disconnected',org);
    return '{}';
  elsif p_action='configure' then
    update public.github_repositories set configuration=p_data->'configuration',enabled=(p_data->>'enabled')::boolean
      where repository_id=(p_data->>'repository')::uuid and organization_id=org;
    if not found then raise exception 'Repository unavailable' using errcode='42501'; end if;
    if not (p_data->>'enabled')::boolean then
      update public.github_jobs set status='cancelled',error='Automatic scanning disabled',updated_at=now() where repository_id=(p_data->>'repository')::uuid and status in ('queued','running');
    end if;
    insert into public.audit_logs(organization_id,actor_id,event_type,resource_id) values(org,actor,'github.configured',(p_data->>'repository')::uuid);
    return '{}';
  elsif p_action='webhook' then
    insert into rollbackiq_private.github_deliveries(delivery_id,event) values((p_data->>'delivery')::uuid,p_data->>'event') on conflict do nothing;
    if not found then return jsonb_build_object('duplicate',true); end if;
    installation := (p_data #>> '{payload,installation,id}')::bigint;
    perform pg_advisory_xact_lock(installation);
    select * into conn from public.github_connections where installation_id=installation for update;
    if conn.installation_id is null then return '{}'; end if;
    if p_data->>'event'='installation' then
      if p_data #>> '{payload,action}' in ('deleted','suspend') then
        update public.github_connections set status=case when p_data #>> '{payload,action}'='deleted' then 'revoked' else 'suspended' end where installation_id=installation;
        if p_data #>> '{payload,action}'='deleted' then
          update public.github_repositories set status='revoked',enabled=false where installation_id=installation;
        end if;
        update public.github_jobs set status='cancelled',error='Installation access unavailable',updated_at=now() where installation_id=installation and status in ('queued','running');
      elsif p_data #>> '{payload,action}' in ('unsuspend','new_permissions_accepted') and conn.status<>'disconnected' then
        update public.github_connections set status='needs_refresh' where installation_id=installation;
      end if;
    elsif p_data->>'event'='installation_repositories' then
      update public.github_repositories set status='revoked',enabled=false where installation_id=installation
        and github_id in(select (value->>'id')::bigint from jsonb_array_elements(coalesce(p_data #> '{payload,repositories_removed}','[]')));
      update public.github_jobs set status='cancelled',error='Repository access removed',updated_at=now() where installation_id=installation and status in ('queued','running')
        and repository_id in(select repository_id from public.github_repositories where installation_id=installation and status<>'connected');
    elsif p_data->>'event'='repository' then
      update public.github_repositories set full_name=p_data #>> '{payload,repository,full_name}',synchronized_at=now(),
        status=case when p_data #>> '{payload,action}' in ('deleted','transferred','archived') then 'revoked' else status end,
        enabled=case when p_data #>> '{payload,action}' in ('deleted','transferred','archived') then false else enabled end
        where github_id=(p_data #>> '{payload,repository,id}')::bigint and installation_id=installation;
    elsif p_data->>'event'='pull_request' and p_data #>> '{payload,action}' in ('opened','synchronize','reopened','ready_for_review') and conn.status='connected' then
      select * into repo from public.github_repositories where installation_id=installation and github_id=(p_data #>> '{payload,repository,id}')::bigint and status='connected' and enabled for update;
      if repo.repository_id is not null then
        -- A duplicate older delivery cannot cancel a newer job. The worker also
        -- checks the actual current PR head before analysis and publication.
        insert into public.github_jobs(organization_id,repository_id,installation_id,pull_number,head_sha,configuration)
          values(repo.organization_id,repo.repository_id,installation,(p_data #>> '{payload,pull_request,number}')::integer,p_data #>> '{payload,pull_request,head,sha}',repo.configuration)
          on conflict(repository_id,pull_number,head_sha) do nothing;
      end if;
    end if;
    insert into public.audit_logs(organization_id,actor_id,event_type,resource_id) values(conn.organization_id,conn.connected_by,'github.'||(p_data->>'event'),conn.organization_id);
    return '{}';
  elsif p_action='claim' then
    update public.github_jobs set status='failed',error='Worker retry limit reached',updated_at=now() where status='running' and lease_until<now() and attempts>=3;
    select j.* into job from public.github_jobs j join public.github_repositories r using(repository_id)
      join public.github_connections c on c.installation_id=j.installation_id
      where ((j.status='queued' and j.available_at<=now()) or (j.status='running' and j.lease_until<now()))
      and j.attempts<3 and r.enabled and r.status='connected' and c.status='connected'
      order by j.created_at for update of j skip locked limit 1;
    if job.id is null then return 'null'; end if;
    update public.github_jobs set status='running',attempts=attempts+1,lease_until=now()+interval '5 minutes',lease_token=gen_random_uuid(),updated_at=now() where id=job.id returning * into job;
    select * into repo from public.github_repositories where repository_id=job.repository_id;
    return to_jsonb(job)||jsonb_build_object('github_id',repo.github_id,'full_name',repo.full_name);
  elsif p_action in ('checkpoint','finish','fail','save','report') then
    select * into job from public.github_jobs where id=(p_data->>'job')::uuid and lease_token=(p_data->>'lease')::uuid and status='running' and lease_until>now() for update;
    if job.id is null then raise exception 'Worker lease expired or cancelled' using errcode='42501'; end if;
    if p_action<>'fail' and not exists(select 1 from public.github_repositories r join public.github_connections c using(installation_id)
      where r.repository_id=job.repository_id and r.status='connected' and r.enabled and c.status='connected') then raise exception 'Connection unavailable' using errcode='42501'; end if;
    if p_action='report' then
      return (select report from public.scans where id=job.scan_id and repository_id=job.repository_id and organization_id=job.organization_id);
    elsif p_action='checkpoint' then
      update public.github_jobs set check_id=(p_data->>'check')::bigint where id=job.id;
    elsif p_action='fail' then
      update public.github_jobs set status=case when coalesce((p_data->>'cancelled')::boolean,false) then 'cancelled' when attempts>=3 then 'failed' else 'queued' end,
        error=left(p_data->>'error',300),available_at=now()+interval '30 seconds'*attempts,updated_at=now() where id=job.id;
    elsif p_action='save' then
      if p_data #>> '{report,proposed,commit}' is distinct from job.head_sha then raise exception 'Report does not match job commit' using errcode='22023'; end if;
      if not exists(select 1 from public.github_repositories r join public.github_connections c using(installation_id)
        where r.repository_id=job.repository_id and r.status='connected' and r.enabled and c.status='connected') then raise exception 'Connection unavailable' using errcode='42501'; end if;
      select * into conn from public.github_connections where installation_id=job.installation_id;
      old_sub := current_setting('request.jwt.claim.sub',true); old_claims := current_setting('request.jwt.claims',true);
      perform set_config('request.jwt.claim.sub',conn.connected_by::text,true);
      perform set_config('request.jwt.claims','{"is_anonymous":false}',true);
      scan := rollbackiq_private.ingest_scan(job.repository_id,encode(sha256(convert_to('github:'||job.id::text,'UTF8')),'hex'),p_data->'report');
      perform set_config('request.jwt.claim.sub',coalesce(old_sub,''),true);
      perform set_config('request.jwt.claims',coalesce(old_claims,''),true);
      update public.github_jobs set scan_id=scan,updated_at=now() where id=job.id;
      return jsonb_build_object('scan',scan);
    elsif p_action='finish' then
      if job.scan_id is null then raise exception 'A completed job requires a saved report' using errcode='22023'; end if;
      update public.github_jobs set status='completed',error=null,updated_at=now() where id=job.id;
    end if;
    return '{}';
  end if;
  raise exception 'Unsupported GitHub operation' using errcode='22023';
end $$;
revoke all on function public.rollbackiq_github_service(text,jsonb) from public,anon,authenticated;
grant execute on function public.rollbackiq_github_service(text,jsonb) to service_role;

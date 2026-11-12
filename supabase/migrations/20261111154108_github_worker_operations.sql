-- Additive fields. Existing reports and the original web RPC remain readable.
alter table public.github_jobs
  add column check_state text check (check_state in ('disabled','pending','in_progress','published','blocked','failed')),
  add column check_error text check (char_length(check_error)<=64),
  add column check_conclusion text check (check_conclusion in ('success','failure','action_required','neutral','cancelled','timed_out')),
  add column worker_release text check (worker_release ~ '^[0-9a-f]{40}$');

create function public.rollbackiq_github_worker(p_action text, p_data jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  job public.github_jobs;
  claimed jsonb;
  retry boolean;
  cancelled boolean;
  terminal boolean;
begin
  if p_action='health' then
    return jsonb_build_object('protocol',2);
  elsif p_action='claim' then
    -- Finalize exhausted leases before the legacy claim path can classify a
    -- saved report as an analysis failure.
    update public.github_jobs set
      status=case when scan_id is null then 'failed' else 'completed' end,
      error=case when scan_id is null then 'Worker retry limit reached' end,
      check_state=case when check_state in ('pending','in_progress') then 'failed' else check_state end,
      check_error=case when check_state in ('pending','in_progress') then 'lease_exhausted' else check_error end,
      updated_at=now()
      where status='running' and lease_until<=now() and attempts>=3;
    claimed := public.rollbackiq_github_service('claim','{}'::jsonb);
    if claimed is null or claimed='null'::jsonb then return 'null'::jsonb; end if;
    update public.github_jobs set worker_release=p_data->>'release',
      check_state=coalesce(check_state,case when configuration->>'publishChecks'='false' then 'disabled' else 'pending' end)
      where id=(claimed->>'id')::uuid returning * into job;
    return claimed||jsonb_build_object('check_state',job.check_state,'check_error',job.check_error,
      'check_conclusion',job.check_conclusion,'worker_release',job.worker_release);
  elsif p_action not in ('renew','checkpoint','finish','fail','save','report') then
    raise exception 'Unsupported worker operation' using errcode='22023';
  end if;

  select * into job from public.github_jobs
    where id=(p_data->>'job')::uuid and lease_token=(p_data->>'lease')::uuid
      and status='running' and lease_until>clock_timestamp() for update;
  if job.id is null then raise exception 'Worker lease expired or cancelled' using errcode='42501'; end if;
  if p_action<>'fail' and not exists (
    select 1 from public.github_repositories r join public.github_connections c using(installation_id)
    where r.repository_id=job.repository_id and r.organization_id=job.organization_id
      and c.organization_id=job.organization_id and r.installation_id=job.installation_id
      and r.enabled and r.status='connected' and c.status='connected'
  ) then raise exception 'Connection unavailable' using errcode='42501'; end if;

  if p_action='renew' then
    update public.github_jobs set lease_until=clock_timestamp()+interval '5 minutes',updated_at=now() where id=job.id;
  elsif p_action='checkpoint' then
    update public.github_jobs set check_id=coalesce((p_data->>'check')::bigint,check_id),
      check_state=p_data->>'state',check_error=p_data->>'reason',check_conclusion=p_data->>'conclusion',updated_at=now()
      where id=job.id;
  elsif p_action='fail' then
    retry := coalesce((p_data->>'retry')::boolean,true) and job.attempts<3;
    cancelled := coalesce((p_data->>'cancelled')::boolean,false);
    terminal := not retry or cancelled;
    update public.github_jobs set
      status=case when cancelled then 'cancelled' when retry then 'queued'
        when scan_id is not null then 'completed' else 'failed' end,
      error=case when scan_id is null or cancelled then left(p_data->>'error',300) end,
      check_state=coalesce(p_data->>'state',check_state),
      check_error=coalesce(p_data->>'reason',check_error),
      check_conclusion=coalesce(p_data->>'conclusion',check_conclusion),
      available_at=case when terminal then available_at else
        now()+make_interval(secs=>greatest(30*power(2,greatest(attempts-1,0)),
          least(3600,greatest(0,coalesce((p_data->>'retryAfter')::integer,0))))) end,
      lease_token=null,lease_until=null,updated_at=now()
      where id=job.id;
  else
    return public.rollbackiq_github_service(p_action,p_data);
  end if;
  return '{}'::jsonb;
end $$;

revoke all on function public.rollbackiq_github_worker(text,jsonb) from public,anon,authenticated;
grant execute on function public.rollbackiq_github_worker(text,jsonb) to service_role;

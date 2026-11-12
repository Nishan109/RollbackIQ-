create table rollbackiq_private.gemini_usage (
  day date not null,
  bucket text not null,
  used integer not null check (used>0),
  primary key(day,bucket)
);
alter table rollbackiq_private.gemini_usage enable row level security;
revoke all on rollbackiq_private.gemini_usage from public,anon,authenticated;

create function public.rollbackiq_reserve_explanation(p_actor uuid,p_user_limit integer,p_total_limit integer)
returns boolean language plpgsql security definer set search_path='' as $$
declare
  usage_day date := (now() at time zone 'UTC')::date;
  global_used integer;
  actor_used integer;
begin
  if p_actor is null or p_user_limit is null or p_total_limit is null
    or p_user_limit not between 1 and 1000 or p_total_limit not between 1 and 10000
    or not exists (select 1 from auth.users where id=p_actor)
    then raise exception 'Invalid explanation reservation' using errcode='22023';
  end if;

  -- Serialize reservations across app instances for this UTC day.
  perform pg_advisory_xact_lock(1734853993,usage_day - date '2000-01-01');
  select used into global_used from rollbackiq_private.gemini_usage where day=usage_day and bucket='global';
  select used into actor_used from rollbackiq_private.gemini_usage where day=usage_day and bucket=p_actor::text;
  if coalesce(global_used,0)>=p_total_limit or coalesce(actor_used,0)>=p_user_limit then return false; end if;
  insert into rollbackiq_private.gemini_usage as u(day,bucket,used)
    values(usage_day,'global',1),(usage_day,p_actor::text,1)
    on conflict(day,bucket) do update set used=u.used+1;
  if global_used is null then
    delete from rollbackiq_private.gemini_usage where day<usage_day-30;
  end if;
  return true;
end $$;

revoke all on function public.rollbackiq_reserve_explanation(uuid,integer,integer) from public,anon,authenticated;
grant execute on function public.rollbackiq_reserve_explanation(uuid,integer,integer) to service_role;

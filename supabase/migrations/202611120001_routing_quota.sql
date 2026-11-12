-- Optional, NOT applied automatically. Global rolling reservations BEFORE provider calls.
create table if not exists public.routing_call_reservations (
  id bigint generated always as identity primary key,
  caller uuid not null,
  reserved_at timestamptz not null default clock_timestamp()
);
create index if not exists routing_reservations_time on public.routing_call_reservations(reserved_at);
alter table public.routing_call_reservations enable row level security;
revoke all on public.routing_call_reservations from public, anon, authenticated;
create or replace function public.reserve_routing_call(caller uuid) returns boolean
language plpgsql security definer set search_path = pg_catalog, public as $$
declare instant timestamptz;
begin
  perform pg_advisory_xact_lock(21120261112);
  instant := clock_timestamp();
  delete from public.routing_call_reservations where reserved_at < instant - interval '24 hours';
  if (select count(*) from public.routing_call_reservations where reserved_at >= instant - interval '1 minute') >= 30
    or (select count(*) from public.routing_call_reservations) >= 1800
    or (select count(*) from public.routing_call_reservations r where r.caller = reserve_routing_call.caller) >= 300
  then return false; end if;
  insert into public.routing_call_reservations(caller, reserved_at) values (reserve_routing_call.caller, instant);
  return true;
end;
$$;
revoke all on function public.reserve_routing_call(uuid) from public, anon, authenticated;
grant execute on function public.reserve_routing_call(uuid) to service_role;

create table if not exists public.cron_refresh_state (
  job_name text primary key,
  phase text not null default 'active' check (phase in ('active', 'archived')),
  active_offset text null,
  archived_offset text null,
  updated_at timestamptz not null default now()
);

alter table public.cron_refresh_state enable row level security;

drop policy if exists cron_refresh_state_service_role_all on public.cron_refresh_state;
create policy cron_refresh_state_service_role_all
on public.cron_refresh_state
for all
to service_role
using (true)
with check (true);

grant all on table public.cron_refresh_state to service_role;
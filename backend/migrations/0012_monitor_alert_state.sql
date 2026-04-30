create table if not exists public.monitor_alert_state (
  check_name text primary key,
  last_status text not null default 'ok' check (last_status in ('ok', 'alert')),
  last_summary text null,
  last_alert_sent_at timestamptz null,
  last_evaluated_at timestamptz not null default now()
);

alter table public.monitor_alert_state enable row level security;

drop policy if exists monitor_alert_state_service_role_all on public.monitor_alert_state;
create policy monitor_alert_state_service_role_all
on public.monitor_alert_state
for all
to service_role
using (true)
with check (true);

grant all on table public.monitor_alert_state to service_role;
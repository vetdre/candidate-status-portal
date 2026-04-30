begin;

alter table if exists public.interview_events_raw enable row level security;

drop policy if exists interview_events_raw_service_role_all on public.interview_events_raw;
create policy interview_events_raw_service_role_all
on public.interview_events_raw
for all
to service_role
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

commit;

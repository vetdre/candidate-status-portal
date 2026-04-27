begin;

-- people
drop policy if exists people_service_role_all on public.people;
create policy people_service_role_all
on public.people
for all
to service_role
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

-- applications
drop policy if exists applications_service_role_all on public.applications;
create policy applications_service_role_all
on public.applications
for all
to service_role
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

-- interviews
drop policy if exists interviews_service_role_all on public.interviews;
create policy interviews_service_role_all
on public.interviews
for all
to service_role
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

-- ingest_events
drop policy if exists ingest_events_service_role_all on public.ingest_events;
create policy ingest_events_service_role_all
on public.ingest_events
for all
to service_role
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

-- Candidates_shadow
drop policy if exists candidates_shadow_service_role_all on public."Candidates_shadow";
create policy candidates_shadow_service_role_all
on public."Candidates_shadow"
for all
to service_role
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

-- parity_runs
drop policy if exists parity_runs_service_role_all on public.parity_runs;
create policy parity_runs_service_role_all
on public.parity_runs
for all
to service_role
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

-- parity_mismatches
drop policy if exists parity_mismatches_service_role_all on public.parity_mismatches;
create policy parity_mismatches_service_role_all
on public.parity_mismatches
for all
to service_role
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

-- existing lookup attempts table: keep locked to service role only
drop policy if exists portal_lookup_attempts_service_role_all on public.portal_lookup_attempts;
create policy portal_lookup_attempts_service_role_all
on public.portal_lookup_attempts
for all
to service_role
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

commit;

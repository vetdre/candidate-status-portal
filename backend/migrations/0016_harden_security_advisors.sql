begin;

-- 1) Remove overly permissive public/anon write policies on legacy Candidates table.
alter table if exists public."Candidates" enable row level security;

drop policy if exists "allow anon update" on public."Candidates";
drop policy if exists anon_insert_candidates on public."Candidates";

drop policy if exists candidates_service_role_all on public."Candidates";
create policy candidates_service_role_all
on public."Candidates"
for all
to service_role
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

-- 2) Fix mutable search_path warnings on trigger/helper functions.
alter function public.fn_candidates_set_portal_fields() set search_path = public;
alter function public.fn_resolve_portal_stage(text, boolean, text) set search_path = public;

-- 3) Restrict SECURITY DEFINER RPC execution to service_role only.
revoke all on function public.portal_track_view(text) from anon;
revoke all on function public.portal_track_view(text) from authenticated;
grant execute on function public.portal_track_view(text) to service_role;

commit;

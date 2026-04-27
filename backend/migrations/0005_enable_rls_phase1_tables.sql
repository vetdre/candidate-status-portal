begin;

alter table if exists public.people enable row level security;
alter table if exists public.applications enable row level security;
alter table if exists public.interviews enable row level security;
alter table if exists public.ingest_events enable row level security;
alter table if exists public."Candidates_shadow" enable row level security;
alter table if exists public.parity_runs enable row level security;
alter table if exists public.parity_mismatches enable row level security;

commit;

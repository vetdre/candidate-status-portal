-- Daily parity gate checks for phase-1 archive + interviews slice.
-- Compare source: public."Candidates"
-- Compare target: public."Candidates_shadow"

-- 1) Create a parity run row and capture run id.
insert into parity_runs(slice, notes)
values ('archive_interviews_v1', 'daily scheduled parity run')
returning id;

-- 2) Field-level diff extraction with severity classification.
with base as (
  select
    c.lever_id,
    c.archived as old_archived,
    s.archived as new_archived,
    nullif(lower(trim(coalesce(c.archive_reason, ''))), '') as old_archive_reason,
    nullif(lower(trim(coalesce(s.archive_reason, ''))), '') as new_archive_reason,
    c.next_interview as old_next_interview,
    s.next_interview as new_next_interview,
    c.portal_stage_order as old_portal_stage_order,
    s.portal_stage_order as new_portal_stage_order,
    c.portal_stage_terminal as old_portal_stage_terminal,
    s.portal_stage_terminal as new_portal_stage_terminal,
    nullif(lower(trim(coalesce(c.portal_stage, ''))), '') as old_portal_stage,
    nullif(lower(trim(coalesce(s.portal_stage, ''))), '') as new_portal_stage,
    nullif(lower(trim(coalesce(c.current_stage, ''))), '') as old_current_stage,
    nullif(lower(trim(coalesce(s.current_stage, ''))), '') as new_current_stage,
    c.stage_updated as old_stage_updated,
    s.stage_updated as new_stage_updated
  from "Candidates" c
  join "Candidates_shadow" s on s.lever_id = c.lever_id
), diffs as (
  select lever_id, 'archived'::text as field_name, 'blocking'::text as severity,
         old_archived::text as old_value, new_archived::text as new_value
  from base where old_archived is distinct from new_archived

  union all
  select lever_id, 'archive_reason', 'blocking', old_archive_reason, new_archive_reason
  from base where old_archive_reason is distinct from new_archive_reason

  union all
  select lever_id, 'next_interview', 'blocking', old_next_interview::text, new_next_interview::text
  from base
  where not (
    old_next_interview is null and new_next_interview is null
  )
  and (
    old_next_interview is null
    or new_next_interview is null
    or abs(extract(epoch from (old_next_interview - new_next_interview))) > 60
  )

  union all
  select lever_id, 'portal_stage_order', 'blocking', old_portal_stage_order::text, new_portal_stage_order::text
  from base where old_portal_stage_order is distinct from new_portal_stage_order

  union all
  select lever_id, 'portal_stage_terminal', 'blocking', old_portal_stage_terminal::text, new_portal_stage_terminal::text
  from base where old_portal_stage_terminal is distinct from new_portal_stage_terminal

  union all
  select lever_id, 'portal_stage', 'warning', old_portal_stage, new_portal_stage
  from base where old_portal_stage is distinct from new_portal_stage

  union all
  select lever_id, 'current_stage', 'warning', old_current_stage, new_current_stage
  from base where old_current_stage is distinct from new_current_stage

  union all
  select lever_id, 'stage_updated', 'warning', old_stage_updated::text, new_stage_updated::text
  from base
  where not (
    old_stage_updated is null and new_stage_updated is null
  )
  and (
    old_stage_updated is null
    or new_stage_updated is null
    or abs(extract(epoch from (old_stage_updated - new_stage_updated))) > 300
  )
)
insert into parity_mismatches(
  parity_run_id,
  lever_id,
  field_name,
  severity,
  old_value,
  new_value,
  normalized_old,
  normalized_new
)
select
  :parity_run_id,
  d.lever_id,
  d.field_name,
  d.severity,
  d.old_value,
  d.new_value,
  d.old_value,
  d.new_value
from diffs d;

-- 3) Aggregate run result and compute pass/fail.
with compared as (
  select count(*)::int as compared_rows
  from "Candidates" c
  join "Candidates_shadow" s on s.lever_id = c.lever_id
), counts as (
  select
    count(*) filter (where severity = 'blocking')::int as blocking_mismatches,
    count(*) filter (where severity = 'warning')::int as warning_mismatches
  from parity_mismatches
  where parity_run_id = :parity_run_id
)
update parity_runs r
set
  finished_at = now(),
  compared_rows = compared.compared_rows,
  blocking_mismatches = counts.blocking_mismatches,
  warning_mismatches = counts.warning_mismatches,
  pass = (
    compared.compared_rows > 0
    and counts.blocking_mismatches <= 5
    and (counts.blocking_mismatches::numeric / compared.compared_rows::numeric) <= 0.005
  )
from compared, counts
where r.id = :parity_run_id;

-- 4) Daily gate summary.
select
  id,
  slice,
  started_at,
  finished_at,
  compared_rows,
  blocking_mismatches,
  warning_mismatches,
  pass
from parity_runs
where id = :parity_run_id;

-- 5) Top mismatch classes for triage.
select
  field_name,
  severity,
  count(*) as mismatch_count
from parity_mismatches
where parity_run_id = :parity_run_id
group by field_name, severity
order by severity, mismatch_count desc;

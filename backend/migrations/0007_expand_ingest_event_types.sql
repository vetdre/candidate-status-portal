begin;

alter table if exists public.ingest_events
  drop constraint if exists ingest_events_event_type_chk;

alter table if exists public.ingest_events
  add constraint ingest_events_event_type_chk
  check (
    event_type in (
      'archive_state_change',
      'interviews',
      'application_created',
      'candidate_stage_change'
    )
  );

commit;

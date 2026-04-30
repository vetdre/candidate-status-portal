begin;

create table if not exists interview_events_raw (
  id bigserial primary key,
  lever_opportunity_id text not null,
  lever_candidate_id text,
  lever_interview_id text,
  interview_at timestamptz,
  canceled_at timestamptz,
  source_event_id text,
  payload jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (lever_opportunity_id, lever_interview_id)
);

create index if not exists idx_interview_events_raw_opportunity on interview_events_raw(lever_opportunity_id);
create index if not exists idx_interview_events_raw_interview_at on interview_events_raw(interview_at);

comment on table interview_events_raw is 'Raw interview snapshot per opportunity from Lever webhook events; independent of normalized people/applications FKs.';

commit;

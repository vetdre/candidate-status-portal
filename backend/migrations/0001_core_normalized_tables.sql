begin;

create table if not exists people (
  person_key text primary key,
  primary_email text,
  primary_phone10 text,
  application_last_name_norm text,
  application_phone10 text,
  magic_token_current text,
  identity_confidence smallint not null default 1 check (identity_confidence between 1 and 3),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table people is 'Normalized person identity table. Phase 1 portal authentication remains compatibility-model authoritative.';

create table if not exists applications (
  lever_opportunity_id text primary key,
  person_key text not null references people(person_key),
  candidate_name text,
  position text,
  current_stage text,
  archived boolean not null default false,
  archive_reason text,
  portal_stage text,
  portal_stage_order smallint,
  portal_stage_terminal boolean,
  next_interview timestamptz,
  stage_updated timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_applications_person_key on applications(person_key);
create index if not exists idx_applications_stage_updated on applications(stage_updated desc);

create table if not exists interviews (
  id bigserial primary key,
  lever_interview_id text,
  lever_opportunity_id text not null references applications(lever_opportunity_id) on delete cascade,
  interview_at timestamptz,
  canceled_at timestamptz,
  source_event_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (lever_interview_id, lever_opportunity_id)
);

create index if not exists idx_interviews_opportunity_time on interviews(lever_opportunity_id, interview_at);

commit;

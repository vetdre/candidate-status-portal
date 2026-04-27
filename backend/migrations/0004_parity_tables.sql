begin;

create table if not exists parity_runs (
  id bigserial primary key,
  slice text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  compared_rows integer not null default 0,
  blocking_mismatches integer not null default 0,
  warning_mismatches integer not null default 0,
  pass boolean,
  notes text
);

create table if not exists parity_mismatches (
  id bigserial primary key,
  parity_run_id bigint not null references parity_runs(id) on delete cascade,
  lever_id text,
  field_name text not null,
  severity text not null,
  old_value text,
  new_value text,
  normalized_old text,
  normalized_new text,
  detected_at timestamptz not null default now(),
  constraint parity_mismatches_severity_chk
    check (severity in ('blocking', 'warning'))
);

create index if not exists idx_parity_runs_started_at on parity_runs(started_at desc);
create index if not exists idx_parity_mismatches_run on parity_mismatches(parity_run_id);
create index if not exists idx_parity_mismatches_severity_field on parity_mismatches(severity, field_name);

commit;

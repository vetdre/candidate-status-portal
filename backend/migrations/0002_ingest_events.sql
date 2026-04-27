begin;

create table if not exists ingest_events (
  id bigserial primary key,
  source text not null,
  event_type text not null,
  event_id text,
  dedupe_key text not null,
  signature_valid boolean not null,
  payload jsonb not null,
  headers jsonb,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  process_status text not null default 'received',
  process_error text,
  constraint ingest_events_event_type_chk
    check (event_type in ('archive_state_change', 'interviews')),
  constraint ingest_events_process_status_chk
    check (process_status in ('received', 'processed', 'failed', 'ignored_duplicate'))
);

create unique index if not exists uq_ingest_events_dedupe on ingest_events(dedupe_key);
create index if not exists idx_ingest_events_event_id on ingest_events(event_id);
create index if not exists idx_ingest_events_status_received_at on ingest_events(process_status, received_at);

comment on table ingest_events is 'Raw webhook event log with deterministic dedupe keys for replay and idempotency.';

commit;

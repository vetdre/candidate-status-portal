alter table public."Candidates_shadow"
  add column if not exists invite_sent_at timestamptz;
alter table public.cron_refresh_state
  add column if not exists last_run_at timestamptz null,
  add column if not exists last_success_at timestamptz null,
  add column if not exists last_status text null,
  add column if not exists last_error text null;

update public.cron_refresh_state
set
  last_run_at = coalesce(last_run_at, updated_at),
  last_success_at = coalesce(last_success_at, updated_at),
  last_status = coalesce(last_status, 'ok')
where job_name = 'candidates_shadow_refresh';

alter table public.cron_refresh_state
  drop constraint if exists cron_refresh_state_last_status_check;

alter table public.cron_refresh_state
  add constraint cron_refresh_state_last_status_check
  check (last_status is null or last_status in ('running', 'ok', 'error'));

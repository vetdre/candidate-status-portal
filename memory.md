# Memory Log

## 2026-04-23
- Established a blocking project workflow rule: after every change, update memory.md, changes.md, and fixhistory.md before considering the task complete.
- This rule applies to code changes, migrations, fixes, and documentation-only updates.
- On compacted conversations, reference memory.md, changes.md, and fixhistory.md immediately before doing any other task work.

## 2026-04-27
- Added missing Vercel webhook routes for application-created and candidate-stage-change to provide concrete Lever callback URLs.
- Expanded ingest event type constraints so new webhook routes can write ingest_events without runtime constraint failures.
- Lever webhook verification must use HMAC-SHA256 over token+triggeredAt with the configured webhook secret; token-equals-secret mode is only legacy fallback.
- Lever "Verify connection" sends a signed test payload that can omit opportunityId; routes should return 2xx for that signed ping.
- External webhook URLs can avoid the /api prefix by using Vercel rewrites under /lever-webhooks/* mapped to /api/webhooks/lever/*.

## 2026-04-29
- Shifted authoritative ingestion behavior to direct Lever API fetches in webhook + cron paths to reduce dependence on stale Power Automate sync state.
- Cron refresh now supports pagination with offset, confidentiality=all, active+archived scope, runtime/record caps, and next_interview enrichment.
- Stage normalization is aligned to legacy Power Automate switch map (16 cases) and archive reason normalization is aligned to legacy switch map (14 cases).
- Null-safe write behavior is enforced in cron and webhook upserts to prevent overwriting populated fields with null (including magic_token preservation).
- Cron and webhooks now skip ingestion for import-tagged candidates: candidateimport1/2/3/5/6 and ccandidateimport4.
- Cron response and runtime logs now expose tag telemetry and import-tag skip counts for run-by-run validation.
- Offer metadata enrichment added in cron (offer_access and offer_letter_key derivation when available).
- User requirement reaffirmed: before any new implementation work, update memory.md, changes.md, and fixhistory.md first.
- Root cause confirmed: cron backfill is not resumable between invocations; repeated manual runs restart from the first pages and can loop under 5-minute runtime constraints.
- Remediation direction: add persisted checkpoint state (offset + phase) so each run resumes instead of restarting.
- Implemented persisted checkpoint state in Supabase (public.cron_refresh_state) and wired cron to resume active/archived offsets across invocations.
- Applied migration cron_refresh_checkpoint to Supabase project nnauvyublclfeqizpawr.

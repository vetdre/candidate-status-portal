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
- Investigating position data anomalies for lever_id 3ddda344-94da-4546-8b77-48c7007e1b05 and null-field clusters for lever_id 9a4fe54c-7921-4215-b75c-17898f1fe748 / 47648caa-1049-46a0-b1ff-4abec1ff81a4.
- Confirmed root cause for bad position sample: legacy fallback value in public.Candidates.position contained a tag-like token (Additional+EDU+Alias+Fed), which was being reused when Lever position was absent.
- Implemented guard to block legacy-position fallback when it matches opportunity tags; applied across cron and all active webhook handlers.
- Verified null identity fields on provided Kaushik samples are due to no matching legacy candidate row by lever_id/email/name (not overwrite regression).
- User clarified authoritative identity model to preserve during Power Automate removal: person_key logic must stay the same as legacy portal behavior, only the generator moves out of Power Automate.
- person_key rules: prefer email -> `email:<lower(trim(email))>`; fallback to normalized 10-digit phone -> `phone:<digits>`.
- identity_confidence rules: email = 3, phone = 2, otherwise 1.
- magic_token rule: reuse existing token for same person_key when available; otherwise generate a GUID.
- Active/current portal behavior still groups multi-application experiences via single-table Candidates/Candidates_shadow style person_key semantics, not split Persons/Applications tables.
- Locked correction: do not invent a fallback person_key when both usable email and normalized 10-digit phone are missing; use person_key = null and identity_confidence = 1.
- Implementation requirement: centralize identity normalization/generation/token reuse logic in one shared utility and add tests before wiring cron/webhook/API callers.
- Implemented shared identity utility at api/webhooks/lever/_lib/identity.js covering email normalization, phone normalization, person_key generation, identity_confidence, last-name extraction, and magic_token reuse/generation.
- Cron, all active Lever webhook handlers, and api/get-offer-url.js now consume shared identity helpers instead of duplicating phone normalization / legacy person_key carry-forward logic.
- Token reuse lookup now checks existing rows by person_key; when person_key is null, token reuse is limited to the same application row instead of grouping on weak identity.

# Change Log

## 2026-04-23
- Added project governance tracking files: memory.md, changes.md, and fixhistory.md.
- Recorded a non-negotiable workflow requirement to update all three files after every task-level change.
- Added a compact-conversation rule: reference memory.md, changes.md, and fixhistory.md immediately before any new work.

## 2026-04-27
- Created Vercel webhook routes: api/webhooks/lever/application-created.js and api/webhooks/lever/candidate-stage-change.js.
- Updated api/webhooks/lever/_lib/dedupe.js with opportunity-event dedupe helper for the new routes.
- Added backend migration backend/migrations/0007_expand_ingest_event_types.sql and applied it to Supabase project nnauvyublclfeqizpawr.
- Updated api/webhooks/lever/_lib/env.js default LEVER_WEBHOOK_VERIFY_MODE from token_equals_secret to hmac_sha256.
- Updated api/webhooks/lever/_lib/verify.js to implement Lever HMAC-SHA256 signature validation (token + triggeredAt), with constant-time signature comparison and legacy-mode fallback.
- Updated api/webhooks/lever/application-created.js, api/webhooks/lever/candidate-stage-change.js, api/webhooks/lever/archive-state-change.js, and api/webhooks/lever/interviews.js to return HTTP 200 for signed Lever connection-test payloads that omit data.opportunityId.
- Updated api/webhooks/lever/_lib/env.js to make LEVER_API_KEY optional at config load time so signed connection-test pings can pass without Lever API fetch dependencies.
- Updated vercel.json with /lever-webhooks/* rewrites to existing /api/webhooks/lever/* routes so webhook URLs can be configured without exposing /api in the external path.

## 2026-04-29
- Updated api/webhooks/lever/_lib/supabase.js to include email/phone in legacy candidate fallback reads.
- Updated webhook handlers to fetch candidate contact details directly from Lever and prefer live Lever values with legacy fallback.
- Added api/cron/refresh-candidates.js and configured vercel.json cron schedule for nightly shadow refresh.
- Iteratively updated cron to support offset pagination, active+archived scope, confidentiality=all, runtime/record caps, and stop reason reporting.
- Updated cron to compute next_interview by fetching Lever interviews per opportunity.
- Updated cron and webhook upsert payloads to preserve existing populated values (null-safe field writes, magic_token protection).
- Updated api/webhooks/lever/_lib/rules.js with full Power Automate stage mapping switch equivalents and archive reason mapping switch equivalents.
- Updated stage extraction to normalize object/id-like stage payloads to canonical labels when mappable.
- Updated cron to enrich offer_access and offer_letter_key from opportunity offer payloads when available.
- Added cron diagnostics for tag telemetry in response and runtime logs.
- Added import-tag exclusion rules (candidateimport1/2/3/5/6 and ccandidateimport4) and enforced skipping in cron and all active webhook handlers.
- Logged remediation task: implement persisted cron checkpoint/resume to prevent restart-from-zero behavior on repeated runtime-capped runs.
- Added backend/migrations/0008_cron_refresh_checkpoint.sql to create public.cron_refresh_state and service_role policy.
- Updated api/cron/refresh-candidates.js to load/save checkpoint state, resume offsets across runs, and report checkpoint status in run output.
- Applied Supabase migration cron_refresh_checkpoint to project nnauvyublclfeqizpawr.
- Began targeted investigation of position/tag contamination and null identity-field clusters for specific lever_id samples provided by user.
- Updated api/webhooks/lever/_lib/rules.js with resolveSafeLegacyPosition() to reject legacy position fallback when it collides with opportunity tags.
- Updated cron and all active webhook handlers to use safe legacy position fallback guard.
- Confirmed sample null identity fields for lever_id 9a4fe54c-7921-4215-b75c-17898f1fe748 and 47648caa-1049-46a0-b1ff-4abec1ff81a4 are due to absent legacy source rows.
- Recorded user-confirmed identity/token source-of-truth for future cutover work: preserve existing person_key/identity_confidence/magic_token semantics while removing Power Automate as the producer.
- Locked cutover requirements received: centralize identity rules into shared utility, preserve exact Power Automate semantics, do not fabricate fallback person_key for missing email+phone, and add tests before wiring runtime callers.
- Added shared identity utility api/webhooks/lever/_lib/identity.js and backend/tests/identity.test.mjs.
- Updated backend/package.json with node test runner script for the new identity utility tests.
- Updated api/webhooks/lever/_lib/supabase.js with token lookup by person_key and existing shadow-row lookup helpers.
- Updated cron and all active Lever webhook handlers to compute person_key/identity_confidence/application_phone/application_last_name/application_last_name_norm via the shared identity utility and resolve magic_token via same-person token reuse or GUID generation.
- Updated api/get-offer-url.js to use shared phone and last-name normalization helpers.

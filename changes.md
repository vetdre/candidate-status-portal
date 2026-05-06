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
- Began one-time data repair step to backfill existing Candidates_shadow identity fields using the newly centralized rules.
- Executed one-time Candidates_shadow identity backfill in Supabase: updated 851 rows to fill person_key/identity_confidence/application_phone/application_last_name/application_last_name_norm/magic_token where missing using the centralized rules.

## 2026-04-30
- Updated api/webhooks/lever/_lib/supabase.js to guard normalized interview writes behind application parent existence checks and avoid interviews FK violations during phase-1.
- Updated api/webhooks/lever/interviews.js to record skip status when normalized interview sync is bypassed and to continue processing shadow updates.
- Added raw interview cache persistence in api/webhooks/lever/_lib/supabase.js via interview_events_raw replacement writes keyed by lever_opportunity_id.
- Added backend/migrations/0009_interview_events_raw.sql and backend/migrations/0010_secure_interview_events_raw.sql.
- Applied Supabase migrations interview_events_raw_cache and secure_interview_events_raw to project nnauvyublclfeqizpawr.
- Added invite eligibility helper api/webhooks/lever/_lib/invite.js.
- Added Graph mailer helper api/webhooks/lever/_lib/mailer.js with dry-run mode, magic-link URL construction, and optional forced-recipient override.
- Updated api/webhooks/lever/application-created.js to evaluate onboarding invite eligibility and invoke mailer non-blockingly with ingest status notes.
- Added protected smoke-test endpoint api/admin/test-mailer.js for manual mailer verification (MAILER_TEST_SECRET bearer auth).
- Pushed integration commit ae36fe0 (invite eligibility, Graph mailer, raw interview cache, and smoke-test endpoint).
- Executed production idempotent data backfill SQL to populate public.people and public.applications from unified Candidates_shadow/Candidates source rows.
- Backfill result: public.people = 1618 rows, public.applications = 1786 rows, 0 applications with null person_key.
- Executed production seed for public.interviews from public.applications.next_interview where no real interview rows existed.
- Seed result: 19 rows in public.interviews with source_event_id = next_interview_backfill_v1.
- Deployed Supabase Edge Function portal-status v14 to read from normalized people/applications first and fallback to legacy Candidates when needed.
- Preserved portal response contract (person/candidate/applications payload shape) so index.html required no UI changes.
- Applied Supabase migration portal_freshness_monitor_view to create public.portal_freshness_monitor_v1.

## 2026-05-01
- Added backend/migrations/0011_invite_sent_at.sql to add `invite_sent_at timestamptz` column to Candidates_shadow.
- Updated api/webhooks/lever/_lib/supabase.js to include `invite_sent_at` in shadow SELECT and add `markInviteSentOnShadow(leverId, cfg)` helper.
- Updated api/webhooks/lever/_lib/invite.js: replaced `isNewPortalRecord` guard with `inviteAlreadySent` check (uses invite_sent_at); added `isLeadStage()` and `isDeclineStage()` exports; blocked invite when stage is lead, decline, archived, already sent, or contact fields missing.
- Updated api/webhooks/lever/application-created.js to pass `inviteAlreadySent: !!existingShadow?.invite_sent_at` into eligibility check and call `markInviteSentOnShadow` on successful send.
- Updated api/webhooks/lever/candidate-stage-change.js to always fetch shadow row and fire invite when `isLeadTransition` is true (previous stage was lead/null and new stage is not lead) and invite not already sent; blocks on decline stage; calls `markInviteSentOnShadow` on send.
- Applied Supabase migration 0011_invite_sent_at to project nnauvyublclfeqizpawr.

## 2026-05-02
- Added api/health.js: public liveness endpoint returning app version, environment, and timestamp with no auth requirement (for UptimeRobot/Better Stack).
- Added api/admin/monitor.js: protected monitoring endpoint evaluating three health checks — cron_refresh heartbeat staleness, recent ingest_events failure rate, and portal_freshness_monitor_v1 stale-view detection. Auth via MONITOR_SECRET or CRON_SECRET bearer. Persists alert state to monitor_alert_state with cooldown to avoid duplicate emails. Returns 200 (healthy) or 503 (degraded). Sends alert emails via Graph mailer.
- Updated api/webhooks/lever/_lib/mailer.js to export `sendMonitoringAlertEmail`, `getMonitoringAlertConfig`, and `isMonitoringAlertReady` for use by the monitor endpoint.
- Added backend/migrations/0012_monitor_alert_state.sql to create public.monitor_alert_state table with cooldown tracking.
- Added backend/migrations/0013_secure_portal_freshness_monitor_v1.sql to revoke anon and authenticated role grants on portal_freshness_monitor_v1 (service_role only).
- Added backend/migrations/0014_cron_refresh_heartbeat.sql to add `last_run_at`, `last_success_at`, `last_status`, `last_error` columns to cron_refresh_state.
- Added backend/migrations/0015_cron_refresh_heartbeat_retry.sql as idempotent retry of 0014 with IF NOT EXISTS guards.
- Updated api/admin/monitor.js cron_refresh health check to use `last_success_at` / `last_status` heartbeat fields instead of checkpoint `updated_at`.
- Updated vercel.json: added /api/admin/monitor cron at `0 1 * * *` (daily, Hobby plan limit). Refresh cron retained at `0 2 * * *`.
- Applied Supabase migrations 0012–0015 to project nnauvyublclfeqizpawr.

## 2026-05-04
- Completed three-day observation window with clean results (37 processed, 0 failed).
- Set MAGIC_LINK_EMAIL_DRY_RUN=false in Vercel production environment — live invite sends now active.
- Removed MAGIC_LINK_FORCE_RECIPIENT_EMAIL from Vercel production environment.
- Updated api/webhooks/lever/_lib/mailer.js sendMagicLinkInvite to accept `positionApplied` parameter; email subject now `[candidateName] Application Status Link - [positionApplied]`; body aligned to prior Power Automate template (thanks for interest in position, personalized link instructions, last name + 10-digit phone prompt, unmonitored inbox disclaimer).
- Updated api/webhooks/lever/application-created.js to derive and pass `positionApplied` to sendMagicLinkInvite.
- Updated api/webhooks/lever/candidate-stage-change.js to derive and pass `positionApplied` to sendMagicLinkInvite.
- Updated api/admin/test-mailer.js to accept optional `positionApplied` in request body (defaults to "Test Position").
- Pushed commit a125bc7.

## 2026-05-04 (documentation)
- Created docs/system-overview.md: end-to-end architecture and operations documentation covering all components, data flows, database schema, API endpoints, cron jobs, invite system, monitoring, identity model, stage normalization, environment variables, and operations runbook.

## 2026-05-04 (normalized write ordering fix)
- Updated api/webhooks/lever/_lib/supabase.js with new `upsertPersonNormalized(person, cfg)` helper to write normalized people rows by person_key before applications upsert.
- Updated webhook handlers (application-created, candidate-stage-change, archive-state-change, interviews) to call `upsertPersonNormalized` before `upsertApplicationNormalized`.
- Updated api/cron/refresh-candidates.js to also upsert normalized people and applications during nightly refresh (not shadow-only).
- Executed one-time Supabase people backfill from Candidates_shadow distinct person_key rows (upsert preserving existing non-null values and max identity_confidence).
- Executed one-time Supabase applications backfill from Candidates_shadow for rows with non-null person_key and matching people parent.
- Validation after backfill: `shadow_person_key_missing_in_people = 0` and `shadow_not_in_applications = 4` (remaining four rows are null-person_key lead records, expected non-mappable identity exceptions).
- Updated docs/system-overview.md flow and cron sections to reflect people-first normalized upsert ordering and cron normalized writes.

## 2026-05-04 (provisional sourced identity anchor)
- Updated api/webhooks/lever/_lib/identity.js `buildIdentityFields` to support provisional person key fallback `lever_candidate:<candidateId>` when both email and normalized phone are absent.
- Added `resolveContactId` helper in api/webhooks/lever/_lib/rules.js and wired it into all webhook handlers and cron refresh identity generation.
- Updated webhook handlers and cron to pass Lever candidate id into identity builder so sourced candidates without contact factors can still link across events/applications.
- Extended identity fallback to `lever_opportunity:<leverId>` as last-resort when candidate id is unavailable.
- Added backend/tests/identity.test.mjs coverage for provisional `lever_candidate:*` person key behavior.
- Updated docs/system-overview.md identity rules to document provisional `lever_candidate:*` keys and future merge requirement to canonical email/phone keys.
- Executed one-time data repair to assign `lever_opportunity:*` person keys for residual null-identity rows and upsert corresponding people/applications rows.
- Validation snapshot after repair: `shadow_null_person_key = 0`, `shadow_not_in_applications = 0`, `shadow_person_key_missing_in_people = 0`.

## 2026-05-04 (agent dictionary)
- Added docs/agent-dictionary.md as a portable, copy-paste context file for any AI agent to troubleshoot, explain, and safely update the Candidate Portal.
- Documented canonical components, endpoint map, data semantics, invariants, troubleshooting matrix, SQL checks, reusable prompts, and change guardrails.
- Added explicit handoff list of files to provide when an agent needs deeper repo context.

## 2026-05-05 (webhook/cron hotfix)
- Fixed missing export in api/webhooks/lever/_lib/supabase.js by adding upsertPersonNormalized to module.exports.
- This resolves runtime failures in webhook handlers and cron where calls to upsertPersonNormalized threw "is not a function".

## 2026-05-06 (refresh watchdog)
- Added .github/workflows/portal-refresh-watchdog.yml to run every 4 hours and on manual dispatch.
- Workflow calls /api/admin/monitor, inspects cron/ingest/freshness checks, and triggers /api/cron/refresh-candidates only when cron health or ingest health is failing.
- Portal freshness stale count is still reported for visibility, but it no longer forces a refresh by itself because stale views can be caused by normal post-view recruiter updates.
- Workflow expects GitHub secrets PORTAL_BASE_URL plus PORTAL_MONITOR_SECRET or PORTAL_CRON_SECRET, and PORTAL_CRON_SECRET for protected refresh calls.

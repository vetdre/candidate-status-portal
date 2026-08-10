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
- Next step after code deploy: backfill existing Candidates_shadow rows missing person_key / identity_confidence / application_phone / magic_token using the same locked identity rules so historical rows converge without waiting on future touches.
- One-time backfill executed against Candidates_shadow: updated 851 rows.
- Post-backfill status: missing_person_key = 4, missing_identity_confidence = 0, missing_application_phone = 80, missing_magic_token = 0; remaining missing person_key rows are expected no-identity cases.

## 2026-04-30
- Interview webhook FK conflicts were confirmed to occur when normalized applications rows are intentionally skipped (people table not yet populated) but interviews child writes still run.
- Implemented parent-guarded normalized interview sync and added a raw interview cache path (interview_events_raw) so recruiter-created interview events are still persisted even when normalized parents are absent.
- Applied Supabase migrations for interview_events_raw table creation and RLS service-role policy in project nnauvyublclfeqizpawr.
- Implemented onboarding invite eligibility gate in application-created flow: new portal record only, not archived, non-lead stage, valid normalized application phone, and usable recipient email.
- Added Microsoft Graph mailer integration with safe dry-run default and test-recipient override support for controlled validation.
- Added protected smoke-test endpoint at /api/admin/test-mailer (bearer-secret gated) to validate Graph send path without creating ATS test candidates.
- Validation outcome: dry-run test succeeded, then live smoke test delivered successfully after IT corrected Graph permission type to application Mail.Send with consent.
- Executed idempotent normalized-model backfill from Candidates_shadow + Candidates into people/applications.
- Post-backfill normalized counts: people = 1618, applications = 1786, applications missing person_key = 0.
- Seeded normalized interviews from existing applications.next_interview for transition continuity.
- Inserted/updated 19 synthetic interview rows tagged with source_event_id = next_interview_backfill_v1 and lever_interview_id prefix backfill-next:.
- Deployed Supabase edge function portal-status v14 with hybrid read-path: normalized auth/reads via people+applications first, legacy Candidates fallback, and unchanged response contract for existing UI.
- Added normalized next_interview stale cleanup in portal-status against applications table and retained non-blocking analytics tracking.
- Created reusable database view public.portal_freshness_monitor_v1 for daily portal freshness checks anchored on portal_view_stats.

## 2026-05-01
- invite_sent_at (timestamptz on Candidates_shadow) is the single source of truth for idempotent invite tracking; never rely on row existence or isNewPortalRecord for this gate.
- markInviteSentOnShadow must be called immediately after a confirmed successful mailer send in every code path that can trigger an invite.
- isLeadStage() and isDeclineStage() are exported from invite.js; any new invite-triggering code path must gate on both before calling the mailer.
- Stage-change invite logic: fire when (previousStage was lead OR previousStage was null) AND currentStage is NOT lead AND currentStage is NOT decline AND invite_sent_at is null.

## 2026-05-02
- /api/health is intentionally unauthenticated; it exists solely for external uptime monitors.
- /api/admin/monitor requires MONITOR_SECRET or CRON_SECRET bearer; it is also the target of the Vercel daily cron at 0 1 * * *.
- monitor_alert_state cooldown prevents duplicate alert emails; do not bypass or skip writes to that table after a successful send.
- Vercel Hobby plan only supports daily cron schedules (no sub-daily intervals); any cron added to vercel.json must use a daily pattern or deployment will fail.
- portal_freshness_monitor_v1 is service_role only; do not re-grant anon or authenticated access to it.
- cron_refresh_state heartbeat fields (last_run_at, last_success_at, last_status, last_error) must be written at the start and end of every cron run; monitor staleness detection depends on last_success_at, not updated_at.
- Each health check in monitor.js must be wrapped in safeEvaluate() so a single check failure does not crash the entire endpoint.

## 2026-05-04
- System is fully live: MAGIC_LINK_EMAIL_DRY_RUN=false, MAGIC_LINK_FORCE_RECIPIENT_EMAIL removed, real invite emails are being delivered to candidates.
- Invite email subject format: "[candidateName] Application Status Link - [positionApplied]" — must match this exactly to stay consistent with candidate expectations.
- positionApplied must be derived and passed through every send path (application-created, candidate-stage-change, test-mailer); never call sendMagicLinkInvite without it.
- Pending validation: confirm first real post-cutover invite arrives at a candidate with correct subject, position name, and portal link.
- Pending cleanup: remove legacy Candidates fallback from portal-status edge function after additional stabilization.
- Pending operational: set calendar reminder for Graph client secret expiration and evaluate long-term posture of smoke-test endpoint.

## 2026-05-04 (documentation)
- Canonical system documentation lives at docs/system-overview.md. Keep it updated any time architecture, endpoints, env vars, schema, or runbook procedures change.

## 2026-05-04 (normalized write ordering fix)
- Ingestion ordering rule: always upsert normalized `people` before attempting normalized `applications` writes for the same opportunity.
- Runtime coverage rule: cron refresh must keep normalized tables in sync as well; shadow-only refresh creates normalized drift.
- Remaining normalized gap baseline after repair is expected null-identity exceptions only: 4 lead rows with `person_key = null` cannot map to applications by design.
- Documentation rule: keep docs/system-overview.md flow and cron sections aligned with actual write ordering whenever ingestion logic changes.

## 2026-05-04 (provisional sourced identity anchor)
- New identity fallback rule: when email and normalized phone are both missing but Lever candidate id exists, use provisional `person_key = lever_candidate:<candidateId>`.
- Provisional `lever_candidate:*` keys are preferred over null person_key because they preserve cross-event linking for sourced leads.
- Keep `identity_confidence = 1` for provisional candidate-id identity.
- Last-resort identity fallback: when candidate id is unavailable, use `person_key = lever_opportunity:<leverId>` to avoid null-identity rows.
- Current production parity snapshot after remediation: `shadow_null_person_key = 0`, `shadow_not_in_applications = 0`, `shadow_person_key_missing_in_people = 0`.
- Future cleanup requirement: merge provisional `lever_candidate:*` and `lever_opportunity:*` keys to canonical `email:*` / `phone:*` keys when reliable contact data appears.

## 2026-05-04 (agent dictionary)
- Added docs/agent-dictionary.md as a portable context artifact for external AI agents.
- Dictionary includes architecture map, endpoint definitions, table semantics, invariants, troubleshooting lookups, SQL checks, and safe-change guardrails.
- Intended workflow: paste docs/agent-dictionary.md first, then provide the specific task prompt and affected files.

## 2026-05-05 (webhook/cron hotfix)
- Production failures showing "upsertPersonNormalized is not a function" were caused by missing export in api/webhooks/lever/_lib/supabase.js.
- Function existed but was not included in module.exports; all importing handlers resolved it as undefined at runtime.
- Hotfix: export added and validated locally via require() type check.

## 2026-05-06 (refresh watchdog)
- Vercel daily cron is insufficient for same-day freshness remediation; GitHub Actions is now the preferred mitigation path for supplemental refresh checks.
- Added .github/workflows/portal-refresh-watchdog.yml to run every 4 hours, call the monitor endpoint, and trigger refresh only when cron or ingest checks fail.
- Portal freshness is retained as a visibility signal only; stale recently viewed rows can be normal if a candidate viewed before a later stage change.
- Required GitHub repo secrets: PORTAL_BASE_URL, PORTAL_MONITOR_SECRET or PORTAL_CRON_SECRET, and PORTAL_CRON_SECRET when refresh auth is enabled.

## 2026-08-10 (lead-stage invite gating)
- Locked business rule: NO Lever `lead-*` stage may ever trigger a portal invite; a lead that converts to a real applicant and moves into the applicant pipeline MUST receive exactly one invite.
- Root cause of lead invites: rules.js normalizes `lead-new`/`lead-reached-out`/`lead-responded` to "New Lead"/"Reached Out"/"Responded", but invite.js isLeadStage tested startsWith("lead"), which no normalized label satisfies.
- Invite gating is now allowlist-based: only known applicant-pipeline stages are invite-eligible. Lead, decline, and unmapped stages are blocked; unmapped stages report reason `unrecognized_stage`.
- Stage vocabulary rule: any stage-based gate must match the NORMALIZED labels produced by resolveCurrentStageLabel, not the raw Lever stage ids.
- candidate-stage-change no longer infers invites from a lead->non-lead transition; invite_sent_at is the sole single-send guard, so a missed invite self-heals on the next stage change.
- Fail-closed tradeoff accepted: an applicant stage missing from the allowlist suppresses the invite instead of risking a lead email; gaps are visible via `unrecognized_stage` in ingest_events.
- Open item resolved 2026-08-10: authoritative Lever stage list received; all 16 stage ids already existed in POWER_AUTOMATE_STAGE_MAP and all 10 current archive reason ids already existed in POWER_AUTOMATE_ARCHIVE_REASON_MAP.
- Stage payload shape rule: resolveCurrentStageLabel reads stage.text before stage.id, so Lever display names can bypass the id-keyed map entirely. Any stage-based gate must recognize BOTH the mapped legacy label and the Lever display name.
- Two stages differ between legacy label and Lever display name: `c320de36-...` is "In progress" in code but "Requisition" in Lever, and `7bac956b-...` is "Background Check" in code but "Asurint Background Screening" in Lever.
- Stage normalization output is intentionally left on legacy Power Automate labels to preserve historical parity; compatibility is handled by accepting both vocabularies at the gates rather than changing normalization.
- Archive reasons are not stages. "Hired" (065bdabc-...) is an archive reason, and archived candidates are blocked from invites by the `archived` condition.
- Pending HR decision: which stage should actually trigger the invite send. INVITE_ELIGIBLE_STAGE_TOKENS currently covers the whole applicant+interview pipeline and is the single place to narrow once HR responds.

# Fix History

## 2026-04-23
- No defect; operational/documentation update.
- Added and initialized tracking files and enforced mandatory post-change logging workflow.
- No defect; operational/documentation update.
- Added compact-conversation startup rule: reference memory.md, changes.md, and fixhistory.md before any other task action.

## 2026-04-27
- No defect; operational/documentation update.
- Added missing Vercel webhook endpoints for application-created and candidate-stage-change and expanded ingest event type constraint for phase-1 shadow ingestion.
- Defect: Lever webhook signature verification logic was incorrect (token compared directly to secret), causing valid signed webhook requests to fail.
- Fix: Replaced verification with HMAC-SHA256 over token+triggeredAt using webhook secret in api/webhooks/lever/_lib/verify.js and set default verify mode to hmac_sha256 in api/webhooks/lever/_lib/env.js.
- Defect: Lever "Verify connection" test payloads can be signed but omit opportunityId, causing false failure responses.
- Fix: Added signed test-payload early-return HTTP 200 paths in all four active Lever webhook routes.
- Defect: config loading required LEVER_API_KEY before webhook test-payload branching, causing connection checks to fail in environments where that value was not visible at runtime.
- Fix: Made LEVER_API_KEY optional during config loading in api/webhooks/lever/_lib/env.js; real event processing still fails safely if Lever API calls are attempted without the key.
- Operational fix: Added Vercel rewrites in vercel.json so external webhook URLs can use /lever-webhooks/* instead of /api/webhooks/*.

## 2026-04-29
- Defect: applications upsert path could trigger person FK errors when people table was unpopulated in phase-1 mode.
- Fix: Guarded normalized applications upsert to skip when person_key does not exist in people.
- Defect: shadow rows were missing/stale email and phone due to stale legacy source dependence.
- Fix: Added direct Lever candidate fetch in webhook processing and retained legacy fallback.
- Defect: cron refresh initially stopped too early and omitted portions of opportunities due to pagination/filter assumptions.
- Fix: Implemented offset pagination, active+archived traversal, confidentiality=all, runtime/record caps, and richer stop diagnostics.
- Defect: next_interview remained mostly null in cron-refreshed rows.
- Fix: Added interviews fetch and next_interview projection during cron processing.
- Defect: null payload values could overwrite existing non-null fields (including token/contact fields) during upserts.
- Fix: Converted webhook/cron writes to null-safe conditional field emission and preserved existing magic_token when absent from source payload.
- Defect: current_stage and archive_reason values drifted from historical Power Automate naming due to GUID/raw payload values.
- Fix: Added full switch-equivalent normalization maps for stage and archive reason in shared rules and applied across cron/webhooks.
- Defect: imported migration candidates should be excluded from ingestion but continued entering shadow data.
- Fix: Added import-tag based exclusion logic in shared rules and enforced skip behavior in cron + all active webhook handlers.
- Observability fix: added cron response telemetry and runtime logging for tag presence and import-tag skip counts to validate behavior in environments with differing dashboard UI views.
- Defect: cron backfill is non-resumable; each invocation restarts at the beginning, causing repeated front-of-list scans under runtime caps.
- Planned fix: persist checkpoint state (phase + offsets) and resume on subsequent runs.
- Fix: implemented persisted checkpoint state in public.cron_refresh_state and resume-aware cron traversal in api/cron/refresh-candidates.js.
- Fix validation path: migration cron_refresh_checkpoint applied to project nnauvyublclfeqizpawr; cron output now includes checkpoint state/warnings.
- New investigation: suspected position field contamination (tag-like value in position) and missing identity carry-forward fields for specific lever_id records.
- Defect: legacy fallback could write tag-like values into position when Lever position payload was empty/missing.
- Fix: added tag-collision guard for legacy position fallback and applied it in cron + webhook upsert paths.
- Investigation result: missing person_key/application_phone/magic_token on provided Kaushik samples are explained by missing legacy candidate source rows, not by null-clobber regression.
- Design constraint captured: future removal of Power Automate must preserve existing person_key grouping and magic_token reuse semantics rather than inventing a new identity model.
- Active defect scope: identity generation is still split across legacy fallback behavior instead of app-owned shared logic, leaving missing/null identity fields when legacy rows are absent.
- Locked fix requirements: shared identity utility, exact legacy person_key/identity_confidence/token reuse semantics, and no synthetic grouping when both email and normalized phone are missing.
- Fix: implemented shared identity utility and replaced legacy person_key/identity_confidence generation in cron + webhook handlers with app-owned logic matching the locked Power Automate semantics.
- Fix: token reuse now resolves by computed person_key when present, otherwise preserves/generates per-application token without grouping null-identity candidates.
- Test coverage added for email normalization, phone normalization, person_key/confidence generation, and magic_token resolution rules.
- Planned repair: apply one-time backfill to existing Candidates_shadow rows so historical data matches the newly centralized identity logic.
- Repair executed: backfilled 851 Candidates_shadow rows; remaining gaps reduced to 4 missing person_key rows (no usable email/phone identity), 0 missing identity_confidence, and 0 missing magic_token.

## 2026-04-30
- Defect: interviews webhook could fail with 409/23503 when interviews child rows were written while normalized applications parents were intentionally absent in phase-1 mode.
- Fix: guarded normalized interviews writes to skip when applications parent row is missing and report skip state without failing ingest.
- Defect: skipping normalized interviews prevented FK errors but risked losing detailed interview payload history before normalized model cutover.
- Fix: added independent raw cache table (interview_events_raw) and webhook write path so interview payloads are preserved regardless of normalized parent availability.
- Security hardening: enabled RLS and added service-role policy for interview_events_raw.
- Feature completion: implemented onboarding invite gate on application-created events so magic-link email send is tied to new eligible records only.
- Feature completion: implemented Microsoft Graph mailer integration with dry-run default and force-recipient override for controlled production-safe rollout.
- Operational blocker: Graph sendMail returned 403 because IT initially configured delegated Mail.Send instead of application Mail.Send.
- Resolution: IT corrected to application Mail.Send with consent; smoke-test endpoint validated successful live delivery.
- Transition milestone: normalized people/applications tables were empty, preventing normalized interview parent linkage and read-path cutover confidence.
- Fix: executed idempotent backfill from Candidates_shadow + Candidates into people/applications with conflict-safe updates.
- Validation: people = 1618, applications = 1786, applications missing person_key = 0.
- Transition gap: public.interviews remained empty despite known next_interview values in applications, reducing normalized read parity.
- Fix: seeded synthetic normalized interview rows from applications.next_interview for opportunities without real interview rows.
- Validation: 19 seeded rows, explicitly tagged with source_event_id = next_interview_backfill_v1 for traceability and future cleanup.
- Cutover gap: portal UI still depended on legacy edge-function reads from Candidates, risking mismatch with new ingestion-normalized model.
- Fix: deployed portal-status hybrid read-path (normalized-first with legacy fallback) while preserving existing frontend response contract.
- Validation basis: normalized coverage in production at deploy time (people=1618, applications=1786, applications with person_key=1786).
- Monitoring gap: ad hoc freshness checks required manual SQL and made stale-view diagnosis slow.
- Fix: added reusable view public.portal_freshness_monitor_v1 to compare portal_last_viewed_at against latest normalized stage updates and recent ingest failures.

## 2026-05-01
- Defect: candidate-stage-change.js never called mailer, so candidates who started as leads and moved to active/interview/offer stages never received an onboarding invite.
- Fix: added isLeadTransition check in candidate-stage-change.js; invite is now sent whenever previousStage was lead (or null) and currentStage is not lead, mirroring application-created eligibility logic.
- Defect: invite.js used isNewPortalRecord as the double-send gate, which was unreliable for stage-change path where shadow row always pre-existed.
- Fix: replaced gate with inviteAlreadySent check (!!existingShadow?.invite_sent_at) and added markInviteSentOnShadow helper; invite_sent_at is now the single source of truth for idempotent invite tracking.
- Defect: "Decline Candidate" stage transitions could theoretically satisfy isLeadTransition and trigger an invite on edge-case ordering.
- Fix: added isDeclineStage() export in invite.js and blocked invite send when currentStage resolves to the decline stage label.

## 2026-05-02
- Operational gap: no programmatic liveness probe existed; outages required manual discovery.
- Fix: added /api/health.js public endpoint returning version and timestamp for external uptime monitors (UptimeRobot / Better Stack).
- Operational gap: no automated health checks covered cron staleness, ingest failure spikes, or portal freshness degradation.
- Fix: added /api/admin/monitor.js evaluating three checks (cron_refresh heartbeat, ingest failure count, portal freshness view) with Graph Mail alert delivery and cooldown via monitor_alert_state table.
- Security gap: portal_freshness_monitor_v1 view was accessible to anon and authenticated roles, exposing portal view timing data unnecessarily.
- Fix: migration 0013 revoked anon and authenticated grants; view is now service_role only.
- Observability defect: cron_refresh_state.updated_at was only written on checkpoint saves (offset writes), not on run start/end, so monitor check showed stale timestamp even after a successful nightly refresh that produced no new offsets.
- Fix: added last_run_at, last_success_at, last_status, last_error heartbeat columns to cron_refresh_state (migrations 0014/0015); cron writes heartbeat at start and end of every run; monitor now reads last_success_at for staleness threshold.
- Deployment defect: vercel.json initially had /api/admin/monitor cron at */15 * * * * (every 15 min), which Hobby plan rejects.
- Fix: changed monitor cron to 0 1 * * * (daily, 1 AM).
- Deployment defect: vercel.json had a _comment key in the crons block, which caused Vercel deployment failure.
- Fix: removed invalid _comment key.
- Runtime defect: monitor endpoint crashed entirely when any single health-check sub-step threw (e.g., wrong column name lever_id on freshness view).
- Fix: wrapped each check in safeEvaluate(); errors are captured as alert status with warning message instead of uncaught exceptions; fixed view column reference to person_key.

## 2026-05-04
- Operational milestone: three-day observation window passed with 37 processed events and 0 failures; all health checks green.
- Action: flipped MAGIC_LINK_EMAIL_DRY_RUN=false; removed MAGIC_LINK_FORCE_RECIPIENT_EMAIL — live invite sends now active in production.
- Content defect: invite email subject and body did not match the prior Power Automate template that candidates were accustomed to, risking confusion and increased recruiter support load.
- Fix: aligned subject to "[candidateName] Application Status Link - [positionApplied]" and body to prior PA template structure: thanks for applying to specific position at ms Consultants, personalized link instruction, last name + 10-digit phone prompt, unmonitored inbox disclaimer. Added positionApplied parameter throughout send path (mailer, application-created, candidate-stage-change, test-mailer).

## 2026-05-04 (documentation)
- No defect; documentation work. Created docs/system-overview.md as the canonical end-to-end reference for the candidate portal system.

## 2026-05-04 (normalized write ordering fix)
- Defect: normalized applications write path was gated on existing people rows, but ingestion paths did not ensure people upsert first; this caused ongoing normalized coverage drift for new records even when person_key existed.
- Fix: added `upsertPersonNormalized` helper and called it before `upsertApplicationNormalized` in all active webhook handlers and cron refresh path.
- Defect: cron refresh continued to upsert shadow only, allowing normalized tables to lag behind nightly refresh output.
- Fix: cron now upserts normalized people and applications alongside shadow writes.
- Repair: executed one-time backfill SQL from Candidates_shadow into people and applications.
- Validation: people key coverage gap closed (`shadow_person_key_missing_in_people = 0`); remaining application gap reduced to expected null-identity lead exceptions only (`shadow_not_in_applications = 4`, all with `person_key IS NULL`).
- No defect; documentation sync update. Updated docs/system-overview.md to match corrected write ordering and cron normalized behavior.

## 2026-05-04 (provisional sourced identity anchor)
- Defect: sourced candidates with no email and no normalized phone were left with `person_key = null`, preventing cross-event/person linkage and keeping them outside normalized application mapping.
- Fix: introduced provisional person key fallback `lever_candidate:<candidateId>` in identity generation when email/phone are unavailable.
- Fix: added candidate-id extraction helper and wired candidate id into all webhook and cron identity paths.
- Fix: added last-resort fallback `lever_opportunity:<leverId>` when candidate id is unavailable so rows do not remain null-identity.
- Test validation: identity unit tests now explicitly cover provisional `lever_candidate:*` key behavior.
- Repair: executed one-time null-identity remediation to assign provisional lever-opportunity keys and backfill people/applications parents.
- Validation: all current normalized parity gaps closed (`shadow_null_person_key = 0`, `shadow_not_in_applications = 0`, `shadow_person_key_missing_in_people = 0`).
- Follow-up requirement: when stronger identity factors (email/phone) arrive, provisional `lever_candidate:*` and `lever_opportunity:*` keys should be merge-mapped to canonical keys before final auth-source cutover.

## 2026-05-04 (agent dictionary)
- No defect; operational documentation improvement.
- Added docs/agent-dictionary.md to provide a single portable context artifact that can be pasted into any agent for troubleshooting and low-risk change assistance.
- Included guardrails to reduce unsafe broad rewrites and preserve production contracts.

## 2026-05-05 (webhook/cron runtime regression)
- Defect: webhook and cron paths failed at runtime with "upsertPersonNormalized is not a function" despite callsites importing it.
- Root cause: api/webhooks/lever/_lib/supabase.js defined upsertPersonNormalized but omitted it from module.exports.
- Fix: added upsertPersonNormalized to module.exports and verified export presence via local require() check.

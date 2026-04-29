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

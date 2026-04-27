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

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

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

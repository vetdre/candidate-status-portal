# Candidate Portal Agent Dictionary

Purpose: portable context file for any AI agent to troubleshoot, explain, and safely update this system.

How to use with any agent:
1. Paste this file first.
2. Then ask your task in one line, for example: "Diagnose why offer URL returns no offer file found."
3. Tell the agent to follow the guardrails in section 10 before changing code.

## 1) System Identity
- Product: Candidate Portal
- Runtime: Vercel static frontend + Vercel serverless API routes + Supabase Edge Function
- Data store: Supabase Postgres and Storage
- ATS source: Lever (webhooks + API fetches)
- Email channel: Microsoft Graph

## 2) Canonical Components
- Frontend page: index.html
- Public health API: api/health.js
- Offer URL API: api/get-offer-url.js
- Lever webhook handlers: api/webhooks/lever/
- Shared webhook libs: api/webhooks/lever/_lib/
- Cron refresh job: api/cron/refresh-candidates.js
- Monitor endpoint: api/admin/monitor.js
- Mailer smoke endpoint: api/admin/test-mailer.js
- Edge function (deployed outside this repo): portal-status

## 3) Canonical Data Tables
- people: identity and auth factors
- applications: normalized opportunity/application status rows
- Candidates_shadow: compatibility/read enrichment source still used for parity data
- ingest_events: webhook processing telemetry and errors
- cron_refresh_state: cron heartbeat and checkpoint status
- monitor_alert_state: monitor alert cooldown state

## 4) Business Semantics Dictionary
- applied_at: true original application timestamp from ATS/legacy source
- stage_updated: timestamp of ATS stage change, not arbitrary processing time
- magic token: candidate token used with last name and phone for auth checks
- person_key: identity anchor; preferred canonical forms are email:<normalized> then phone:<digits>
- provisional identity keys: lever_candidate:<id> and lever_opportunity:<id> used when contact factors are missing
- offer eligible: requires auth pass, qualifying application, and resolvable offer file key

## 5) Endpoint Dictionary
- GET /api/health
  - Purpose: liveness + basic connectivity signal
- POST /functions/v1/portal-status
  - Purpose: validate token + last name + phone and return status payload
- GET /api/get-offer-url?token=&lastName=&phone=
  - Purpose: return signed offer letter URL for eligible candidates
- GET|POST /api/admin/monitor
  - Purpose: health checks for cron freshness, ingest failures, and portal freshness
- GET|POST /api/cron/refresh-candidates
  - Purpose: daily refresh from Lever into normalized + compatibility tables
- POST /api/admin/test-mailer
  - Purpose: controlled mail pipeline check

## 6) Troubleshooting Dictionary (Symptom -> Likely Cause -> First Checks)
- "Missing security token"
  - Cause: URL token absent or stripped
  - Checks: verify query token handling in index.html and portal-status payload
- "Invalid security token format"
  - Cause: token does not match frontend format regex
  - Checks: CONFIG.TOKEN_REGEX and incoming token source
- "No offer file found"
  - Cause: offer metadata mismatch or missing storage object
  - Checks: applications by person_key, Candidates_shadow offer fields, storage.objects path by lever id
- webhook 401/403 verification failures
  - Cause: wrong signature mode/secret
  - Checks: verify.js mode and LEVER_WEBHOOK_SECRET values
- webhook 5xx with processing errors
  - Cause: Lever fetch error or DB write failure
  - Checks: ingest_events process_error and webhook route logs
- stale portal data
  - Cause: cron not healthy or ingest failing
  - Checks: cron_refresh_state last_success_at + monitor endpoint output

## 7) Known Invariants (Do Not Break)
- Webhook and cron writes should be null-safe to avoid clobbering populated values.
- stage_updated must preserve ATS stage-change semantics.
- Invite email send path should keep subject format: [candidateName] Application Status Link - [positionApplied].
- /api/health is intentionally unauthenticated.
- Monitor endpoint requires bearer auth.
- Preview mode controls must not be present in live UI markup.

## 8) Quick SQL Snippets
Identity parity:
```sql
select
  (select count(*) from public."Candidates_shadow" s where not exists (select 1 from public.applications a where a.lever_opportunity_id = s.lever_id)) as shadow_not_in_applications,
  (select count(*) from public."Candidates_shadow" s left join public.people p on p.person_key = s.person_key where s.person_key is not null and p.person_key is null) as shadow_person_key_missing_in_people,
  (select count(*) from public."Candidates_shadow" where person_key is null) as shadow_null_person_key;
```

Offer parity:
```sql
select
  (select count(*) from public."Candidates" where coalesce(offer_access,false)=true and offer_letter_key is not null) as candidates_offer_strict,
  (select count(*) from public."Candidates_shadow" where coalesce(offer_access,false)=true and offer_letter_key is not null) as shadow_offer_strict;
```

## 9) Reusable Prompt Starters
- "Act as a production incident responder for this Candidate Portal. Use the dictionary. Find most likely causes for [symptom], then propose lowest-risk fix and validation steps."
- "Using this dictionary, list the exact files to change for [feature], with risk notes and rollback plan before coding."
- "Using this dictionary, generate a runbook for [incident], including SQL checks and endpoint checks."
- "Using this dictionary, review my planned change for regressions in auth, ingest, cron, and offer delivery."

## 10) Agent Guardrails
- Make smallest possible changes.
- Preserve response contracts for portal payloads.
- Never commit secrets or real token examples.
- Prefer adding checks and logs over broad rewrites.
- Validate with health/monitor checks plus focused smoke test.
- Update docs and change logs after material updates.

## 11) If the Agent Asks for Missing Context
Provide these files next:
- docs/system-overview.md
- memory.md
- changes.md
- fixhistory.md
- index.html
- vercel.json
- affected API route files under api/

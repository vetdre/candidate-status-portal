# Candidate Portal — End-to-End System Documentation

> **Date:** May 2026  
> **Status:** Production (live invite sends active since 2026-05-04)  
> **Supabase project:** `nnauvyublclfeqizpawr`  
> **Vercel project:** `candidate-status-portal` (Hobby plan)  
> **Git remote:** `https://github.com/vetdre/candidate-status-portal.git`

---

## Table of Contents

1. [System Purpose](#1-system-purpose)
2. [Architecture Overview](#2-architecture-overview)
3. [Data Flow: Candidate Created](#3-data-flow-candidate-created)
4. [Data Flow: Stage Change](#4-data-flow-stage-change)
5. [Data Flow: Portal Login](#5-data-flow-portal-login)
6. [Database Schema](#6-database-schema)
7. [API Endpoints](#7-api-endpoints)
8. [Cron Jobs](#8-cron-jobs)
9. [Invite System](#9-invite-system)
10. [Monitoring System](#10-monitoring-system)
11. [Identity Model](#11-identity-model)
12. [Stage Normalization](#12-stage-normalization)
13. [Environment Variables](#13-environment-variables)
14. [Operations Runbook](#14-operations-runbook)
15. [Known Limitations and Pending Work](#15-known-limitations-and-pending-work)

---

## 1. System Purpose

The Candidate Portal lets job applicants securely check their own application status at ms Consultants without recruiter involvement. Candidates receive a magic-link email when their Lever application becomes active. They authenticate with their last name and phone number, then see their current stage, interview schedule, and offer status.

**Core pipeline:**
```
Lever ATS → Webhooks → Vercel API → Supabase → Candidate Portal (index.html)
```

The system replaced a Power Automate pipeline that previously:
- Synced candidate data to a `Candidates` table via automated flows
- Sent magic-link emails from a shared mailbox

---

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│ Lever ATS                                                       │
│  • application_created webhook                                  │
│  • candidate_stage_change webhook                               │
│  • archive_state_change webhook                                 │
│  • interview_created / interview_updated / interview_deleted    │
└───────────────────────┬─────────────────────────────────────────┘
                        │ HMAC-SHA256 signed POST
                        ▼
┌─────────────────────────────────────────────────────────────────┐
│ Vercel (Hobby) — api/                                           │
│                                                                 │
│  Webhooks                                                       │
│    /lever-webhooks/application-created   → application-created.js │
│    /lever-webhooks/candidate-stage-change → candidate-stage-change.js │
│    /lever-webhooks/archive-state-change  → archive-state-change.js │
│    /lever-webhooks/interviews            → interviews.js        │
│                                                                 │
│  Public                                                         │
│    GET /api/health                       → health.js            │
│    GET/POST /api/get-offer-url           → get-offer-url.js     │
│                                                                 │
│  Admin (bearer auth)                                            │
│    GET/POST /api/admin/monitor           → admin/monitor.js     │
│    POST /api/admin/test-mailer           → admin/test-mailer.js │
│                                                                 │
│  Cron (daily)                                                   │
│    GET /api/cron/refresh-candidates (2 AM)                      │
│    GET /api/admin/monitor (1 AM)                                │
└───────────────────────┬─────────────────────────────────────────┘
                        │ Supabase REST (service_role)
                        ▼
┌─────────────────────────────────────────────────────────────────┐
│ Supabase (nnauvyublclfeqizpawr)                                 │
│                                                                 │
│  Normalized (phase 1+)          Legacy (phase 0)               │
│    people                         Candidates (read-only)        │
│    applications                   Candidates_shadow (write)     │
│    interviews                                                   │
│                                                                 │
│  Support tables                                                 │
│    ingest_events                                                │
│    cron_refresh_state                                           │
│    monitor_alert_state                                          │
│    interview_events_raw                                         │
│                                                                 │
│  Views                                                          │
│    portal_freshness_monitor_v1 (service_role only)             │
│                                                                 │
│  Edge Functions                                                 │
│    portal-status (v14) — candidate auth + data read             │
│    get-offer-url — offer letter signed URL                      │
│                                                                 │
│  Storage                                                        │
│    offer-letters bucket                                         │
└───────────────────────┬─────────────────────────────────────────┘
                        │ Supabase JS client (anon key)
                        ▼
┌─────────────────────────────────────────────────────────────────┐
│ Frontend — index.html (single file, no build step)             │
│   • Token from ?token= query param                              │
│   • Calls portal-status edge function                           │
│   • Calls /api/get-offer-url for signed offer URL              │
│   • Displays stage, interviews, offer access                    │
└─────────────────────────────────────────────────────────────────┘
                        │
                        │ Graph Mail (application Mail.Send)
                        ▼
┌─────────────────────────────────────────────────────────────────┐
│ Microsoft Graph / Exchange Online                               │
│   Sender: no-replyrecruiting@msconsultants.com                 │
│   Auth: client_credentials → access_token → sendMail           │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. Data Flow: Candidate Created

When a new opportunity is created in Lever, the `application_created` webhook fires.

```
Lever fires POST /lever-webhooks/application-created
        │
        ▼
1. Verify HMAC-SHA256 signature (token + triggeredAt)
        │ reject → 401
        │ ok ↓
2. Dedupe check via ingest_events (dedupeKey = eventType+webhookId+opportunityId+triggeredAt)
        │ duplicate → 202 skipped
        │ new ↓
3. Fetch full opportunity from Lever API (/opportunities/:id?expand[]=applications&expand[]=offers)
        │
4. Check opportunity tags for import exclusion
        │ import tag matched → mark processed "Skipped by import tag" → 200
        │ ok ↓
5. Fetch candidate contact details from Lever (/candidates/:id)
        │
6. Resolve position and stage via normalization maps
        │
7. Build identity fields (person_key, identity_confidence, application_phone, etc.)
        │
8. Resolve magic_token
        │  • Look up existing token by person_key in Candidates_shadow
        │  • Reuse if found, generate UUID if not
        │
9. Upsert into public.people (normalized identity parent)
        │
10. Upsert into public.applications (normalized)
        │
11. Upsert into Candidates_shadow (legacy compatibility model)
        │
12. Evaluate invite eligibility
        │  • inviteAlreadySent? (invite_sent_at IS NOT NULL)
        │  • archived?
        │  • isLeadStage?
        │  • isDeclineStage?
        │  • missing application_phone?
        │  • missing email?
        │  shouldSend = false if any → skip
        │  shouldSend = true ↓
13. sendMagicLinkInvite via Microsoft Graph
        │  • Build magic link URL (?token=<magicToken>)
        │  • POST to Graph sendMail
        │  • On success → markInviteSentOnShadow (write invite_sent_at)
        │
14. Update ingest_events.process_status = 'processed' with status notes
        │
15. Return 200 with eligibility + invite result
```

---

## 4. Data Flow: Stage Change

When a candidate moves through Lever pipeline stages, `candidate_stage_change` fires.

```
Lever fires POST /lever-webhooks/candidate-stage-change
        │
        ▼
Steps 1–10 are identical to application-created (verify → dedupe → fetch → normalize → identity → upsert)
        │
11. Load existing shadow row to get previousStage and invite_sent_at
        │
12. Determine isLeadTransition:
        isLeadTransition = (previousStage was lead OR previousStage was null)
                           AND currentStage is NOT lead
        │ isLeadTransition = false → skip invite entirely
        │ isLeadTransition = true ↓
13. Evaluate invite eligibility (same gate as application-created)
        │
14. sendMagicLinkInvite if shouldSend
        │
15. Update ingest_events + return 200
```

The stage-change handler exists to catch candidates who entered the pipeline at a "lead" stage (New Lead, Reached Out, Responded) before the portal existed. Their first non-lead transition is the moment an invite becomes appropriate.

---

## 5. Data Flow: Portal Login

```
Candidate clicks magic link → https://candidateportal.msconsultants.com/?token=<uuid>
        │
        ▼
index.html loads in browser
        │
1. Read ?token param from URL
        │
2. Prompt for last name and 10-digit phone number
        │
3. POST to Supabase Edge Function portal-status (v14)
        │  Body: { token, lastName, phone }
        │
4. portal-status verifies identity:
        │  • Look up Candidates by magic_token
        │  • Compare normalized last name
        │  • Compare normalized 10-digit phone
        │  reject → 401
        │  ok ↓
5. Return candidate payload:
        │  { person, candidate, applications[] }
        │  person: name, stage, portal_stage, portal_stage_order
        │  candidate: contact info
        │  applications: stage, position, next_interview, offer_access
        │
6. index.html renders stage card, interview timeline, offer section
        │
7. If offer_access=true, fetch signed URL:
        GET /api/get-offer-url?token=<token>&lastName=<ln>&phone=<phone>
        │  • Re-verifies identity (same gate as portal-status)
        │  • Finds offer_letter_key in applications
        │  • Generates 1-hour signed Supabase Storage URL
        │  → returns { url }
```

---

## 6. Database Schema

### Normalized Tables (phase 1 through phase 3)

**`public.people`**
| Column | Type | Notes |
|--------|------|-------|
| `person_key` | text PK | `email:<email>` or `phone:<10digits>` |
| `primary_email` | text | |
| `primary_phone10` | text | |
| `application_last_name_norm` | text | |
| `application_phone10` | text | |
| `magic_token_current` | text | |
| `identity_confidence` | smallint | 3=email, 2=phone, 1=none |
| `created_at` / `updated_at` | timestamptz | |

**`public.applications`**
| Column | Type | Notes |
|--------|------|-------|
| `lever_opportunity_id` | text PK | |
| `person_key` | text FK → people | |
| `candidate_name` | text | |
| `position` | text | |
| `current_stage` | text | Normalized label |
| `archived` | boolean | |
| `archive_reason` | text | Normalized label |
| `portal_stage` | text | UI display stage |
| `portal_stage_order` | smallint | Sort order for timeline |
| `portal_stage_terminal` | boolean | Final/closed stage flag |
| `next_interview` | timestamptz | |
| `stage_updated` | timestamptz | |

**`public.interviews`**
| Column | Type | Notes |
|--------|------|-------|
| `id` | bigserial PK | |
| `lever_interview_id` | text | |
| `lever_opportunity_id` | text FK → applications | |
| `interview_at` | timestamptz | |
| `canceled_at` | timestamptz | |
| `source_event_id` | text | `backfill-next:*` for seeded rows |

### Legacy Compatibility Table

**`public.Candidates_shadow`** — writeable shadow/compatibility table for the legacy `Candidates` model. In phase 3, portal authentication reads from normalized `people` + `applications`; `Candidates_shadow` is retained for compatibility fields (for example offer metadata) and migration safety.

Key fields retained for compatibility/debugging: `magic_token`, `application_last_name_norm`, `application_phone`, `person_key`.

Additional fields: `current_stage`, `portal_stage`, `portal_stage_order`, `portal_stage_terminal`, `offer_access`, `offer_letter_key`, `archived`, `archive_reason`, `invite_sent_at`.

### Support Tables

**`public.ingest_events`** — one row per webhook event received. Tracks deduplication, processing status, and errors.

| Key Column | Notes |
|------------|-------|
| `dedupe_key` | Unique per event+opportunity+triggeredAt |
| `process_status` | `pending` → `processed` or `failed` |
| `process_error` | Error message or skip reason |

**`public.cron_refresh_state`** — single row per cron job tracking pagination checkpoint and heartbeat.

| Column | Notes |
|--------|-------|
| `job_name` | PK, `candidates_shadow_refresh` |
| `phase` | `active` or `archived` (current pagination phase) |
| `active_offset` | Lever cursor for active opportunity pagination |
| `archived_offset` | Lever cursor for archived opportunity pagination |
| `last_run_at` | Written at start of every cron run |
| `last_success_at` | Written only on successful completion |
| `last_status` | `running`, `completed`, `partial`, `error` |
| `last_error` | Error string if last_status = error |

**`public.monitor_alert_state`** — one row per health check, tracks last alert send time for cooldown.

| Column | Notes |
|--------|-------|
| `check_name` | PK: `cron_refresh`, `ingest_failures`, `portal_freshness` |
| `last_status` | `ok` or `alert` |
| `last_alert_sent_at` | Used for cooldown (default 120 min) |
| `last_evaluated_at` | Timestamp of last evaluation |

**`public.interview_events_raw`** — raw Lever interview payloads preserved regardless of normalized parent availability.

**`public.portal_freshness_monitor_v1`** (view) — compares `portal_last_viewed_at` against latest normalized stage updates and recent ingest failures. Accessible to `service_role` only.

---

## 7. API Endpoints

### `GET /api/health`
**Auth:** None  
**Purpose:** Liveness probe for uptime monitors (UptimeRobot, Better Stack).  
**Response 200:**
```json
{ "ok": true, "status": "ok", "checkedAt": "...", "checks": { "api": "ok", "supabase": "ok" } }
```
**Response 503:** Supabase unreachable.

---

### `POST /lever-webhooks/application-created`
**Auth:** Lever HMAC-SHA256 webhook signature  
**Purpose:** New opportunity in Lever → shadow upsert + invite eligibility.  
**Dedupe:** Idempotent via `ingest_events.dedupe_key`.

---

### `POST /lever-webhooks/candidate-stage-change`
**Auth:** Lever HMAC-SHA256 webhook signature  
**Purpose:** Stage transition → shadow upsert + invite on lead→active transition.

---

### `POST /lever-webhooks/archive-state-change`
**Auth:** Lever HMAC-SHA256 webhook signature  
**Purpose:** Archive/unarchive → shadow upsert.

---

### `POST /lever-webhooks/interviews`
**Auth:** Lever HMAC-SHA256 webhook signature  
**Purpose:** Interview created/updated/deleted → raw cache + normalized interviews upsert (when parent application exists).

---

### `GET /api/get-offer-url`
**Auth:** token + lastName + phone (same as portal-status)  
**Purpose:** Generate 1-hour signed Supabase Storage URL for offer letter PDF.  
**Rate limiting:** In-memory sliding window — 5 failures per token per 10 minutes triggers block.

---

### `GET /api/admin/monitor`
**Auth:** `Authorization: Bearer <MONITOR_SECRET or CRON_SECRET>`  
**Purpose:** Run 3 health checks and send alert email if any fail. Also called as Vercel cron (1 AM daily).  
**Response 200:** All checks healthy.  
**Response 503:** One or more checks in alert state.

Health checks:
- `cron_refresh`: Validates `last_success_at` is within `MONITOR_CRON_MAX_AGE_HOURS` (default 30h) and `last_status ≠ error`.
- `ingest_failures`: Counts `ingest_events` with `process_status=failed` in the last `MONITOR_INGEST_LOOKBACK_MINUTES` (default 60min). Alert if count ≥ `MONITOR_INGEST_FAILURE_THRESHOLD` (default 5).
- `portal_freshness`: Queries `portal_freshness_monitor_v1` for rows viewed within `MONITOR_FRESHNESS_LOOKBACK_HOURS` (default 48h) that have stale stage data.

---

### `POST /api/admin/test-mailer`
**Auth:** `Authorization: Bearer <MAILER_TEST_SECRET>`  
**Purpose:** Smoke-test Graph Mail send path without creating real candidate data.  
**Body:** `{ recipientEmail, candidateName?, positionApplied? }`

---

## 8. Cron Jobs

Both crons are Vercel-managed (Hobby plan = daily-only schedules). They require `Authorization: Bearer <CRON_SECRET>`.

### `/api/cron/refresh-candidates` — 2:00 AM daily

Full shadow table refresh from Lever API. Resumes from checkpoint on each run.

**Algorithm:**
1. Load checkpoint from `cron_refresh_state` (phase + offsets).
2. Write `last_run_at`, `last_status=running` heartbeat.
3. Paginate Lever opportunities (active phase first, then archived).
4. For each opportunity:
   - Skip import-tagged candidates.
   - Fetch interviews for `next_interview` projection.
   - Compute identity fields + magic token (reuse or generate).
        - Upsert normalized people parent row.
        - Upsert normalized applications row.
   - Upsert `Candidates_shadow`.
5. Save checkpoint after each page.
6. On completion: write `last_success_at`, `last_status=completed`.
7. On runtime cap: write `last_status=partial`, checkpoint saved — next run resumes.
8. On error: write `last_status=error`, `last_error=<message>`.

**Parameters (env or query string):**
| Param | Default | Notes |
|-------|---------|-------|
| `pageSize` | 50 | Lever API page size |
| `maxRecords` | 500 | Stop after N records processed |
| `maxRuntimeMs` | 270000 | Stop after 4.5 min (Vercel 5 min limit) |
| `scope` | `all` | `active`, `archived`, or `all` |

---

### `/api/admin/monitor` — 1:00 AM daily

Runs health checks and sends alert email if any check fails. See §10 for details.

---

## 9. Invite System

### Eligibility Gate (`_lib/invite.js`)

`evaluateMagicInviteEligibility` returns `{ shouldSend, reasons[] }`. An invite is blocked if **any** of the following are true:

| Condition | Reason code |
|-----------|-------------|
| `invite_sent_at IS NOT NULL` | `invite_already_sent` |
| `archived = true` | `archived` |
| Stage starts with "lead" (case-insensitive) | `lead_stage` |
| Stage = "Decline Candidate" (case-insensitive) | `decline_stage` |
| `application_phone` is null or blank | `missing_valid_application_phone` |
| Recipient email is null or blank | `missing_recipient_email` |

### Invite Triggers

**application-created:** Fires on every new eligible opportunity. Intended for candidates who enter Lever directly into a non-lead stage (e.g., "New applicant").

**candidate-stage-change:** Fires when `isLeadTransition = true`:
```
(previousStage was lead OR previousStage was null) AND currentStage is NOT lead
```
Intended for candidates who entered as a lead and later became active applicants.

### Email Template

**Subject:** `[candidateName] Application Status Link - [positionApplied]`

**Body:**
> Hi [name],
>
> Thank you for your interest in the [position] role at ms Consultants.
>
> You can securely view your application status using your personal status link: [link]
>
> You must use this specific link in order to access your application status details.
>
> When prompted, enter the last name and 10-digit phone number used on your application.
>
> Thank you.
>
> *This email inbox is unmonitored and replies will not be received.*

### Magic Link URL Format

```
https://<PORTAL_BASE_URL><MAGIC_LINK_PATH>?token=<magic_token>
```

### Dry Run Mode

`MAGIC_LINK_EMAIL_DRY_RUN=true` (default) logs the email payload but does not call Graph. Set to `false` for live sends. **Currently: `false` (live).**

---

## 10. Monitoring System

### `/api/admin/monitor` (also Vercel cron at 1 AM)

All three checks are wrapped in `safeEvaluate()` so a failure in one check does not prevent the others from running.

**Alert flow:**
1. Run all three checks.
2. For each failing check, look up `monitor_alert_state` to check cooldown.
3. If no alert was sent in the last `MONITOR_ALERT_COOLDOWN_MINUTES` (default 120), send email.
4. Upsert `monitor_alert_state` with new `last_status`, `last_alert_sent_at`, and summary.
5. Return 200 if all ok, 503 if any alert.

**Alert recipients:** `MONITOR_ALERT_RECIPIENTS` (comma/semicolon separated).

### Public Liveness Probe (`/api/health`)

For UptimeRobot or Better Stack. No auth. Checks that Supabase REST is reachable (lightweight query on `ingest_events`). Returns 200 or 503.

---

## 11. Identity Model

All identity logic is centralized in `_lib/identity.js`.

### person_key Rules

| Input available | person_key | identity_confidence |
|-----------------|------------|---------------------|
| Valid email | `email:<lower(email)>` | 3 |
| No email, valid 10-digit phone | `phone:<10digits>` | 2 |
| No email/phone, Lever candidate ID available | `lever_candidate:<candidateId>` | 1 |
| No email/phone/candidate ID, Lever opportunity ID available | `lever_opportunity:<leverOpportunityId>` | 1 |
| Neither | `null` | 1 |

**Phone normalization:** strip non-digits; if 11 digits starting with `1`, drop the leading `1`; accept only exactly 10 digits.

**Email normalization:** lowercase, trim; reject if missing `@` or either side is empty.

### magic_token Rules

1. If `person_key` is non-null, look for an existing token by `person_key` and reuse it for continuity across that person's applications.
2. If no person-level token exists, reuse the existing application token if present.
3. Otherwise generate a new UUID.
4. Never clobber an existing populated token.

Notes:
- `lever_candidate:*` keys are provisional identity anchors for sourced leads that lack email/phone at ingest time.
- `lever_opportunity:*` keys are last-resort provisional anchors when candidate id is unavailable; these keep application rows linkable instead of leaving null identity.
- They allow cross-event linking until stronger identity factors are available.
- A future merge step should reconcile provisional `lever_candidate:*` keys to canonical `email:*` or `phone:*` keys when reliable contact fields appear.

### Portal Authentication (phase 3)

The `portal-status` edge function validates against normalized data:
1. `magic_token` (URL param) matches `people.magic_token_current`.
2. `application_last_name_norm` matches `people.application_last_name_norm`.
3. 10-digit normalized phone matches `people.application_phone10`.

After auth, applications are loaded from `applications` by `person_key`, with optional compatibility enrichment from `Candidates_shadow` for display/offer fields.

---

## 12. Stage Normalization

Lever stages are GUIDs or short strings. All incoming stage values are normalized to human-readable labels via `POWER_AUTOMATE_STAGE_MAP` in `_lib/rules.js` to maintain compatibility with the legacy Power Automate output.

### Stage Map (Lever GUID → Label)

| Label | Notes |
|-------|-------|
| New Lead | Lead stage — blocks invite |
| Reached Out | Lead stage — blocks invite |
| Responded | Lead stage — blocks invite |
| New applicant | First active stage |
| Review | |
| Phone screen | |
| Virtual interview | |
| Interview | |
| Second interview | |
| Third interview | |
| Reference check | |
| In progress | |
| Offer | |
| Background Check | |
| Request Phone Screen | |
| Decline Candidate | Blocks invite; terminal |

### Portal Stage Mapping (`portal_stage`)

`resolvePortalStageFields` maps normalized stages to a simplified portal display stage, a numeric `portal_stage_order`, and a `portal_stage_terminal` boolean. The frontend reads `portal_stage` for display and `portal_stage_order` to render the progress timeline.

---

## 13. Environment Variables

### Required — All Webhook/Cron Paths

| Variable | Purpose |
|----------|---------|
| `SUPABASE_URL` | Supabase project REST URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key (server-side only) |
| `LEVER_API_BASE_URL` | Lever API base (`https://api.lever.co/v1`) |
| `LEVER_API_KEY` | Lever API key (optional at load; required for API calls) |

### Webhook Verification

| Variable | Purpose |
|----------|---------|
| `LEVER_WEBHOOK_VERIFY_MODE` | `hmac_sha256` (default) or `token_equals_secret` (legacy) |
| `LEVER_WEBHOOK_SECRET` | Fallback shared secret for all webhook types |
| `LEVER_WEBHOOK_SECRET_APPLICATION_CREATED` | Per-event override |
| `LEVER_WEBHOOK_SECRET_CANDIDATE_STAGE_CHANGE` | Per-event override |
| `LEVER_WEBHOOK_SECRET_CANDIDATE_ARCHIVE_STATE_CHANGE` | Per-event override |
| `LEVER_WEBHOOK_SECRET_INTERVIEW_CREATED` | Per-event override |
| `LEVER_WEBHOOK_SECRET_INTERVIEW_UPDATED` | Per-event override |
| `LEVER_WEBHOOK_SECRET_INTERVIEW_DELETED` | Per-event override |

### Graph Mail / Invite

| Variable | Purpose |
|----------|---------|
| `GRAPH_TENANT_ID` | Azure AD tenant ID |
| `GRAPH_CLIENT_ID` | App registration client ID |
| `GRAPH_CLIENT_SECRET` | App registration client secret (**expires — set calendar reminder**) |
| `GRAPH_SENDER_EMAIL` | Sender address (also `MAGIC_LINK_FROM_EMAIL`) |
| `PORTAL_BASE_URL` | Portal URL base for magic link construction |
| `MAGIC_LINK_PATH` | Path appended to base URL (default `/`) |
| `MAGIC_LINK_EMAIL_DRY_RUN` | `true` = log only, `false` = live send. **Currently: false** |
| `MAGIC_LINK_FORCE_RECIPIENT_EMAIL` | Override all invite sends to this address (removed — was used for pre-cutover testing) |

### Cron

| Variable | Purpose |
|----------|---------|
| `CRON_SECRET` | Bearer token Vercel sends with cron requests |
| `CRON_REFRESH_PAGE_SIZE` | Lever pagination page size (default 50) |
| `CRON_REFRESH_MAX_RECORDS` | Max records per run (default 500) |
| `CRON_REFRESH_MAX_RUNTIME_MS` | Runtime cap in ms (default 270000) |
| `CRON_REFRESH_SCOPE` | `all`, `active`, or `archived` (default `all`) |

### Monitoring

| Variable | Purpose |
|----------|---------|
| `MONITOR_SECRET` | Bearer token for `/api/admin/monitor` |
| `MONITOR_ALERT_RECIPIENTS` | Comma/semicolon separated alert email addresses |
| `MONITOR_ALERT_COOLDOWN_MINUTES` | Min minutes between repeat alerts (default 120) |
| `MONITOR_INGEST_LOOKBACK_MINUTES` | Ingest failure check window (default 60) |
| `MONITOR_INGEST_FAILURE_THRESHOLD` | Failure count that triggers alert (default 5) |
| `MONITOR_CRON_MAX_AGE_HOURS` | Hours before cron is considered stale (default 30) |
| `MONITOR_FRESHNESS_LOOKBACK_HOURS` | Hours window for freshness check (default 48) |

### Admin

| Variable | Purpose |
|----------|---------|
| `MAILER_TEST_SECRET` | Bearer token for `/api/admin/test-mailer` |

---

## 14. Operations Runbook

### Checking System Health

**Quick status:**
```
curl https://<portal-domain>/api/health
```
Returns `200 ok` if API and Supabase are reachable, `503` if degraded.

**Detailed monitor check:**
```
curl -H "Authorization: Bearer <CRON_SECRET>" \
  https://<portal-domain>/api/admin/monitor
```
Returns per-check status with age/count details. Returns `503` if any check is in alert state.

**Check last cron run (Supabase SQL):**
```sql
SELECT job_name, phase, last_run_at, last_success_at, last_status, last_error
FROM cron_refresh_state;
```

**Check recent ingest failures:**
```sql
SELECT event_type, processed_at, process_error
FROM ingest_events
WHERE process_status = 'failed'
ORDER BY processed_at DESC
LIMIT 20;
```

---

### Invite Not Sent for a Candidate

1. Find the ingest event:
```sql
SELECT id, event_type, process_status, process_error, processed_at
FROM ingest_events
WHERE payload->>'data'->>'opportunityId' = '<lever_id>'
ORDER BY processed_at DESC;
```

2. Check `process_error` for skip reason. Common values:
   - `Invite skipped: lead_stage` — candidate is still in a lead stage
   - `Invite skipped: invite_already_sent` — already sent, `invite_sent_at` is set
   - `Invite skipped: archived` — candidate is archived
   - `Invite skipped: missing_valid_application_phone` — no usable phone number
   - `Invite skipped: missing_recipient_email` — no email address in Lever

3. Check shadow row state:
```sql
SELECT lever_id, current_stage, invite_sent_at, email, application_phone, archived
FROM "Candidates_shadow"
WHERE lever_id = '<lever_id>';
```

---

### Manually Trigger a Cron Run

```
curl -H "Authorization: Bearer <CRON_SECRET>" \
  https://<portal-domain>/api/cron/refresh-candidates
```
Optional query params: `?pageSize=50&maxRecords=200&scope=active`

---

### Smoke-Test the Mailer

```
curl -X POST \
  -H "Authorization: Bearer <MAILER_TEST_SECRET>" \
  -H "Content-Type: application/json" \
  -d '{"recipientEmail":"your@email.com","candidateName":"Test User","positionApplied":"Engineer"}' \
  https://<portal-domain>/api/admin/test-mailer
```

---

### Cron is Stuck / Checkpoint Not Advancing

If the cron appears to be re-processing the same records repeatedly:

1. Check current checkpoint:
```sql
SELECT * FROM cron_refresh_state;
```

2. If needed, reset checkpoint to restart from the beginning:
```sql
UPDATE cron_refresh_state
SET phase = 'active', active_offset = NULL, archived_offset = NULL
WHERE job_name = 'candidates_shadow_refresh';
```

---

### Adding a New Vercel Cron

**Important:** Vercel Hobby plan only supports daily cron schedules. Any cron pattern more frequent than `0 * * * *` will cause deployment failure. Use `0 <hour> * * *` format only.

---

### Rotating the Graph Client Secret

1. In Azure AD → App registrations → your app → Certificates & secrets.
2. Create new secret, copy value immediately.
3. Update `GRAPH_CLIENT_SECRET` in Vercel environment variables.
4. Redeploy or wait for next cold start.
5. Delete the old secret from Azure AD.

---

### Lever Webhook "Verify connection" Failing

All four webhook routes return `HTTP 200` for signed test payloads that omit `opportunityId`. If Lever still reports failure:
1. Confirm the webhook secret in Lever matches `LEVER_WEBHOOK_SECRET` (or the per-event variable) in Vercel.
2. Confirm `LEVER_WEBHOOK_VERIFY_MODE=hmac_sha256` (or unset, since this is the default).
3. Check Vercel function logs for the signature verification error message.

---

### Portal Shows Stale Stage

The `portal_freshness_monitor_v1` view shows candidates who viewed the portal recently but whose stage hasn't updated. To check:
```sql
SELECT * FROM portal_freshness_monitor_v1
ORDER BY last_viewed_at DESC
LIMIT 20;
```
If stage is stale, check whether Lever is firing stage-change webhooks (check `ingest_events` for recent `candidate_stage_change` rows for that `lever_id`). If events are missing, check Lever webhook configuration.

---

## 15. Known Limitations and Pending Work

### Pending Validation
- Confirm first real post-cutover invite arrives at a candidate with correct subject, position name, and portal link.
- Confirm at least one real offer packet can be downloaded through the live portal flow (runbook below).

### Final Business-Level Smoke Confirmation: Offer Download

Objective: verify a real candidate with offer access can complete the full production flow (`portal-status` auth + `get-offer-url` + signed file fetch).

1. Pick one real candidate with offer metadata and normalized identity factors:

```sql
SELECT
        p.person_key,
        p.magic_token_current AS token,
        p.application_last_name_norm AS last_name_norm,
        p.application_phone10 AS phone10,
        s.lever_id,
        s.offer_access,
        s.offer_letter_key
FROM public.people p
JOIN public.applications a
        ON a.person_key = p.person_key
JOIN public."Candidates_shadow" s
        ON s.lever_id = a.lever_opportunity_id
WHERE p.magic_token_current IS NOT NULL
        AND p.application_last_name_norm IS NOT NULL
        AND p.application_phone10 IS NOT NULL
        AND COALESCE(s.offer_access, false) = true
        AND s.offer_letter_key IS NOT NULL
LIMIT 1;
```

2. Validate auth/read flow on the production portal domain:

```bash
curl -s "https://candidateportal.msconsultants.com/api/get-offer-url?token=<token>&lastName=<last_name_norm>&phone=<phone10>"
```

Expected: `200` with JSON including `ok: true` and a signed `url`.

3. Validate signed file fetch:

```bash
curl -I "<signed_url_from_step_2>"
```

Expected: `200` and PDF-like headers (`content-type: application/pdf` or binary download content type).

4. Business confirmation:
- Open the signed URL in a browser session and confirm the document matches the selected candidate/opportunity.
- Record `lever_id`, timestamp, and operator initials in release notes.

5. If failure occurs:
- `ok:false` with auth shape correct: check `people.magic_token_current`, `people.application_last_name_norm`, and `people.application_phone10`.
- `No offer file found`: check `Candidates_shadow.offer_access` and `Candidates_shadow.offer_letter_key`, then verify object existence in `offer-letters` storage.
- Signed URL fails: re-run step 2 to generate a fresh URL (1-hour expiry), then check Storage object permissions/path.

### Legacy Cleanup (status)
- Completed: `portal-status` fallback to legacy `Candidates` removed in edge function v15.
- Completed: portal auth/read model is normalized (`people` + `applications`).

### Identity Model Migration (status)
- Completed: normalized `people` is the auth source.
- In progress (continuous hygiene): reconcile provisional `lever_candidate:*` / `lever_opportunity:*` keys to canonical `email:*` / `phone:*` as stronger identity arrives.

### Smoke-Test Endpoint
- `/api/admin/test-mailer` should be disabled or have its secret rotated for long-term production posture.

### Graph Client Secret Expiration
- Set a calendar reminder for `GRAPH_CLIENT_SECRET` expiration. If it expires, all invite sends will silently fail (Graph returns 401, mailer throws, ingest event records "Invite send failed").

### Sub-Daily Monitoring
- The Vercel Hobby plan limits all crons to daily schedules. The monitor only runs at 1 AM. For faster alerting, consider configuring an external uptime monitor (UptimeRobot, Better Stack) to hit `/api/health` every 1–5 minutes and send its own alert on 503.

### Archive-State-Change and Interviews Webhooks
- `archive-state-change.js` and `interviews.js` upsert shadow data and raw interview cache respectively but do not trigger invites. This is intentional.

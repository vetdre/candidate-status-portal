const { listOpportunities, getOpportunityInterviews } = require("../webhooks/lever/_lib/lever");
const {
  resolvePortalStageFields,
  resolveNextInterviewUtc,
  nowIsoUtcSeconds,
  resolveCurrentStageLabel,
  normalizeArchiveReason,
  resolvePositionLabel,
  resolveContactName,
  resolveContactEmail,
  resolveContactPhone,
  resolveContactId,
  resolveOpportunityTags,
  getExcludedImportTags,
  resolveSafeLegacyPosition,
  resolveAppliedAtUtc,
  resolveStageUpdatedAtUtc,
} = require("../webhooks/lever/_lib/rules");
const { buildIdentityFields, resolveMagicToken } = require("../webhooks/lever/_lib/identity");
const {
  upsertPersonNormalized,
  upsertApplicationNormalized,
  upsertCandidateShadow,
  getLegacyCandidateByLeverId,
  getShadowCandidateByLeverId,
  findMagicTokenByPersonKey,
} = require("../webhooks/lever/_lib/supabase");
const CRON_CHECKPOINT_JOB = "candidates_shadow_refresh";

function cronConfig() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const leverApiKey = process.env.LEVER_API_KEY;
  const leverApiBaseUrl = process.env.LEVER_API_BASE_URL;

  if (!supabaseUrl || !serviceRole || !leverApiKey || !leverApiBaseUrl) {
    throw new Error("Missing required env vars for cron");
  }

  return { supabaseUrl, serviceRole, leverApiKey, leverApiBaseUrl };
}

function asPositiveInt(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

function asNonEmptyString(value) {
  const s = String(value == null ? "" : value).trim();
  return s || null;
}

function firstNonEmpty(values) {
  for (const v of values) {
    const s = asNonEmptyString(v);
    if (s) return s;
  }
  return null;
}

function asBoolean(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return null;
    if (["true", "1", "yes", "y", "sent", "signed", "approved"].includes(normalized)) return true;
    if (["false", "0", "no", "n", "draft", "voided", "rejected"].includes(normalized)) return false;
  }
  return null;
}

function toTimeMs(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return 0;
  const n = Number(value);
  if (Number.isFinite(n)) return n;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : 0;
}

function resolveOfferFields(opp, currentStage) {
  const offers = Array.isArray(opp?.offers) ? opp.offers : [];
  const sorted = [...offers].sort((a, b) => {
    const aMs = Math.max(
      toTimeMs(a?.updatedAt),
      toTimeMs(a?.createdAt),
      toTimeMs(a?.sentAt),
      toTimeMs(a?.created)
    );
    const bMs = Math.max(
      toTimeMs(b?.updatedAt),
      toTimeMs(b?.createdAt),
      toTimeMs(b?.sentAt),
      toTimeMs(b?.created)
    );
    return bMs - aMs;
  });

  const latest = sorted[0] || null;
  const stageLower = String(currentStage || "").trim().toLowerCase();

  const explicitAccess = asBoolean(
    latest?.offerAccess ?? latest?.hasAccess ?? latest?.accessible ?? latest?.isAccessible
  );
  const statusAccess = asBoolean(latest?.status);
  const inferredAccess = offers.length > 0 || stageLower === "offer" || stageLower === "background check";
  const offerAccess = explicitAccess != null ? explicitAccess : statusAccess != null ? statusAccess : inferredAccess;

  const offerId = firstNonEmpty([latest?.id, latest?.offerId]);
  const offerStatus = firstNonEmpty([latest?.status, latest?.state]);
  const directKey = firstNonEmpty([
    latest?.offer_letter_key,
    latest?.offerLetterKey,
    latest?.documentKey,
    latest?.fileKey,
    latest?.storageKey,
    latest?.document?.key,
    latest?.file?.key,
    latest?.letterDocument?.key,
  ]);

  let offerLetterKey = directKey;
  if (!offerLetterKey && offerId && opp?.id) {
    offerLetterKey = `${String(opp.id)}/${offerId}${offerStatus ? `_${offerStatus}` : ""}.pdf`;
  }

  return {
    offerAccess,
    offerLetterKey,
  };
}

function getQueryParams(req) {
  try {
    const rawUrl = req && typeof req.url === "string" ? req.url : "";
    const url = new URL(rawUrl, "http://localhost");
    return url.searchParams;
  } catch {
    return new URLSearchParams();
  }
}

async function supabaseAdminFetch(path, opts, cfg) {
  const resp = await fetch(`${cfg.supabaseUrl}${path}`, {
    ...opts,
    headers: {
      ...(opts?.headers || {}),
      apikey: cfg.serviceRole,
      Authorization: `Bearer ${cfg.serviceRole}`,
    },
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    const err = new Error(`cron checkpoint fetch failed: ${resp.status} ${resp.statusText} :: ${text}`);
    err.status = resp.status;
    throw err;
  }

  return resp;
}

async function loadCheckpoint(cfg) {
  const defaultState = {
    enabled: true,
    phase: "active",
    active_offset: null,
    archived_offset: null,
  };

  try {
    const resp = await supabaseAdminFetch(
      `/rest/v1/cron_refresh_state?job_name=eq.${encodeURIComponent(CRON_CHECKPOINT_JOB)}&select=phase,active_offset,archived_offset&limit=1`,
      { method: "GET" },
      cfg
    );
    const rows = await resp.json().catch(() => []);
    const row = Array.isArray(rows) && rows.length ? rows[0] : null;
    if (!row) return defaultState;

    return {
      enabled: true,
      phase: row.phase === "archived" ? "archived" : "active",
      active_offset: row.active_offset || null,
      archived_offset: row.archived_offset || null,
    };
  } catch (err) {
    return {
      ...defaultState,
      enabled: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function saveCheckpoint(state, cfg) {
  if (!state?.enabled) return;

  await supabaseAdminFetch(
    `/rest/v1/cron_refresh_state?on_conflict=job_name`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify({
        job_name: CRON_CHECKPOINT_JOB,
        phase: state.phase === "archived" ? "archived" : "active",
        active_offset: state.active_offset || null,
        archived_offset: state.archived_offset || null,
        updated_at: new Date().toISOString(),
      }),
    },
    cfg
  );
}

async function saveRunHeartbeat(
  {
    lastStatus,
    markSuccess = false,
    lastError = null,
  },
  cfg
) {
  const nowIso = new Date().toISOString();
  await supabaseAdminFetch(
    `/rest/v1/cron_refresh_state?on_conflict=job_name`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify({
        job_name: CRON_CHECKPOINT_JOB,
        last_run_at: nowIso,
        last_status: lastStatus,
        last_error: lastError,
        ...(markSuccess ? { last_success_at: nowIso } : {}),
      }),
    },
    cfg
  );
}

module.exports = async (req, res) => {
  // Verify Vercel cron authorization.
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = req.headers["authorization"] || "";
    if (authHeader !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }
  }

  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  let cfg;
  try {
    cfg = cronConfig();
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }

  try {
    const q = getQueryParams(req);
    const pageSize = asPositiveInt(
      q.get("pageSize"),
      asPositiveInt(process.env.CRON_REFRESH_PAGE_SIZE, 50)
    );
    const maxRecords = Math.max(
      pageSize,
      asPositiveInt(q.get("maxRecords"), asPositiveInt(process.env.CRON_REFRESH_MAX_RECORDS, 500))
    );
    const maxRuntimeMs = Math.max(
      30000,
      asPositiveInt(
        q.get("maxRuntimeMs"),
        asPositiveInt(process.env.CRON_REFRESH_MAX_RUNTIME_MS, 270000)
      )
    );
    const scope = String(q.get("scope") || process.env.CRON_REFRESH_SCOPE || "all")
      .trim()
      .toLowerCase();
    const checkpointState = await loadCheckpoint(cfg);
    const checkpointWarnings = [];
    if (!checkpointState.enabled && checkpointState.error) {
      checkpointWarnings.push(checkpointState.error);
    }
    await saveRunHeartbeat({ lastStatus: "running", lastError: null }, cfg).catch((e) => {
      checkpointWarnings.push(e instanceof Error ? e.message : String(e));
    });

    const archivedFilters =
      scope === "archived"
        ? [true]
        : scope === "active"
          ? [false]
          : checkpointState.phase === "archived"
            ? [true]
            : [false, true];
    const startedAt = Date.now();

    let processed = 0;
    let failed = 0;
    let fetched = 0;
    let pages = 0;
    let offset = null;
    let hasNext = true;
    const errors = [];
    let fatalError = null;
    let stopReason = "exhausted";
    let opportunitiesWithTags = 0;
    let totalTagsObserved = 0;
    const distinctTags = new Set();
    let skippedByImportTag = 0;
    const skippedImportTagCounts = {};

    for (const archivedFilter of archivedFilters) {
      offset =
        archivedFilter
          ? (scope === "archived" ? checkpointState.archived_offset : checkpointState.archived_offset)
          : (scope === "active" ? checkpointState.active_offset : checkpointState.active_offset);
      hasNext = true;

      while (hasNext) {
        if (Date.now() - startedAt >= maxRuntimeMs) {
          stopReason = "runtime_cap";
          checkpointState.phase = archivedFilter ? "archived" : "active";
          if (archivedFilter) checkpointState.archived_offset = offset;
          else checkpointState.active_offset = offset;
          await saveCheckpoint(checkpointState, cfg).catch((e) => {
            checkpointWarnings.push(e instanceof Error ? e.message : String(e));
          });
          break;
        }
        if (processed + failed >= maxRecords) {
          stopReason = "record_cap";
          checkpointState.phase = archivedFilter ? "archived" : "active";
          if (archivedFilter) checkpointState.archived_offset = offset;
          else checkpointState.active_offset = offset;
          await saveCheckpoint(checkpointState, cfg).catch((e) => {
            checkpointWarnings.push(e instanceof Error ? e.message : String(e));
          });
          break;
        }

        let page;
        try {
          page = await listOpportunities(
            { limit: pageSize, archived: archivedFilter, offset, confidentiality: "all" },
            cfg
          );
        } catch (err) {
          stopReason = "page_fetch_error";
          fatalError = err instanceof Error ? err.message : String(err);
          errors.push(`page fetch failed (archived=${archivedFilter}, offset=${offset || "start"}): ${fatalError}`);
          checkpointState.phase = archivedFilter ? "archived" : "active";
          if (archivedFilter) checkpointState.archived_offset = offset;
          else checkpointState.active_offset = offset;
          await saveCheckpoint(checkpointState, cfg).catch((e) => {
            checkpointWarnings.push(e instanceof Error ? e.message : String(e));
          });
          break;
        }
        const opportunities = Array.isArray(page?.data) ? page.data : [];
        fetched += opportunities.length;
        pages++;

        for (const opp of opportunities) {
          if (Date.now() - startedAt >= maxRuntimeMs) {
            stopReason = "runtime_cap";
            break;
          }
          if (processed + failed >= maxRecords) {
            stopReason = "record_cap";
            break;
          }

          try {
            const opportunityId = opp?.id ? String(opp.id) : null;
            if (!opportunityId) continue;

            const archived = opp?.archived != null;
            const archiveReason = normalizeArchiveReason(
              archived && opp?.archived?.reason ? String(opp.archived.reason) : null
            );
            const currentStage = resolveCurrentStageLabel(opp?.stage);
            const stageFields = resolvePortalStageFields({
              currentStage,
              archived,
              archiveReason,
            });
            const offer = resolveOfferFields(opp, currentStage);
            const tags = resolveOpportunityTags(opp);
            if (tags.length) {
              opportunitiesWithTags++;
              totalTagsObserved += tags.length;
              for (const tag of tags) distinctTags.add(tag);
            }
            const matchedImportTags = getExcludedImportTags(tags);
            if (matchedImportTags.length) {
              skippedByImportTag++;
              for (const tag of matchedImportTags) {
                skippedImportTagCounts[tag] = (skippedImportTagCounts[tag] || 0) + 1;
              }
              continue;
            }

            const contact = opp?.contact || {};
            const candidateEmail = resolveContactEmail(contact);
            const candidatePhone = resolveContactPhone(contact);
            const candidateName = resolveContactName(contact);
            const candidateId = resolveContactId(contact) || resolveContactId(opp?.candidate);
            const position = resolvePositionLabel(opp?.position);

            const legacy = await getLegacyCandidateByLeverId(opportunityId, cfg).catch(() => null);
            const safeLegacyPosition = resolveSafeLegacyPosition(legacy?.position, tags);
            const identity = buildIdentityFields({
              email: candidateEmail || legacy?.email,
              phone: candidatePhone || legacy?.application_phone || legacy?.phone,
              fullName: candidateName || legacy?.name,
              leverCandidateId: candidateId,
              leverOpportunityId: opportunityId,
            });
            const existingShadow =
              !identity.person_key && !legacy?.magic_token
                ? await getShadowCandidateByLeverId(opportunityId, cfg).catch(() => null)
                : null;
            const magicToken = await resolveMagicToken(
              {
                personKey: identity.person_key,
                existingApplicationToken: existingShadow?.magic_token || legacy?.magic_token || null,
              },
              {
                findMagicTokenByPersonKey: async (personKey) => findMagicTokenByPersonKey(personKey, cfg),
              }
            );
            const stageUpdatedAt =
              resolveStageUpdatedAtUtc(opp, [legacy?.stage_updated, existingShadow?.stage_updated]) ||
              nowIsoUtcSeconds();
            const nextInterview = resolveNextInterviewUtc(
              await getOpportunityInterviews(opportunityId, cfg).catch(() => []),
              Date.now()
            );

            await upsertPersonNormalized(
              {
                person_key: identity.person_key,
                primary_email: identity.normalizedEmail || candidateEmail || legacy?.email || null,
                primary_phone10: identity.normalizedPhone || null,
                application_last_name_norm:
                  identity.application_last_name_norm || legacy?.application_last_name_norm || null,
                application_phone10: identity.application_phone || legacy?.application_phone || null,
                magic_token_current: magicToken,
                identity_confidence: identity.identity_confidence,
              },
              cfg
            );

            await upsertApplicationNormalized(
              {
                lever_opportunity_id: opportunityId,
                person_key: identity.person_key,
                candidate_name: candidateName || legacy?.name || null,
                applied_at: resolveAppliedAtUtc(opp, [legacy?.created_at, existingShadow?.created_at]),
                position: position || safeLegacyPosition || null,
                current_stage: currentStage,
                archived,
                archive_reason: archiveReason,
                portal_stage: stageFields.portal_stage,
                portal_stage_order: stageFields.portal_stage_order,
                portal_stage_terminal: stageFields.portal_stage_terminal,
                next_interview: nextInterview,
                stage_updated: stageUpdatedAt,
                updated_at: nowIsoUtcSeconds(),
              },
              cfg
            );

            const row = {
              lever_id: opportunityId,
              archived,
              archive_reason: archiveReason,
              next_interview: nextInterview,
              portal_stage: stageFields.portal_stage,
              portal_stage_order: stageFields.portal_stage_order,
              portal_stage_terminal: stageFields.portal_stage_terminal,
              stage_updated: stageUpdatedAt,

              ...(identity.person_key ? { person_key: identity.person_key } : {}),
              ...(candidateName || legacy?.name ? { name: candidateName || legacy.name } : {}),
              ...(candidateEmail || legacy?.email ? { email: candidateEmail || legacy.email } : {}),
              ...(candidatePhone || legacy?.phone ? { phone: candidatePhone || legacy.phone } : {}),
              ...(position || safeLegacyPosition ? { position: position || safeLegacyPosition } : {}),
              ...(currentStage ? { current_stage: currentStage } : {}),
              ...(offer.offerAccess ? { offer_access: true } : {}),
              ...(offer.offerLetterKey ? { offer_letter_key: offer.offerLetterKey } : {}),
              magic_token: magicToken,
              identity_confidence: identity.identity_confidence,
              ...(identity.application_phone || legacy?.application_phone
                ? { application_phone: identity.application_phone || legacy.application_phone }
                : {}),
              ...(identity.application_last_name || legacy?.application_last_name
                ? { application_last_name: identity.application_last_name || legacy.application_last_name }
                : {}),
              ...(identity.application_last_name_norm || legacy?.application_last_name_norm
                ? {
                    application_last_name_norm:
                      identity.application_last_name_norm || legacy.application_last_name_norm,
                  }
                : {}),
            };

            await upsertCandidateShadow(row, cfg);

            processed++;
          } catch (err) {
            failed++;
            errors.push(err instanceof Error ? err.message : String(err));
          }
        }

        if (stopReason === "runtime_cap" || stopReason === "record_cap") break;
        hasNext = !!page?.hasNext && !!page?.next;
        offset = hasNext ? String(page.next) : null;
      }

      if (!hasNext && stopReason === "exhausted") {
        if (archivedFilter) {
          checkpointState.archived_offset = null;
          checkpointState.phase = "active";
        } else {
          checkpointState.active_offset = null;
          checkpointState.phase = "archived";
        }
        await saveCheckpoint(checkpointState, cfg).catch((e) => {
          checkpointWarnings.push(e instanceof Error ? e.message : String(e));
        });
      }

      if (stopReason === "runtime_cap" || stopReason === "record_cap") break;
    }

    if (stopReason === "exhausted" && scope === "all") {
      checkpointState.phase = "active";
      checkpointState.active_offset = null;
      checkpointState.archived_offset = null;
      await saveCheckpoint(checkpointState, cfg).catch((e) => {
        checkpointWarnings.push(e instanceof Error ? e.message : String(e));
      });
    }

    const runSucceeded = !fatalError;
    const result = {
      ok: runSucceeded,
      processed,
      failed,
      fetched,
      pages,
      fatalError,
      scope,
      pageSize,
      maxRecords,
      maxRuntimeMs,
      stopReason,
      elapsedMs: Date.now() - startedAt,
      tagTelemetry: {
        opportunitiesWithTags,
        totalTagsObserved,
        distinctTagsObserved: distinctTags.size,
        sample: Array.from(distinctTags).slice(0, 20),
        skippedByImportTag,
        skippedImportTagCounts,
      },
      checkpoint: {
        enabled: !!checkpointState.enabled,
        phase: checkpointState.phase,
        active_offset: checkpointState.active_offset,
        archived_offset: checkpointState.archived_offset,
        warnings: checkpointWarnings.length ? checkpointWarnings.slice(0, 5) : undefined,
      },
      errors: errors.length ? errors.slice(0, 5) : undefined,
    };

    await saveRunHeartbeat(
      {
        lastStatus: runSucceeded ? "ok" : "error",
        markSuccess: runSucceeded,
        lastError: fatalError || null,
      },
      cfg
    ).catch((e) => {
      checkpointWarnings.push(e instanceof Error ? e.message : String(e));
    });

    console.log("[refresh-candidates] summary", JSON.stringify({
      processed: result.processed,
      failed: result.failed,
      stopReason: result.stopReason,
      tagTelemetry: result.tagTelemetry,
    }));

    return res.status(200).json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await saveRunHeartbeat({ lastStatus: "error", lastError: msg }, cfg).catch(() => {});
    return res.status(500).json({ ok: false, error: msg });
  }
};

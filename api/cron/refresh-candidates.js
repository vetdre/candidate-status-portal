const { listOpportunities, getOpportunityInterviews } = require("../webhooks/lever/_lib/lever");
const {
  resolvePortalStageFields,
  resolveNextInterviewUtc,
  nowIsoUtcSeconds,
} = require("../webhooks/lever/_lib/rules");
const { upsertCandidateShadow, getLegacyCandidateByLeverId } = require("../webhooks/lever/_lib/supabase");

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
    const q = req.query || {};
    const pageSize = asPositiveInt(q.pageSize, asPositiveInt(process.env.CRON_REFRESH_PAGE_SIZE, 50));
    const maxRecords = Math.max(
      pageSize,
      asPositiveInt(q.maxRecords, asPositiveInt(process.env.CRON_REFRESH_MAX_RECORDS, 500))
    );
    const maxRuntimeMs = Math.max(
      30000,
      asPositiveInt(q.maxRuntimeMs, asPositiveInt(process.env.CRON_REFRESH_MAX_RUNTIME_MS, 270000))
    );
    const scope = String(q.scope || process.env.CRON_REFRESH_SCOPE || "all")
      .trim()
      .toLowerCase();
    const archivedFilters = scope === "archived" ? [true] : scope === "active" ? [false] : [false, true];
    const startedAt = Date.now();

    let processed = 0;
    let failed = 0;
    let fetched = 0;
    let pages = 0;
    let offset = null;
    let hasNext = true;
    const errors = [];
    let stopReason = "exhausted";

    for (const archivedFilter of archivedFilters) {
      offset = null;
      hasNext = true;

      while (hasNext) {
        if (Date.now() - startedAt >= maxRuntimeMs) {
          stopReason = "runtime_cap";
          break;
        }
        if (processed + failed >= maxRecords) {
          stopReason = "record_cap";
          break;
        }

        const page = await listOpportunities(
          { limit: pageSize, archived: archivedFilter, offset, confidentiality: "all" },
          cfg
        );
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
            const archiveReason =
              archived && opp?.archived?.reason ? String(opp.archived.reason) : null;
            const stageFields = resolvePortalStageFields({
              currentStage: opp?.stage || null,
              archived,
              archiveReason,
            });

            const contact = opp?.contact || {};
            const candidateEmail = contact?.emails?.[0]?.value || null;
            const candidatePhone = contact?.phones?.[0]?.value || null;
            const candidateName = contact?.name || null;

            const legacy = await getLegacyCandidateByLeverId(opportunityId, cfg).catch(() => null);
            const nextInterview = resolveNextInterviewUtc(
              await getOpportunityInterviews(opportunityId, cfg).catch(() => []),
              Date.now()
            );

            await upsertCandidateShadow(
              {
                lever_id: opportunityId,
                person_key: legacy?.person_key || null,
                name: candidateName || legacy?.name || null,
                email: candidateEmail || legacy?.email || null,
                phone: candidatePhone || legacy?.phone || null,
                position: opp?.position?.text || legacy?.position || null,
                current_stage: opp?.stage || null,
                archived,
                archive_reason: archiveReason,
                next_interview: nextInterview,
                portal_stage: stageFields.portal_stage,
                portal_stage_order: stageFields.portal_stage_order,
                portal_stage_terminal: stageFields.portal_stage_terminal,
                stage_updated: nowIsoUtcSeconds(),

                ...(legacy?.magic_token ? { magic_token: legacy.magic_token } : {}),
                application_phone: legacy?.application_phone || null,
                application_last_name: legacy?.application_last_name || null,
                application_last_name_norm: legacy?.application_last_name_norm || null,
                identity_confidence: legacy?.identity_confidence || null,
              },
              cfg
            );

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

      if (stopReason === "runtime_cap" || stopReason === "record_cap") break;
    }

    return res.status(200).json({
      ok: true,
      processed,
      failed,
      fetched,
      pages,
      scope,
      pageSize,
      maxRecords,
      maxRuntimeMs,
      stopReason,
      elapsedMs: Date.now() - startedAt,
      errors: errors.length ? errors.slice(0, 5) : undefined,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ ok: false, error: msg });
  }
};

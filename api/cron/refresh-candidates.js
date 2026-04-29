const { listOpportunities } = require("../webhooks/lever/_lib/lever");
const { resolvePortalStageFields, nowIsoUtcSeconds } = require("../webhooks/lever/_lib/rules");
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
    // Fetch one page of non-archived opportunities, most recently updated first.
    // Free tier 10s limit — 50 records is a safe batch size.
    const { data: opportunities } = await listOpportunities({ limit: 50, archived: false }, cfg);

    let processed = 0;
    let failed = 0;
    const errors = [];

    for (const opp of opportunities) {
      try {
        const opportunityId = opp?.id ? String(opp.id) : null;
        if (!opportunityId) continue;

        const archived = opp?.archived != null;
        const archiveReason = archived && opp?.archived?.reason ? String(opp.archived.reason) : null;
        const stageFields = resolvePortalStageFields({
          currentStage: opp?.stage || null,
          archived,
          archiveReason,
        });

        // Contact info is expanded inline via expand[]=contact.
        const contact = opp?.contact || {};
        const candidateEmail = contact?.emails?.[0]?.value || null;
        const candidatePhone = contact?.phones?.[0]?.value || null;
        const candidateName = contact?.name || null;

        // Legacy carry-forward fields (magic_token, person_key, etc).
        const legacy = await getLegacyCandidateByLeverId(opportunityId, cfg).catch(() => null);

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
            portal_stage: stageFields.portal_stage,
            portal_stage_order: stageFields.portal_stage_order,
            portal_stage_terminal: stageFields.portal_stage_terminal,
            stage_updated: nowIsoUtcSeconds(),

            magic_token: legacy?.magic_token || null,
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

    return res.status(200).json({
      ok: true,
      processed,
      failed,
      total: opportunities.length,
      errors: errors.length ? errors.slice(0, 5) : undefined,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ ok: false, error: msg });
  }
};

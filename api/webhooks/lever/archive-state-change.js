const { config, expectedSecretForEvent } = require("./_lib/env");
const { buildArchiveDedupeKey } = require("./_lib/dedupe");
const { verifyWebhookEnvelope } = require("./_lib/verify");
const { getOpportunity, getCandidate } = require("./_lib/lever");
const { resolvePortalStageFields, nowIsoUtcSeconds } = require("./_lib/rules");
const {
  json,
  insertIngestEvent,
  updateIngestStatus,
  getLegacyCandidateByLeverId,
  upsertApplicationNormalized,
  upsertCandidateShadow,
} = require("./_lib/supabase");

module.exports = async (req, res) => {
  try {
    if (req.method === "OPTIONS") {
      res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      return res.status(204).end();
    }
    if (req.method !== "POST") {
      return json(res, 405, { ok: false, error: "Method not allowed" });
    }

    const cfg = config();
    cfg.supabaseUrl = cfg.supabaseUrl;
    cfg.serviceRole = cfg.serviceRole;

    const body = req.body || {};
    const eventName = String(body.event || "");
    const expectedSecret = expectedSecretForEvent(eventName);
    const verification = verifyWebhookEnvelope(body, expectedSecret, cfg.webhookVerifyMode);
    if (!verification.ok) {
      return json(res, 401, { ok: false, error: verification.reason });
    }

    const opportunityId = body?.data?.opportunityId ? String(body.data.opportunityId) : "";
    const candidateId = body?.data?.candidateId ? String(body.data.candidateId) : "";
    const triggeredAt = body?.triggeredAt ?? null;
    const fromArchived = body?.data?.fromArchived ?? null;
    const toArchived = body?.data?.toArchived ?? null;

    // Lever "Verify connection" test payloads are signed but may not include opportunity data.
    if (!opportunityId) {
      return json(res, 200, { ok: true, test: true, event: eventName || null });
    }

    const dedupeKey = buildArchiveDedupeKey({
      webhookEventId: body?.id,
      opportunityId,
      fromArchived,
      toArchived,
      triggeredAt,
    });

    const ingest = await insertIngestEvent(
      {
        eventType: "archive_state_change",
        eventId: body?.id ? String(body.id) : null,
        dedupeKey,
        signatureValid: true,
        payload: body,
        headers: req.headers,
      },
      cfg
    );

    if (!ingest.inserted) {
      return json(res, 202, { ok: true, duplicate: true });
    }

    try {
      const opp = await getOpportunity(opportunityId, cfg);

      // Verified branch logic: archive state is determined by webhook toArchived presence.
      const archived = toArchived != null;
      // Verified source of truth for reason: fetched opportunity archived.reason.
      const archiveReason = archived && opp?.archived?.reason ? String(opp.archived.reason) : null;

      const stageFields = resolvePortalStageFields({
        currentStage: opp?.stage || null,
        archived,
        archiveReason,
      });

      const legacy = await getLegacyCandidateByLeverId(opportunityId, cfg);
      
      // Fetch candidate details directly from Lever for contact info.
      const candidate = candidateId ? await getCandidate(candidateId, cfg).catch(() => ({})) : {};
      const candidateEmail = candidate?.emails?.[0]?.value || null;
      const candidatePhone = candidate?.phones?.[0]?.value || null;

      await upsertApplicationNormalized(
        {
          lever_opportunity_id: opportunityId,
          person_key: legacy?.person_key || null,
          candidate_name: legacy?.name || null,
          position: legacy?.position || null,
          current_stage: opp?.stage || null,
          archived,
          archive_reason: archiveReason,
          portal_stage: stageFields.portal_stage,
          portal_stage_order: stageFields.portal_stage_order,
          portal_stage_terminal: stageFields.portal_stage_terminal,
          stage_updated: nowIsoUtcSeconds(),
          updated_at: nowIsoUtcSeconds(),
        },
        cfg
      );

      await upsertCandidateShadow(
        {
          lever_id: opportunityId,
          person_key: legacy?.person_key || null,
          name: legacy?.name || null,
          email: candidateEmail || legacy?.email || null,
          phone: candidatePhone || legacy?.phone || null,
          position: legacy?.position || null,
          current_stage: opp?.stage || null,
          archived,
          archive_reason: archiveReason,
          next_interview: null,
          portal_stage: stageFields.portal_stage,
          portal_stage_order: stageFields.portal_stage_order,
          portal_stage_terminal: stageFields.portal_stage_terminal,
          stage_updated: nowIsoUtcSeconds(),

          // Phase-1 identity compatibility carry-forward.
          ...(legacy?.magic_token ? { magic_token: legacy.magic_token } : {}),
          application_phone: legacy?.application_phone || null,
          application_last_name: legacy?.application_last_name || null,
          application_last_name_norm: legacy?.application_last_name_norm || null,
          identity_confidence: legacy?.identity_confidence || null,
        },
        cfg
      );

      await updateIngestStatus(ingest.id, "processed", null, cfg);
      return json(res, 200, { ok: true, ingestEventId: ingest.id });
    } catch (innerErr) {
      const msg = innerErr instanceof Error ? innerErr.message : String(innerErr);
      await updateIngestStatus(ingest.id, "failed", msg, cfg);
      return json(res, 500, { ok: false, error: "Processing failed", details: msg });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return json(res, 500, { ok: false, error: "Unhandled error", details: msg });
  }
};

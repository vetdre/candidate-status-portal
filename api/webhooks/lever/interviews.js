const { config, expectedSecretForEvent } = require("./_lib/env");
const { buildInterviewDedupeKey } = require("./_lib/dedupe");
const { verifyWebhookEnvelope } = require("./_lib/verify");
const { getOpportunity, getCandidate, getOpportunityInterviews } = require("./_lib/lever");
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
} = require("./_lib/rules");
const { buildIdentityFields, resolveMagicToken } = require("./_lib/identity");
const {
  json,
  insertIngestEvent,
  updateIngestStatus,
  getLegacyCandidateByLeverId,
  getShadowCandidateByLeverId,
  findMagicTokenByPersonKey,
  upsertPersonNormalized,
  upsertApplicationNormalized,
  replaceInterviewsForOpportunity,
  replaceRawInterviewEventsForOpportunity,
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
    const interviewId = body?.data?.interviewId ? String(body.data.interviewId) : null;
    const triggeredAt = body?.triggeredAt ?? null;

    // Lever "Verify connection" test payloads are signed but may not include opportunity data.
    if (!opportunityId) {
      return json(res, 200, { ok: true, test: true, event: eventName || null });
    }

    const dedupeKey = buildInterviewDedupeKey({
      webhookEventId: body?.id,
      opportunityId,
      interviewId,
      triggeredAt,
    });

    const ingest = await insertIngestEvent(
      {
        eventType: "interviews",
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
      const interviews = await getOpportunityInterviews(opportunityId, cfg);
      const nextInterview = resolveNextInterviewUtc(interviews, Date.now());
      const opp = await getOpportunity(opportunityId, cfg);
      const opportunityTags = resolveOpportunityTags(opp);
      const matchedImportTags = getExcludedImportTags(opportunityTags);
      if (matchedImportTags.length) {
        await updateIngestStatus(ingest.id, "processed", "Skipped by import tag", cfg);
        return json(res, 200, {
          ok: true,
          ingestEventId: ingest.id,
          skipped: true,
          skipReason: "import_tag",
          matchedImportTags,
        });
      }

      const archived = opp?.archived != null;
      const archiveReason = normalizeArchiveReason(
        archived && opp?.archived?.reason ? String(opp.archived.reason) : null
      );
      const currentStage = resolveCurrentStageLabel(opp?.stage);
      const position = resolvePositionLabel(opp?.position);
      const stageFields = resolvePortalStageFields({
        currentStage,
        archived,
        archiveReason,
      });

      const legacy = await getLegacyCandidateByLeverId(opportunityId, cfg);
      const safeLegacyPosition = resolveSafeLegacyPosition(legacy?.position, opportunityTags);
      
      // Fetch candidate details directly from Lever for contact info.
      const candidate = candidateId ? await getCandidate(candidateId, cfg).catch(() => ({})) : {};
      const candidateEmail = resolveContactEmail(candidate) || resolveContactEmail(opp?.contact);
      const candidatePhone = resolveContactPhone(candidate) || resolveContactPhone(opp?.contact);
      const candidateName =
        resolveContactName(candidate) || resolveContactName(opp?.contact) || legacy?.name || null;

      const identity = buildIdentityFields({
        email: candidateEmail || legacy?.email,
        phone: candidatePhone || legacy?.application_phone || legacy?.phone,
        fullName: candidateName,
        leverCandidateId: candidateId || resolveContactId(candidate) || resolveContactId(opp?.contact),
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
        resolveStageUpdatedAtUtc(opp, [existingShadow?.stage_updated, legacy?.stage_updated]) ||
        nowIsoUtcSeconds();

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
          candidate_name: candidateName,
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

      const interviewSync = await replaceInterviewsForOpportunity(
        opportunityId,
        interviews,
        ingest.id,
        cfg
      );
      let rawInterviewSync = null;
      let rawInterviewSyncError = null;
      try {
        rawInterviewSync = await replaceRawInterviewEventsForOpportunity(
          opportunityId,
          candidateId,
          interviews,
          ingest.id,
          cfg
        );
      } catch (rawErr) {
        rawInterviewSyncError = rawErr instanceof Error ? rawErr.message : String(rawErr);
      }

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
        ...(candidateName ? { name: candidateName } : {}),
        ...(candidateEmail || legacy?.email ? { email: candidateEmail || legacy.email } : {}),
        ...(candidatePhone || legacy?.phone ? { phone: candidatePhone || legacy.phone } : {}),
        ...(position || safeLegacyPosition ? { position: position || safeLegacyPosition } : {}),
        ...(currentStage ? { current_stage: currentStage } : {}),
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

      const statusNotes = [];
      if (interviewSync?.skipped) statusNotes.push("Skipped interviews: missing application row");
      if (rawInterviewSyncError) statusNotes.push("Raw interview cache failed");
      const statusMessage = statusNotes.length ? statusNotes.join("; ") : null;
      await updateIngestStatus(ingest.id, "processed", statusMessage, cfg);
      return json(res, 200, {
        ok: true,
        ingestEventId: ingest.id,
        interviewSync: interviewSync?.skipped ? interviewSync : undefined,
        rawInterviewSync,
        warnings: rawInterviewSyncError ? [rawInterviewSyncError] : undefined,
      });
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

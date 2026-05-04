const { config, expectedSecretForEvent } = require("./_lib/env");
const { buildOpportunityEventDedupeKey } = require("./_lib/dedupe");
const { verifyWebhookEnvelope } = require("./_lib/verify");
const { getOpportunity, getCandidate } = require("./_lib/lever");
const {
  resolvePortalStageFields,
  nowIsoUtcSeconds,
  resolveCurrentStageLabel,
  normalizeArchiveReason,
  resolvePositionLabel,
  resolveContactName,
  resolveContactEmail,
  resolveContactPhone,
  resolveOpportunityTags,
  getExcludedImportTags,
  resolveSafeLegacyPosition,
} = require("./_lib/rules");
const { buildIdentityFields, resolveMagicToken } = require("./_lib/identity");
const { evaluateMagicInviteEligibility, isLeadStage } = require("./_lib/invite");
const { sendMagicLinkInvite } = require("./_lib/mailer");
const {
  json,
  insertIngestEvent,
  updateIngestStatus,
  getLegacyCandidateByLeverId,
  getShadowCandidateByLeverId,
  findMagicTokenByPersonKey,
  upsertApplicationNormalized,
  upsertCandidateShadow,
  markInviteSentOnShadow,
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
    const body = req.body || {};
    const eventName = String(body.event || "");

    const verification = verifyWebhookEnvelope(
      body,
      expectedSecretForEvent(eventName),
      cfg.webhookVerifyMode
    );
    if (!verification.ok) {
      return json(res, 401, { ok: false, error: verification.reason });
    }

    const opportunityId = body?.data?.opportunityId ? String(body.data.opportunityId) : "";
    const candidateId = body?.data?.candidateId ? String(body.data.candidateId) : "";
    const triggeredAt = body?.triggeredAt ?? null;

    // Lever "Verify connection" test payloads are signed but may not include opportunity data.
    if (!opportunityId) {
      return json(res, 200, { ok: true, test: true, event: eventName || null });
    }

    const dedupeKey = buildOpportunityEventDedupeKey({
      eventType: "candidate_stage_change",
      webhookEventId: body?.id,
      opportunityId,
      triggeredAt,
    });

    const ingest = await insertIngestEvent(
      {
        eventType: "candidate_stage_change",
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
      });

      const existingShadow = await getShadowCandidateByLeverId(opportunityId, cfg).catch(() => null);
      const previousStage = existingShadow?.current_stage ?? null;

      const magicToken = await resolveMagicToken(
        {
          personKey: identity.person_key,
          existingApplicationToken: existingShadow?.magic_token || legacy?.magic_token || null,
        },
        {
          findMagicTokenByPersonKey: async (personKey) => findMagicTokenByPersonKey(personKey, cfg),
        }
      );

      await upsertApplicationNormalized(
        {
          lever_opportunity_id: opportunityId,
          person_key: identity.person_key,
          candidate_name: candidateName,
          position: position || safeLegacyPosition || null,
          current_stage: currentStage,
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

      const row = {
        lever_id: opportunityId,
        archived,
        archive_reason: archiveReason,
        portal_stage: stageFields.portal_stage,
        portal_stage_order: stageFields.portal_stage_order,
        portal_stage_terminal: stageFields.portal_stage_terminal,
        stage_updated: nowIsoUtcSeconds(),

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

      // Send invite when transitioning out of lead stage for the first time.
      const recipientEmail = candidateEmail || legacy?.email || existingShadow?.email || null;
      const isLeadTransition = (isLeadStage(previousStage) || previousStage === null) && !isLeadStage(currentStage);
      const inviteEligibility = isLeadTransition
        ? evaluateMagicInviteEligibility({
            inviteAlreadySent: !!existingShadow?.invite_sent_at,
            archived,
            currentStage,
            applicationPhone: identity.application_phone || legacy?.application_phone || null,
            recipientEmail,
          })
        : null;

      let inviteResult = null;
      let inviteError = null;
      if (inviteEligibility?.shouldSend) {
        try {
          inviteResult = await sendMagicLinkInvite({
            recipientEmail,
            candidateName,
            positionApplied: position || safeLegacyPosition || null,
            magicToken,
          });
          if (inviteResult?.sent === true) {
            await markInviteSentOnShadow(opportunityId, cfg).catch(() => {});
          }
        } catch (mailErr) {
          inviteError = mailErr instanceof Error ? mailErr.message : String(mailErr);
        }
      }

      const statusNotes = [];
      if (inviteEligibility && !inviteEligibility.shouldSend) {
        statusNotes.push(`Invite skipped: ${inviteEligibility.reasons.join(",")}`);
      } else if (inviteResult?.reason) {
        statusNotes.push(`Invite not sent: ${inviteResult.reason}`);
      }
      if (inviteError) statusNotes.push("Invite send failed");

      await updateIngestStatus(
        ingest.id,
        "processed",
        statusNotes.length ? statusNotes.join("; ") : null,
        cfg
      );
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

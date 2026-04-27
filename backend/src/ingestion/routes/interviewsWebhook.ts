import type { Request, Response } from "express";
import { env } from "../../config/env.js";
import { buildInterviewDedupeKey } from "../dedupe.js";
import {
  insertIngestEvent,
  markIngestFailed,
  markIngestProcessed,
} from "../ingestEventsRepo.js";
import { resolveNextInterviewUtc } from "../../domain/rules/interviewRules.js";
import { resolveArchiveProjection } from "../../domain/rules/archiveRules.js";
import { upsertCandidatesShadow } from "../../materializers/candidatesShadowMaterializer.js";
import { fetchLeverInterviewsByOpportunity, fetchLeverOpportunity } from "../leverClient.js";
import { getExpectedWebhookSecret } from "../webhookSecrets.js";

function verifyWebhookEnvelope(body: any): boolean {
  const signature = String(body?.signature || "").trim();
  const token = String(body?.token || "").trim();
  const eventName = String(body?.event || "").trim();
  const expectedSecret = getExpectedWebhookSecret(eventName);

  // TODO: implement provider-specific cryptographic verification once exact algorithm details are finalized.
  return Boolean(signature && token && expectedSecret);
}

export async function interviewsWebhookHandler(req: Request, res: Response): Promise<void> {
  if (!env.ffIngestEnabled || !env.ffInterviewsRouteEnabled) {
    res.status(503).json({ ok: false, error: "interviews route disabled" });
    return;
  }

  const body = req.body ?? {};
  const signatureValid = verifyWebhookEnvelope(body);
  if (!signatureValid) {
    res.status(401).json({ ok: false, error: "invalid signature" });
    return;
  }

  const eventType = "interviews" as const;
  const eventId = body?.id ? String(body.id) : null;
  const triggeredAt = body?.triggeredAt ?? null;
  const opportunityId = body?.data?.opportunityId ? String(body.data.opportunityId) : "";
  const interviewId = body?.data?.interviewId ?? null;
  void body?.data?.panelId;
  void body?.data?.updatedAt;
  void body?.data?.candidateId;
  void body?.data?.contactId;

  if (!opportunityId) {
    res.status(400).json({ ok: false, error: "missing opportunityId" });
    return;
  }

  const dedupeKey = buildInterviewDedupeKey({
    webhookEventId: body?.id,
    opportunityId,
    interviewId,
    triggeredAt,
  });

  const inserted = await insertIngestEvent({
    source: "lever",
    eventType,
    eventId,
    dedupeKey,
    signatureValid,
    payload: body,
    headers: req.headers,
  });

  if (!inserted.inserted || !inserted.ingestEventId) {
    res.status(202).json({ ok: true, duplicate: true });
    return;
  }

  try {
    const interviews = await fetchLeverInterviewsByOpportunity(opportunityId);
    const nextInterview = resolveNextInterviewUtc(interviews);

    const opp = await fetchLeverOpportunity(opportunityId);
    const archived = opp?.archived != null;
    const archiveReason = archived ? (opp?.archived?.reason ? String(opp.archived.reason) : null) : null;

    const projectionRules = resolveArchiveProjection({
      currentStage: opp?.stage ? String(opp.stage) : null,
      archived,
      archiveReason,
    });

    if (!env.ffDryRunMode && env.ffShadowMaterializeEnabled) {
      await upsertCandidatesShadow({
        leverId: opportunityId,
        personKey: null,
        currentStage: opp?.stage ? String(opp.stage) : null,
        archived,
        archiveReason,
        nextInterview,
        portalStage: projectionRules.portalStage,
        portalStageOrder: projectionRules.portalStageOrder,
        portalStageTerminal: projectionRules.portalStageTerminal,
        stageUpdated: new Date().toISOString(),
        candidateName: null,
        position: null,
        identityConfidence: null,
        applicationLastNameNorm: null,
      });
    }

    await markIngestProcessed(inserted.ingestEventId);
    res.status(202).json({ ok: true, ingestEventId: inserted.ingestEventId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await markIngestFailed(inserted.ingestEventId, message);
    res.status(500).json({ ok: false, error: "interviews processing failed" });
  }
}

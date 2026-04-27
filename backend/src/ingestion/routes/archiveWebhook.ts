import type { Request, Response } from "express";
import { env } from "../../config/env.js";
import { buildArchiveDedupeKey } from "../dedupe.js";
import {
  insertIngestEvent,
  markIngestFailed,
  markIngestProcessed,
} from "../ingestEventsRepo.js";
import { resolveArchiveProjection } from "../../domain/rules/archiveRules.js";
import { upsertCandidatesShadow } from "../../materializers/candidatesShadowMaterializer.js";
import { fetchLeverOpportunity } from "../leverClient.js";
import { getExpectedWebhookSecret } from "../webhookSecrets.js";

function verifyWebhookEnvelope(body: any): boolean {
  const signature = String(body?.signature || "").trim();
  const token = String(body?.token || "").trim();
  const eventName = String(body?.event || "").trim();
  const expectedSecret = getExpectedWebhookSecret(eventName);

  // TODO: implement provider-specific cryptographic verification once exact algorithm details are finalized.
  return Boolean(signature && token && expectedSecret);
}

export async function archiveWebhookHandler(req: Request, res: Response): Promise<void> {
  if (!env.ffIngestEnabled || !env.ffArchiveRouteEnabled) {
    res.status(503).json({ ok: false, error: "archive route disabled" });
    return;
  }

  const body = req.body ?? {};
  const signatureValid = verifyWebhookEnvelope(body);
  if (!signatureValid) {
    res.status(401).json({ ok: false, error: "invalid signature" });
    return;
  }

  const eventType = "archive_state_change" as const;
  const eventId = body?.id ? String(body.id) : null;
  const triggeredAt = body?.triggeredAt ?? null;
  const opportunityId = body?.data?.opportunityId ? String(body.data.opportunityId) : "";
  const fromArchived = body?.data?.fromArchived ?? null;
  const toArchived = body?.data?.toArchived ?? null;
  void body?.data?.candidateId;
  void body?.data?.contactId;

  if (!opportunityId) {
    res.status(400).json({ ok: false, error: "missing opportunityId" });
    return;
  }

  const dedupeKey = buildArchiveDedupeKey({
    webhookEventId: body?.id,
    opportunityId,
    fromArchived,
    toArchived,
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
    const opp = await fetchLeverOpportunity(opportunityId);
    const archiveReason = opp?.archived?.reason ? String(opp.archived.reason) : null;
    const archived = toArchived !== null;

    const projectionRules = resolveArchiveProjection({
      currentStage: opp?.stage ? String(opp.stage) : null,
      archived,
      archiveReason: archived ? archiveReason : null,
    });

    if (!env.ffDryRunMode && env.ffShadowMaterializeEnabled) {
      await upsertCandidatesShadow({
        leverId: opportunityId,
        personKey: null,
        currentStage: opp?.stage ? String(opp.stage) : null,
        archived,
        archiveReason: archived ? archiveReason : null,
        nextInterview: null,
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
    res.status(500).json({ ok: false, error: "archive processing failed" });
  }
}

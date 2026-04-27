import { pool } from "../db/pool.js";
import type { CompatibilityProjection } from "../types/contracts.js";

interface LegacyCompatRow {
  name: string | null;
  position: string | null;
  identity_confidence: number | null;
  application_last_name_norm: string | null;
  magic_token: string | null;
  application_phone: string | null;
  application_last_name: string | null;
}

async function loadLegacyCompat(leverId: string): Promise<LegacyCompatRow | null> {
  const q = await pool.query(
    `
      select
        name,
        position,
        identity_confidence,
        application_last_name_norm,
        magic_token,
        application_phone,
        application_last_name
      from "Candidates"
      where lever_id = $1
      limit 1
    `,
    [leverId]
  );
  return q.rows[0] ?? null;
}

/**
 * Phase-1 materializer writes only the archive/interview parity slice plus
 * identity compatibility carry-forward fields needed for future portal cutover validation.
 */
export async function upsertCandidatesShadow(
  projection: CompatibilityProjection
): Promise<void> {
  const legacy = await loadLegacyCompat(projection.leverId);

  await pool.query(
    `
      insert into "Candidates_shadow" (
        lever_id,
        person_key,
        current_stage,
        archived,
        archive_reason,
        next_interview,
        portal_stage,
        portal_stage_order,
        portal_stage_terminal,
        stage_updated,
        name,
        position,
        identity_confidence,
        application_last_name_norm,
        magic_token,
        application_phone,
        application_last_name
      )
      values (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        coalesce($11, $12),
        coalesce($13, $14),
        coalesce($15, $16),
        coalesce($17, $18),
        $19,
        $20,
        $21
      )
      on conflict (lever_id) do update set
        person_key = excluded.person_key,
        current_stage = excluded.current_stage,
        archived = excluded.archived,
        archive_reason = excluded.archive_reason,
        next_interview = excluded.next_interview,
        portal_stage = excluded.portal_stage,
        portal_stage_order = excluded.portal_stage_order,
        portal_stage_terminal = excluded.portal_stage_terminal,
        stage_updated = excluded.stage_updated,
        name = excluded.name,
        position = excluded.position,
        identity_confidence = excluded.identity_confidence,
        application_last_name_norm = excluded.application_last_name_norm,
        magic_token = excluded.magic_token,
        application_phone = excluded.application_phone,
        application_last_name = excluded.application_last_name
    `,
    [
      projection.leverId,
      projection.personKey,
      projection.currentStage,
      projection.archived,
      projection.archiveReason,
      projection.nextInterview,
      projection.portalStage,
      projection.portalStageOrder,
      projection.portalStageTerminal,
      projection.stageUpdated,
      projection.candidateName,
      legacy?.name ?? null,
      projection.position,
      legacy?.position ?? null,
      projection.identityConfidence,
      legacy?.identity_confidence ?? null,
      projection.applicationLastNameNorm,
      legacy?.application_last_name_norm ?? null,
      legacy?.magic_token ?? null,
      legacy?.application_phone ?? null,
      legacy?.application_last_name ?? null,
    ]
  );
}

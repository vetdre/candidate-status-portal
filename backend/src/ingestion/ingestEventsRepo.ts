import { pool } from "../db/pool.js";
import type { IngestEventInsert } from "../types/contracts.js";

export async function insertIngestEvent(row: IngestEventInsert): Promise<{
  inserted: boolean;
  ingestEventId: number | null;
}> {
  const sql = `
    insert into ingest_events (
      source,
      event_type,
      event_id,
      dedupe_key,
      signature_valid,
      payload,
      headers,
      process_status
    )
    values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, 'received')
    on conflict (dedupe_key) do nothing
    returning id
  `;

  const values = [
    row.source,
    row.eventType,
    row.eventId,
    row.dedupeKey,
    row.signatureValid,
    JSON.stringify(row.payload),
    JSON.stringify(row.headers),
  ];

  const result = await pool.query(sql, values);
  if (result.rowCount === 0) {
    return { inserted: false, ingestEventId: null };
  }

  return { inserted: true, ingestEventId: Number(result.rows[0].id) };
}

export async function markIngestProcessed(id: number): Promise<void> {
  await pool.query(
    `update ingest_events set process_status = 'processed', processed_at = now(), process_error = null where id = $1`,
    [id]
  );
}

export async function markIngestFailed(id: number, error: string): Promise<void> {
  await pool.query(
    `update ingest_events set process_status = 'failed', processed_at = now(), process_error = $2 where id = $1`,
    [id, error.slice(0, 4000)]
  );
}

export type IngestEventType = "archive_state_change" | "interviews";

export type ProcessStatus =
  | "received"
  | "processed"
  | "failed"
  | "ignored_duplicate";

export interface IngestEventInsert {
  source: "lever";
  eventType: IngestEventType;
  eventId: string | null;
  dedupeKey: string;
  signatureValid: boolean;
  payload: unknown;
  headers: Record<string, string | string[] | undefined>;
}

export interface CompatibilityProjection {
  leverId: string;
  personKey: string | null;
  currentStage: string | null;
  archived: boolean;
  archiveReason: string | null;
  nextInterview: string | null;
  portalStage: string | null;
  portalStageOrder: number | null;
  portalStageTerminal: boolean | null;
  stageUpdated: string | null;
  candidateName: string | null;
  position: string | null;
  identityConfidence: number | null;
  applicationLastNameNorm: string | null;
}

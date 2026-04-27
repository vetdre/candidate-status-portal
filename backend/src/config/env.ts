function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function opt(name: string): string | null {
  const v = process.env[name];
  if (!v) return null;
  return v;
}

function bool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
}

export const env = {
  port: Number(process.env.PORT || 8787),
  databaseUrl: req("DATABASE_URL"),
  leverWebhookSecretDefault: opt("LEVER_WEBHOOK_SECRET"),
  leverWebhookSecretApplicationCreated: opt("LEVER_WEBHOOK_SECRET_APPLICATION_CREATED"),
  leverWebhookSecretCandidateStageChange: opt("LEVER_WEBHOOK_SECRET_CANDIDATE_STAGE_CHANGE"),
  leverWebhookSecretCandidateArchiveStateChange: opt(
    "LEVER_WEBHOOK_SECRET_CANDIDATE_ARCHIVE_STATE_CHANGE"
  ),
  leverWebhookSecretInterviewCreated: opt("LEVER_WEBHOOK_SECRET_INTERVIEW_CREATED"),
  leverWebhookSecretInterviewUpdated: opt("LEVER_WEBHOOK_SECRET_INTERVIEW_UPDATED"),
  leverWebhookSecretInterviewDeleted: opt("LEVER_WEBHOOK_SECRET_INTERVIEW_DELETED"),
  leverApiBaseUrl: req("LEVER_API_BASE_URL"),
  leverApiKey: req("LEVER_API_KEY"),
  replayAuthToken: req("REPLAY_AUTH_TOKEN"),

  ffIngestEnabled: bool("FF_INGEST_ENABLED", true),
  ffArchiveRouteEnabled: bool("FF_ARCHIVE_ROUTE_ENABLED", true),
  ffInterviewsRouteEnabled: bool("FF_INTERVIEWS_ROUTE_ENABLED", true),
  ffNormalizedWritesEnabled: bool("FF_NORMALIZED_WRITES_ENABLED", true),
  ffShadowMaterializeEnabled: bool("FF_SHADOW_MATERIALIZE_ENABLED", true),
  ffParityJobEnabled: bool("FF_PARITY_JOB_ENABLED", false),
  ffReplayEnabled: bool("FF_REPLAY_ENABLED", true),
  ffDryRunMode: bool("FF_DRY_RUN_MODE", false),
  ffSyncProcessingLocal: bool("FF_SYNC_PROCESSING_LOCAL", true),
};

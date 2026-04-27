function required(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function optional(name) {
  const v = process.env[name];
  if (!v) return null;
  return v;
}

function verifyMode() {
  return String(process.env.LEVER_WEBHOOK_VERIFY_MODE || "hmac_sha256").trim().toLowerCase();
}

function expectedSecretForEvent(eventName) {
  const event = String(eventName || "").trim().toLowerCase();
  const fallback = optional("LEVER_WEBHOOK_SECRET");

  if (event.includes("application") && event.includes("created")) {
    return optional("LEVER_WEBHOOK_SECRET_APPLICATION_CREATED") || fallback;
  }
  if (event.includes("candidate") && event.includes("stage")) {
    return optional("LEVER_WEBHOOK_SECRET_CANDIDATE_STAGE_CHANGE") || fallback;
  }
  if (event.includes("candidate") && event.includes("archive")) {
    return optional("LEVER_WEBHOOK_SECRET_CANDIDATE_ARCHIVE_STATE_CHANGE") || fallback;
  }
  if (event.includes("interview") && event.includes("created")) {
    return optional("LEVER_WEBHOOK_SECRET_INTERVIEW_CREATED") || fallback;
  }
  if (event.includes("interview") && event.includes("updated")) {
    return optional("LEVER_WEBHOOK_SECRET_INTERVIEW_UPDATED") || fallback;
  }
  if (event.includes("interview") && event.includes("deleted")) {
    return optional("LEVER_WEBHOOK_SECRET_INTERVIEW_DELETED") || fallback;
  }

  return fallback;
}

function config() {
  return {
    supabaseUrl: required("SUPABASE_URL"),
    serviceRole: required("SUPABASE_SERVICE_ROLE_KEY"),
    leverApiBaseUrl: required("LEVER_API_BASE_URL"),
    leverApiKey: optional("LEVER_API_KEY"),
    webhookVerifyMode: verifyMode(),
  };
}

module.exports = {
  config,
  expectedSecretForEvent,
};

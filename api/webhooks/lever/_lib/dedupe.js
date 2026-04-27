const crypto = require("node:crypto");

const VERSION = "v1";
const DELIM = "\u001f";
const NULL_TOKEN = "__NULL__";

function canonicalScalar(v) {
  if (v === null || v === undefined) return NULL_TOKEN;
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return NULL_TOKEN;
    return String(v);
  }
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}

function hashFields(fields) {
  const canonical = fields.map(canonicalScalar).join(DELIM);
  return crypto.createHash("sha256").update(canonical, "utf8").digest("hex");
}

function buildInterviewDedupeKey(input) {
  return hashFields([
    VERSION,
    "interviews",
    input.webhookEventId,
    input.opportunityId,
    input.interviewId,
    input.triggeredAt,
  ]);
}

function buildArchiveDedupeKey(input) {
  return hashFields([
    VERSION,
    "archive_state_change",
    input.webhookEventId,
    input.opportunityId,
    input.fromArchived,
    input.toArchived,
    input.triggeredAt,
  ]);
}

function buildOpportunityEventDedupeKey(input) {
  return hashFields([
    VERSION,
    input.eventType,
    input.webhookEventId,
    input.opportunityId,
    input.triggeredAt,
  ]);
}

module.exports = {
  buildInterviewDedupeKey,
  buildArchiveDedupeKey,
  buildOpportunityEventDedupeKey,
};


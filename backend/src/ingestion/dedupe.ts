import crypto from "node:crypto";
import type { IngestEventType } from "../types/contracts.js";

const DEDUPE_VERSION = "v1";
const DELIM = "\u001f";
const NULL_TOKEN = "__NULL__";

function canonicalScalar(value: unknown): string {
  if (value === null || value === undefined) return NULL_TOKEN;
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return NULL_TOKEN;
    return String(value);
  }
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

/**
 * Canonical dedupe spec (implementation-locked):
 * 1) Fixed field order exactly as listed below.
 * 2) Null/undefined => "__NULL__".
 * 3) Join fields using ASCII Unit Separator (U+001F).
 * 4) Prefix with version token "v1".
 * 5) SHA-256 hash over UTF-8 bytes, lowercase hex output.
 */
export function buildDedupeKey(input: {
  eventType: IngestEventType;
  webhookEventId: unknown;
  opportunityId: unknown;
  interviewId?: unknown;
  fromArchived?: unknown;
  toArchived?: unknown;
  triggeredAt: unknown;
}): string {
  const fields = [
    DEDUPE_VERSION,
    canonicalScalar(input.eventType),
    canonicalScalar(input.webhookEventId),
    canonicalScalar(input.opportunityId),
    canonicalScalar(input.interviewId),
    canonicalScalar(input.fromArchived),
    canonicalScalar(input.toArchived),
    canonicalScalar(input.triggeredAt),
  ];

  const canonical = fields.join(DELIM);
  return crypto.createHash("sha256").update(canonical, "utf8").digest("hex");
}

export function buildInterviewDedupeKey(input: {
  webhookEventId: unknown;
  opportunityId: unknown;
  interviewId: unknown;
  triggeredAt: unknown;
}): string {
  const fields = [
    DEDUPE_VERSION,
    "interviews" satisfies IngestEventType,
    canonicalScalar(input.webhookEventId),
    canonicalScalar(input.opportunityId),
    canonicalScalar(input.interviewId),
    canonicalScalar(input.triggeredAt),
  ];

  return crypto
    .createHash("sha256")
    .update(fields.join(DELIM), "utf8")
    .digest("hex");
}

export function buildArchiveDedupeKey(input: {
  webhookEventId: unknown;
  opportunityId: unknown;
  fromArchived: unknown;
  toArchived: unknown;
  triggeredAt: unknown;
}): string {
  const fields = [
    DEDUPE_VERSION,
    "archive_state_change" satisfies IngestEventType,
    canonicalScalar(input.webhookEventId),
    canonicalScalar(input.opportunityId),
    canonicalScalar(input.fromArchived),
    canonicalScalar(input.toArchived),
    canonicalScalar(input.triggeredAt),
  ];

  return crypto
    .createHash("sha256")
    .update(fields.join(DELIM), "utf8")
    .digest("hex");
}

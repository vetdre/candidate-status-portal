function normalizeStage(stage) {
  return String(stage || "").trim().toLowerCase();
}

function asNonEmptyString(value) {
  const s = String(value == null ? "" : value).trim();
  return s || null;
}

function firstString(values) {
  for (const value of values) {
    const s = asNonEmptyString(value);
    if (s) return s;
  }
  return null;
}

const POWER_AUTOMATE_STAGE_MAP = {
  "lead-new": "New Lead",
  "lead-reached-out": "Reached Out",
  "lead-responded": "Responded",
  "applicant-new": "New applicant",
  "7b042735-93c4-4f99-a12d-5c63060f0cb5": "Review",
  "eb4bc7f9-c6d7-4b82-8eb5-ae53ef2940e6": "Phone screen",
  "4d64f338-9d80-41b8-91a1-867835252a3d": "Virtual interview",
  "ec8e09e6-25ee-47e1-a24b-fd43bc1aafa9": "Interview",
  "514e64a3-7600-4e08-a16f-d56fc6d57883": "Second interview",
  "c8bdc4ee-d87a-4102-9ade-a2a199c7b0a8": "Third interview",
  "a1339f72-2853-4465-bedc-4d1fd6dc8efc": "Reference check",
  "c320de36-762d-4f67-9fdd-d875561e2adb": "In progress",
  offer: "Offer",
  "7bac956b-7e4f-4d04-8ed5-d0187274a267": "Background Check",
  "4bde84f8-de25-4dd5-83e0-883f0fe483e0": "Request Phone Screen",
  "f3a6f8ba-4ad7-4fe0-ba59-3775ea5ea8af": "Decline Candidate",
};

const POWER_AUTOMATE_ARCHIVE_REASON_MAP = {
  "cff998ba-a873-474f-9b81-353efb7e2fdf": "Does Not Meet Minimum Requirements",
  "7e360c2b-98ac-4bf9-aaba-7adbda80df24": "Non-Responsive",
  "67a2a47c-0f02-4d21-97c5-3b22c3dcebfe": "Location Does Not Work",
  "5ef42b7b-0842-4c3f-bf73-aa666c92bdda": "Withdrew Application",
  "682434eb-29c4-49c2-8bf2-08f2eba9d8c6": "Declined Offer",
  "28df8038-1352-47d6-8d9e-ad9d858fc930": "Position Closed or On Hold",
  "065bdabc-f3ac-4bf3-8f95-368a0193996a": "Hired",
  "0a7b5763-557e-4384-ba80-22a03d0182e6": "Another Candidate Selected",
  "79f0bf1d-e968-40f8-93fd-54230773b561": "Hold - Future Consideration",
  "945c66de-c091-4ec2-9e10-13cb5d3a39bd": "Not Eligible For US Work Without Sponsorship",
  "307d0439-73ed-4bad-a78d-e4d4465c54fe": "Assigned to different position",
  "70359e5f-c78a-476f-80e3-c980a7b0e53c": "Salary expectations are out of range",
  "ff6c0a92-6c89-4fd4-9491-5b55a6f8d28b": "Offer Rescinded",
  "fa0cba21-1784-4d3a-a361-2235c3d423a9": "Archived - Other",
};

function normalizePowerAutomateStage(raw) {
  const token = asNonEmptyString(raw);
  if (!token) return null;

  const mapped = POWER_AUTOMATE_STAGE_MAP[token.toLowerCase()];
  return mapped || token;
}

function normalizeArchiveReason(raw) {
  const token = asNonEmptyString(raw);
  if (!token) return null;

  const mapped = POWER_AUTOMATE_ARCHIVE_REASON_MAP[token.toLowerCase()];
  return mapped || token;
}

function resolveCurrentStageLabel(stage) {
  if (typeof stage === "string") return normalizePowerAutomateStage(stage);
  if (!stage || typeof stage !== "object") return null;

  const raw = firstString([
    stage.text,
    stage.name,
    stage.label,
    stage.value,
    stage.id,
  ]);

  return normalizePowerAutomateStage(raw);
}

function resolvePositionLabel(position) {
  if (typeof position === "string") return asNonEmptyString(position);
  if (!position || typeof position !== "object") return null;

  return firstString([
    position.text,
    position.name,
    position.title,
    position.label,
    position.id,
  ]);
}

function resolveContactName(contact) {
  if (!contact || typeof contact !== "object") return null;
  return firstString([contact.name, contact.fullName]);
}

function resolveContactEmail(source) {
  if (!source || typeof source !== "object") return null;

  const first = Array.isArray(source.emails) ? source.emails[0] : null;
  if (typeof first === "string") return asNonEmptyString(first);

  return firstString([
    first?.value,
    first?.email,
    first?.address,
    source.email,
  ]);
}

function resolveContactPhone(source) {
  if (!source || typeof source !== "object") return null;

  const first = Array.isArray(source.phones) ? source.phones[0] : null;
  if (typeof first === "string") return asNonEmptyString(first);

  return firstString([
    first?.value,
    first?.phone,
    first?.number,
    source.phone,
  ]);
}

function resolveContactId(source) {
  if (!source || typeof source !== "object") return null;

  return firstString([
    source.id,
    source.candidateId,
    source.candidate_id,
    source.uuid,
  ]);
}

function resolveTagsFromSource(source) {
  if (!Array.isArray(source)) return [];
  const tags = [];

  for (const item of source) {
    const tag =
      typeof item === "string"
        ? asNonEmptyString(item)
        : firstString([item?.text, item?.name, item?.label, item?.value, item?.id]);
    if (tag) tags.push(tag);
  }

  return tags;
}

function resolveOpportunityTags(opp) {
  const merged = [
    ...resolveTagsFromSource(opp?.tags),
    ...resolveTagsFromSource(opp?.contact?.tags),
    ...resolveTagsFromSource(opp?.candidate?.tags),
  ];

  return [...new Set(merged)];
}

const EXCLUDED_IMPORT_TAGS = new Set([
  "candidateimport1",
  "candidateimport2",
  "candidateimport3",
  "ccandidateimport4",
  "candidateimport5",
  "candidateimport6",
]);

function getExcludedImportTags(tags) {
  const matches = [];
  for (const tag of Array.isArray(tags) ? tags : []) {
    const normalized = String(tag || "").trim().toLowerCase();
    if (normalized && EXCLUDED_IMPORT_TAGS.has(normalized)) {
      matches.push(tag);
    }
  }
  return [...new Set(matches)];
}

function normalizeTagToken(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function resolveSafeLegacyPosition(legacyPosition, tags) {
  const position = asNonEmptyString(legacyPosition);
  if (!position) return null;

  const candidates = new Set();
  for (const tag of Array.isArray(tags) ? tags : []) {
    const token = normalizeTagToken(tag);
    if (!token) continue;
    candidates.add(token);
    candidates.add(token.replace(/\+/g, " "));
  }

  const normalizedPosition = normalizeTagToken(position);
  const normalizedPositionSpace = normalizedPosition.replace(/\+/g, " ");
  if (candidates.has(normalizedPosition) || candidates.has(normalizedPositionSpace)) {
    return null;
  }

  return position;
}

function resolvePortalStageFields(input) {
  const stage = normalizeStage(input.currentStage);
  const reason = String(input.archiveReason || "").trim().toLowerCase();
  const archived = !!input.archived;

  if (archived && (reason === "hired" || reason.includes("hire"))) {
    return { portal_stage: "Hired", portal_stage_order: 99, portal_stage_terminal: true };
  }

  if (archived && reason !== "hired") {
    return {
      portal_stage: "Application Closed",
      portal_stage_order: 0,
      portal_stage_terminal: true,
    };
  }

  if (stage === "decline candidate") {
    return {
      portal_stage: "Application Closed",
      portal_stage_order: 0,
      portal_stage_terminal: true,
    };
  }

  if (stage === "new applicant") {
    return {
      portal_stage: "Application Received",
      portal_stage_order: 10,
      portal_stage_terminal: false,
    };
  }

  if (stage === "review" || stage === "request phone screen") {
    return { portal_stage: "Under Review", portal_stage_order: 20, portal_stage_terminal: false };
  }

  if (
    stage === "phone screen" ||
    stage === "virtual interview" ||
    stage === "interview" ||
    stage === "second interview" ||
    stage === "third interview"
  ) {
    return { portal_stage: "Interviewing", portal_stage_order: 30, portal_stage_terminal: false };
  }

  if (stage === "reference check" || stage === "requisition" || stage === "in progress") {
    return {
      portal_stage: "Decision in Progress",
      portal_stage_order: 40,
      portal_stage_terminal: false,
    };
  }

  if (stage === "offer" || stage === "background check" || stage === "asurint background screening") {
    return { portal_stage: "Offer Extended", portal_stage_order: 50, portal_stage_terminal: false };
  }

  if (stage === "new lead" || stage === "reached out" || stage === "responded") {
    return { portal_stage: null, portal_stage_order: null, portal_stage_terminal: false };
  }

  return { portal_stage: "Under Review", portal_stage_order: 20, portal_stage_terminal: false };
}

function resolveNextInterviewUtc(interviews, nowMs) {
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();

  const timestamps = (Array.isArray(interviews) ? interviews : [])
    .filter((x) => x && x.canceledAt == null)
    .map((x) => Number(x.date || 0))
    .filter((t) => Number.isFinite(t) && t > now)
    .sort((a, b) => a - b);

  if (timestamps.length === 0) return null;
  return new Date(timestamps[0]).toISOString();
}

function nowIsoUtcSeconds() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function resolveTimestampToIso(value) {
  if (value == null) return null;

  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    const asMs = numeric > 1e12 ? numeric : numeric > 1e9 ? numeric * 1000 : null;
    if (asMs) {
      const d = new Date(asMs);
      if (!Number.isNaN(d.getTime())) return d.toISOString();
    }
  }

  const parsed = Date.parse(String(value));
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString();
}

function resolveAppliedAtUtc(opportunity, fallbacks = []) {
  const raw = firstString([
    opportunity?.createdAt,
    opportunity?.created,
    opportunity?.appliedAt,
    opportunity?.applied_at,
    ...(Array.isArray(fallbacks) ? fallbacks : []),
  ]);
  return resolveTimestampToIso(raw);
}

function resolveStageUpdatedAtUtc(opportunity, fallbacks = []) {
  const raw = firstString([
    opportunity?.stage?.updatedAt,
    opportunity?.stage?.updated_at,
    opportunity?.stage?.changedAt,
    opportunity?.stage?.changed_at,
    opportunity?.stageUpdatedAt,
    opportunity?.stage_updated_at,
    opportunity?.updatedAt,
    opportunity?.updated,
    ...(Array.isArray(fallbacks) ? fallbacks : []),
  ]);
  return resolveTimestampToIso(raw);
}

module.exports = {
  resolvePortalStageFields,
  resolveNextInterviewUtc,
  nowIsoUtcSeconds,
  resolveAppliedAtUtc,
  resolveStageUpdatedAtUtc,
  resolveCurrentStageLabel,
  normalizeArchiveReason,
  resolvePositionLabel,
  resolveContactName,
  resolveContactEmail,
  resolveContactPhone,
  resolveContactId,
  resolveOpportunityTags,
  getExcludedImportTags,
  resolveSafeLegacyPosition,
};

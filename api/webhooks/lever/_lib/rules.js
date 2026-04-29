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

function resolveCurrentStageLabel(stage) {
  if (typeof stage === "string") return asNonEmptyString(stage);
  if (!stage || typeof stage !== "object") return null;

  return firstString([
    stage.text,
    stage.name,
    stage.label,
    stage.value,
    stage.id,
  ]);
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

  if (stage === "reference check" || stage === "requisition") {
    return {
      portal_stage: "Decision in Progress",
      portal_stage_order: 40,
      portal_stage_terminal: false,
    };
  }

  if (stage === "offer" || stage === "background check") {
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

module.exports = {
  resolvePortalStageFields,
  resolveNextInterviewUtc,
  nowIsoUtcSeconds,
  resolveCurrentStageLabel,
  resolvePositionLabel,
  resolveContactName,
  resolveContactEmail,
  resolveContactPhone,
};

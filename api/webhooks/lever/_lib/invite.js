function asNonEmptyString(value) {
  const s = String(value == null ? "" : value).trim();
  return s || null;
}

function normalizeStageToken(stageValue) {
  return String(stageValue == null ? "" : stageValue).trim().toLowerCase();
}

// Lever lead stages as raw ids and as the labels resolveCurrentStageLabel produces for them.
const LEAD_STAGE_TOKENS = new Set(["lead", "new lead", "reached out", "responded"]);

// Applicant-pipeline stages allowed to trigger a portal invite. Anything absent here fails closed.
// Each stage appears as the legacy label rules.js maps the stage id to AND as the Lever display
// name, because resolveCurrentStageLabel prefers stage.text over stage.id on expanded payloads.
// Narrow this set once HR confirms the preferred send point.
const INVITE_ELIGIBLE_STAGE_TOKENS = new Set([
  "new applicant",
  "review",
  "request phone screen",
  "phone screen",
  "virtual interview",
  "interview",
  "second interview",
  "third interview",
  "reference check",
  "in progress",
  "requisition",
  "offer",
  "background check",
  "asurint background screening",
]);

function isLeadStage(stageValue) {
  const stage = normalizeStageToken(stageValue);
  if (!stage) return false;
  if (stage.startsWith("lead-")) return true;
  return LEAD_STAGE_TOKENS.has(stage);
}

function isDeclineStage(stageValue) {
  return normalizeStageToken(stageValue) === "decline candidate";
}

function isInviteEligibleStage(stageValue) {
  const stage = normalizeStageToken(stageValue);
  if (!stage) return false;
  if (isLeadStage(stage) || isDeclineStage(stage)) return false;
  return INVITE_ELIGIBLE_STAGE_TOKENS.has(stage);
}

function evaluateMagicInviteEligibility({
  inviteAlreadySent,
  archived,
  currentStage,
  applicationPhone,
  recipientEmail,
}) {
  const reasons = [];

  if (inviteAlreadySent) reasons.push("invite_already_sent");
  if (archived) reasons.push("archived");
  if (isLeadStage(currentStage)) reasons.push("lead_stage");
  if (isDeclineStage(currentStage)) reasons.push("decline_stage");
  if (!isLeadStage(currentStage) && !isDeclineStage(currentStage) && !isInviteEligibleStage(currentStage)) {
    reasons.push("unrecognized_stage");
  }
  if (!asNonEmptyString(applicationPhone)) reasons.push("missing_valid_application_phone");
  if (!asNonEmptyString(recipientEmail)) reasons.push("missing_recipient_email");

  return {
    shouldSend: reasons.length === 0,
    reasons,
  };
}

module.exports = {
  evaluateMagicInviteEligibility,
  isLeadStage,
  isDeclineStage,
  isInviteEligibleStage,
};

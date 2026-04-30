function asNonEmptyString(value) {
  const s = String(value == null ? "" : value).trim();
  return s || null;
}

function isLeadStage(stageValue) {
  const stage = String(stageValue == null ? "" : stageValue).trim().toLowerCase();
  return stage.startsWith("lead");
}

function evaluateMagicInviteEligibility({
  isNewPortalRecord,
  archived,
  currentStage,
  applicationPhone,
  recipientEmail,
}) {
  const reasons = [];

  if (!isNewPortalRecord) reasons.push("existing_portal_record");
  if (archived) reasons.push("archived");
  if (isLeadStage(currentStage)) reasons.push("lead_stage");
  if (!asNonEmptyString(applicationPhone)) reasons.push("missing_valid_application_phone");
  if (!asNonEmptyString(recipientEmail)) reasons.push("missing_recipient_email");

  return {
    shouldSend: reasons.length === 0,
    reasons,
  };
}

module.exports = {
  evaluateMagicInviteEligibility,
};

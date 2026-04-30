function asNonEmptyString(value) {
  const s = String(value == null ? "" : value).trim();
  return s || null;
}

function isLeadStage(stageValue) {
  const stage = String(stageValue == null ? "" : stageValue).trim().toLowerCase();
  return stage.startsWith("lead");
}

function isDeclineStage(stageValue) {
  const stage = String(stageValue == null ? "" : stageValue).trim().toLowerCase();
  return stage === "decline candidate";
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
};

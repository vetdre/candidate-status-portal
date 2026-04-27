import { env } from "../config/env.js";

function normEventName(eventName: unknown): string {
  return String(eventName || "")
    .trim()
    .toLowerCase();
}

export function getExpectedWebhookSecret(eventName: unknown): string | null {
  const e = normEventName(eventName);

  if (e.includes("application") && e.includes("created")) {
    return env.leverWebhookSecretApplicationCreated ?? env.leverWebhookSecretDefault;
  }

  if (e.includes("candidate") && e.includes("stage")) {
    return env.leverWebhookSecretCandidateStageChange ?? env.leverWebhookSecretDefault;
  }

  if (e.includes("candidate") && e.includes("archive")) {
    return (
      env.leverWebhookSecretCandidateArchiveStateChange ?? env.leverWebhookSecretDefault
    );
  }

  if (e.includes("interview") && e.includes("created")) {
    return env.leverWebhookSecretInterviewCreated ?? env.leverWebhookSecretDefault;
  }

  if (e.includes("interview") && e.includes("updated")) {
    return env.leverWebhookSecretInterviewUpdated ?? env.leverWebhookSecretDefault;
  }

  if (e.includes("interview") && e.includes("deleted")) {
    return env.leverWebhookSecretInterviewDeleted ?? env.leverWebhookSecretDefault;
  }

  return env.leverWebhookSecretDefault;
}

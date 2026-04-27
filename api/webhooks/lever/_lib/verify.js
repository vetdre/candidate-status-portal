const crypto = require("crypto");

function secureEqualHex(a, b) {
  const left = Buffer.from(String(a || "").trim().toLowerCase(), "utf8");
  const right = Buffer.from(String(b || "").trim().toLowerCase(), "utf8");
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function verifyWebhookEnvelope(body, expectedSecret, mode) {
  const signature = String(body?.signature || "").trim();
  const token = String(body?.token || "").trim();
  const triggeredAt = body?.triggeredAt;

  if (!expectedSecret) {
    return { ok: false, reason: "Missing configured webhook secret for event" };
  }

  if (!signature || !token) {
    return { ok: false, reason: "Missing signature or token in webhook body" };
  }

  if (mode === "hmac_sha256") {
    if (triggeredAt == null || triggeredAt === "") {
      return { ok: false, reason: "Missing triggeredAt in webhook body" };
    }

    const plainText = `${token}${triggeredAt}`;
    const expectedSignature = crypto
      .createHmac("sha256", expectedSecret)
      .update(plainText)
      .digest("hex");

    if (!secureEqualHex(signature, expectedSignature)) {
      return { ok: false, reason: "Webhook signature does not match configured secret" };
    }

    return { ok: true };
  }

  if (mode === "token_equals_secret") {
    if (token !== expectedSecret) {
      return { ok: false, reason: "Webhook token does not match configured secret" };
    }
    return { ok: true };
  }

  // Explicitly fail closed for unsupported verification modes.
  return {
    ok: false,
    reason: `Unsupported LEVER_WEBHOOK_VERIFY_MODE: ${mode}. Supported: hmac_sha256, token_equals_secret`,
  };
}

module.exports = {
  verifyWebhookEnvelope,
};

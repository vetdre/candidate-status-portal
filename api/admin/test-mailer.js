const {
  sendMagicLinkInvite,
  getMagicLinkMailerConfig,
  isMagicLinkMailerReady,
} = require("../webhooks/lever/_lib/mailer");

function json(res, status, body) {
  return res.status(status).json(body);
}

function extractBearerToken(req) {
  const header = String(req.headers?.authorization || "").trim();
  if (!header.toLowerCase().startsWith("bearer ")) return null;
  const token = header.slice(7).trim();
  return token || null;
}

function isNonEmptyString(value) {
  return String(value == null ? "" : value).trim().length > 0;
}

module.exports = async (req, res) => {
  try {
    if (req.method === "OPTIONS") {
      res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
      return res.status(204).end();
    }

    if (req.method !== "POST") {
      return json(res, 405, { ok: false, error: "Method not allowed" });
    }

    const configuredSecret = String(process.env.MAILER_TEST_SECRET || "").trim();
    if (!configuredSecret) {
      return json(res, 500, { ok: false, error: "Missing MAILER_TEST_SECRET" });
    }

    const authToken = extractBearerToken(req);
    if (!authToken || authToken !== configuredSecret) {
      return json(res, 401, { ok: false, error: "Unauthorized" });
    }

    const cfg = getMagicLinkMailerConfig();
    const ready = isMagicLinkMailerReady(cfg);
    if (!ready) {
      return json(res, 500, {
        ok: false,
        error: "Mailer not configured",
        config: {
          hasTenantId: isNonEmptyString(cfg.tenantId),
          hasClientId: isNonEmptyString(cfg.clientId),
          hasClientSecret: isNonEmptyString(cfg.clientSecret),
          hasSenderEmail: isNonEmptyString(cfg.senderEmail),
          hasPortalBaseUrl: isNonEmptyString(cfg.portalBaseUrl),
          dryRun: !!cfg.dryRun,
        },
      });
    }

    const recipientEmail = String(req.body?.recipientEmail || "dvetrano@msconsultants.com").trim();
    const candidateName = String(req.body?.candidateName || "Drew").trim();
    const positionApplied = String(req.body?.positionApplied || "Engineering").trim();
    const magicToken = String(req.body?.magicToken || "smoke-test-token").trim();

    const result = await sendMagicLinkInvite({
      recipientEmail,
      candidateName,
      positionApplied,
      magicToken,
    });

    return json(res, 200, {
      ok: true,
      message: "Mailer smoke test executed",
      dryRun: !!cfg.dryRun,
      result,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return json(res, 500, { ok: false, error: "Mailer smoke test failed", details: msg });
  }
};

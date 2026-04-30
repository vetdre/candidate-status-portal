function asNonEmptyString(value) {
  const s = String(value == null ? "" : value).trim();
  return s || null;
}

function asBooleanEnv(value, fallback) {
  const s = String(value == null ? "" : value).trim().toLowerCase();
  if (!s) return fallback;
  if (["1", "true", "yes", "y", "on"].includes(s)) return true;
  if (["0", "false", "no", "n", "off"].includes(s)) return false;
  return fallback;
}

function getMagicLinkMailerConfig() {
  const tenantId = asNonEmptyString(process.env.GRAPH_TENANT_ID);
  const clientId = asNonEmptyString(process.env.GRAPH_CLIENT_ID);
  const clientSecret = asNonEmptyString(process.env.GRAPH_CLIENT_SECRET);
  const senderEmail = asNonEmptyString(process.env.MAGIC_LINK_FROM_EMAIL) ||
    asNonEmptyString(process.env.GRAPH_SENDER_EMAIL);
  const portalBaseUrl = asNonEmptyString(process.env.PORTAL_BASE_URL);
  const portalPath = asNonEmptyString(process.env.MAGIC_LINK_PATH) || "/";
  const dryRun = asBooleanEnv(process.env.MAGIC_LINK_EMAIL_DRY_RUN, true);
  const forceRecipientEmail = asNonEmptyString(process.env.MAGIC_LINK_FORCE_RECIPIENT_EMAIL);

  return {
    tenantId,
    clientId,
    clientSecret,
    senderEmail,
    portalBaseUrl,
    portalPath,
    dryRun,
    forceRecipientEmail,
  };
}

function getGraphMailerConfig() {
  const magicCfg = getMagicLinkMailerConfig();
  return {
    tenantId: magicCfg.tenantId,
    clientId: magicCfg.clientId,
    clientSecret: magicCfg.clientSecret,
    senderEmail: magicCfg.senderEmail,
  };
}

function isMagicLinkMailerReady(cfg) {
  if (!cfg) return false;
  return !!(cfg.tenantId && cfg.clientId && cfg.clientSecret && cfg.senderEmail && cfg.portalBaseUrl);
}

function isGraphMailerReady(cfg) {
  if (!cfg) return false;
  return !!(cfg.tenantId && cfg.clientId && cfg.clientSecret && cfg.senderEmail);
}

function buildMagicLinkUrl(cfg, magicToken) {
  const base = new URL(cfg.portalPath || "/", cfg.portalBaseUrl);
  base.searchParams.set("token", String(magicToken));
  return base.toString();
}

function splitRecipientList(value) {
  return String(value == null ? "" : value)
    .split(/[;,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function fetchGraphAccessToken(cfg) {
  const tokenUrl = `https://login.microsoftonline.com/${encodeURIComponent(cfg.tenantId)}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    scope: "https://graph.microsoft.com/.default",
  });

  const resp = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Graph token request failed: ${resp.status} ${resp.statusText} :: ${text}`);
  }

  const payload = await resp.json().catch(() => ({}));
  const token = asNonEmptyString(payload.access_token);
  if (!token) throw new Error("Graph token response missing access_token");
  return token;
}

function buildInviteEmailHtml({ candidateName, magicLink }) {
  const safeName = asNonEmptyString(candidateName) || "there";
  return [
    `<p>Hi ${safeName},</p>`,
    "<p>Your candidate portal is ready.</p>",
    `<p><a href=\"${magicLink}\">Open your portal</a></p>`,
    "<p>This link is personalized for your application.</p>",
  ].join("");
}

function buildInviteEmailText({ candidateName, magicLink }) {
  const safeName = asNonEmptyString(candidateName) || "there";
  return [
    `Hi ${safeName},`,
    "",
    "Your candidate portal is ready.",
    `Open your portal: ${magicLink}`,
    "",
    "This link is personalized for your application.",
  ].join("\n");
}

async function sendGraphMail({ cfg, to, subject, htmlContent, textContent }) {
  if (!isGraphMailerReady(cfg)) {
    return {
      attempted: false,
      sent: false,
      reason: "mailer_not_configured",
    };
  }

  const recipientList = Array.isArray(to) ? to.map(asNonEmptyString).filter(Boolean) : [];
  if (!recipientList.length) {
    return {
      attempted: false,
      sent: false,
      reason: "missing_recipient",
    };
  }

  const accessToken = await fetchGraphAccessToken(cfg);
  const sendUrl = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(cfg.senderEmail)}/sendMail`;
  const mailPayload = {
    message: {
      subject,
      body: {
        contentType: "HTML",
        content: htmlContent,
      },
      toRecipients: recipientList.map((address) => ({ emailAddress: { address } })),
    },
    saveToSentItems: "true",
  };

  const resp = await fetch(sendUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(mailPayload),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Graph sendMail failed: ${resp.status} ${resp.statusText} :: ${text}`);
  }

  return {
    attempted: true,
    sent: true,
    reason: null,
    preview: {
      to: recipientList,
      from: cfg.senderEmail,
      subject,
      text: textContent,
    },
  };
}

function getMonitoringAlertConfig() {
  return {
    ...getGraphMailerConfig(),
    recipientEmails: splitRecipientList(
      process.env.MONITOR_ALERT_RECIPIENTS || process.env.MONITOR_ALERT_EMAIL || ""
    ),
    dryRun: asBooleanEnv(process.env.MONITOR_ALERT_EMAIL_DRY_RUN, false),
  };
}

function isMonitoringAlertReady(cfg) {
  return !!(cfg && isGraphMailerReady(cfg) && Array.isArray(cfg.recipientEmails) && cfg.recipientEmails.length);
}

function buildMonitoringAlertHtml({ summary, lines }) {
  const safeLines = Array.isArray(lines) ? lines : [];
  return [
    `<p>${escapeHtml(summary)}</p>`,
    "<ul>",
    ...safeLines.map((line) => `<li>${escapeHtml(line)}</li>`),
    "</ul>",
  ].join("");
}

function buildMonitoringAlertText({ summary, lines }) {
  const safeLines = Array.isArray(lines) ? lines : [];
  return [summary, "", ...safeLines.map((line) => `- ${line}`)].join("\n");
}

async function sendMonitoringAlertEmail({ subject, summary, lines }) {
  const cfg = getMonitoringAlertConfig();
  if (!isMonitoringAlertReady(cfg)) {
    return {
      attempted: false,
      sent: false,
      reason: "monitor_alert_not_configured",
    };
  }

  const textContent = buildMonitoringAlertText({ summary, lines });
  const htmlContent = buildMonitoringAlertHtml({ summary, lines });

  if (cfg.dryRun) {
    return {
      attempted: true,
      sent: false,
      reason: "dry_run",
      preview: {
        to: cfg.recipientEmails,
        from: cfg.senderEmail,
        subject,
        text: textContent,
      },
    };
  }

  return sendGraphMail({
    cfg,
    to: cfg.recipientEmails,
    subject,
    htmlContent,
    textContent,
  });
}

async function sendMagicLinkInvite({ recipientEmail, candidateName, magicToken }) {
  const cfg = getMagicLinkMailerConfig();
  if (!isMagicLinkMailerReady(cfg)) {
    return {
      attempted: false,
      sent: false,
      reason: "mailer_not_configured",
    };
  }

  const requestedRecipient = asNonEmptyString(recipientEmail);
  const to = cfg.forceRecipientEmail || requestedRecipient;
  if (!to) {
    return {
      attempted: false,
      sent: false,
      reason: "missing_recipient",
    };
  }

  const magicLink = buildMagicLinkUrl(cfg, magicToken);
  if (cfg.dryRun) {
    return {
      attempted: true,
      sent: false,
      reason: "dry_run",
      preview: {
        to,
        requestedRecipient,
        from: cfg.senderEmail,
        subject: "Your Candidate Portal Link",
        magicLink,
        forcedRecipient: !!cfg.forceRecipientEmail,
      },
    };
  }

  const result = await sendGraphMail({
    cfg,
    to: [to],
    subject: "Your Candidate Portal Link",
    htmlContent: buildInviteEmailHtml({ candidateName, magicLink }),
    textContent: buildInviteEmailText({ candidateName, magicLink }),
  });

  return {
    ...result,
    preview: {
      ...(result.preview || {}),
      to,
      requestedRecipient,
      from: cfg.senderEmail,
      subject: "Your Candidate Portal Link",
      magicLink,
      text: buildInviteEmailText({ candidateName, magicLink }),
      forcedRecipient: !!cfg.forceRecipientEmail,
    },
  };
}

module.exports = {
  getGraphMailerConfig,
  getMagicLinkMailerConfig,
  getMonitoringAlertConfig,
  isGraphMailerReady,
  isMagicLinkMailerReady,
  isMonitoringAlertReady,
  sendMonitoringAlertEmail,
  sendMagicLinkInvite,
};

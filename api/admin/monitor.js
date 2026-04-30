const { config } = require("../webhooks/lever/_lib/env");
const {
  getMonitoringAlertConfig,
  isMonitoringAlertReady,
  sendMonitoringAlertEmail,
} = require("../webhooks/lever/_lib/mailer");

const CHECK_NAMES = {
  cron: "cron_refresh",
  ingest: "ingest_failures",
  freshness: "portal_freshness",
};

function json(res, status, body) {
  return res.status(status).json(body);
}

function extractBearerToken(req) {
  const header = String(req.headers?.authorization || "").trim();
  if (!header.toLowerCase().startsWith("bearer ")) return null;
  const token = header.slice(7).trim();
  return token || null;
}

function asPositiveInt(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

function toIsoCutoffMinutes(minutes) {
  return new Date(Date.now() - minutes * 60 * 1000).toISOString();
}

function toIsoCutoffHours(hours) {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

function diffMinutes(isoValue) {
  const ts = Date.parse(String(isoValue || ""));
  if (!Number.isFinite(ts)) return null;
  return Math.floor((Date.now() - ts) / 60000);
}

function monitorConfig() {
  return {
    ...config(),
    authToken:
      String(process.env.MONITOR_SECRET || process.env.CRON_SECRET || "").trim() || null,
    ingestLookbackMinutes: asPositiveInt(process.env.MONITOR_INGEST_LOOKBACK_MINUTES, 60),
    ingestFailureThreshold: asPositiveInt(process.env.MONITOR_INGEST_FAILURE_THRESHOLD, 5),
    cronMaxAgeHours: asPositiveInt(process.env.MONITOR_CRON_MAX_AGE_HOURS, 30),
    freshnessLookbackHours: asPositiveInt(process.env.MONITOR_FRESHNESS_LOOKBACK_HOURS, 48),
    alertCooldownMinutes: asPositiveInt(process.env.MONITOR_ALERT_COOLDOWN_MINUTES, 120),
  };
}

async function supabaseAdminFetch(path, cfg) {
  const resp = await fetch(`${cfg.supabaseUrl}${path}`, {
    method: "GET",
    headers: {
      apikey: cfg.serviceRole,
      Authorization: `Bearer ${cfg.serviceRole}`,
    },
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Supabase monitor query failed: ${resp.status} ${resp.statusText} :: ${text}`);
  }

  return resp.json().catch(() => []);
}

async function upsertMonitorAlertState(row, cfg) {
  const resp = await fetch(`${cfg.supabaseUrl}/rest/v1/monitor_alert_state?on_conflict=check_name`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
      apikey: cfg.serviceRole,
      Authorization: `Bearer ${cfg.serviceRole}`,
    },
    body: JSON.stringify(row),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Monitor alert state upsert failed: ${resp.status} ${resp.statusText} :: ${text}`);
  }
}

async function loadAlertState(cfg) {
  const rows = await supabaseAdminFetch(
    `/rest/v1/monitor_alert_state?select=check_name,last_status,last_alert_sent_at,last_summary,last_evaluated_at`,
    cfg
  );
  const map = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (row?.check_name) map.set(String(row.check_name), row);
  }
  return map;
}

async function evaluateCronCheck(cfg) {
  const rows = await supabaseAdminFetch(
    `/rest/v1/cron_refresh_state?job_name=eq.${encodeURIComponent("candidates_shadow_refresh")}&select=job_name,updated_at,phase&limit=1`,
    cfg
  );
  const row = Array.isArray(rows) && rows.length ? rows[0] : null;
  const ageMinutes = diffMinutes(row?.updated_at);
  const maxAgeMinutes = cfg.cronMaxAgeHours * 60;
  const ok = !!(row && ageMinutes != null && ageMinutes <= maxAgeMinutes);

  return {
    name: CHECK_NAMES.cron,
    ok,
    summary: ok
      ? `Cron checkpoint updated ${ageMinutes} minute(s) ago`
      : row
        ? `Cron checkpoint is stale at ${ageMinutes} minute(s) old`
        : "Cron checkpoint row is missing",
    details: {
      updatedAt: row?.updated_at || null,
      phase: row?.phase || null,
      ageMinutes,
      maxAgeMinutes,
    },
  };
}

async function evaluateIngestCheck(cfg) {
  const cutoff = toIsoCutoffMinutes(cfg.ingestLookbackMinutes);
  const rows = await supabaseAdminFetch(
    `/rest/v1/ingest_events?select=id,event_type,processed_at,process_error&process_status=eq.failed&processed_at=gte.${encodeURIComponent(cutoff)}&order=processed_at.desc&limit=20`,
    cfg
  );
  const failures = Array.isArray(rows) ? rows : [];
  const ok = failures.length < cfg.ingestFailureThreshold;

  return {
    name: CHECK_NAMES.ingest,
    ok,
    summary: ok
      ? `${failures.length} failed ingest event(s) in the last ${cfg.ingestLookbackMinutes} minute(s)`
      : `${failures.length} failed ingest event(s) in the last ${cfg.ingestLookbackMinutes} minute(s)`,
    details: {
      failureCount: failures.length,
      threshold: cfg.ingestFailureThreshold,
      lookbackMinutes: cfg.ingestLookbackMinutes,
      recentFailures: failures.slice(0, 5).map((row) => ({
        eventType: row?.event_type || null,
        processedAt: row?.processed_at || null,
        processError: row?.process_error || null,
      })),
    },
  };
}

async function evaluateFreshnessCheck(cfg) {
  const cutoff = toIsoCutoffHours(cfg.freshnessLookbackHours);
  const rows = await supabaseAdminFetch(
    `/rest/v1/portal_freshness_monitor_v1?select=lever_id,portal_last_viewed_at,freshness_status,minutes_stale_at_last_view&portal_last_viewed_at=gte.${encodeURIComponent(cutoff)}&freshness_status=neq.${encodeURIComponent("up_to_date_at_last_view")}&order=portal_last_viewed_at.desc&limit=20`,
    cfg
  );
  const staleRows = Array.isArray(rows) ? rows : [];
  const ok = staleRows.length === 0;

  return {
    name: CHECK_NAMES.freshness,
    ok,
    summary: ok
      ? `No stale recently viewed portal records in the last ${cfg.freshnessLookbackHours} hour(s)`
      : `${staleRows.length} stale recently viewed portal record(s) found`,
    details: {
      staleCount: staleRows.length,
      lookbackHours: cfg.freshnessLookbackHours,
      examples: staleRows.slice(0, 5),
    },
  };
}

function shouldSendAlert(previousRow, check, cooldownMinutes) {
  if (check.ok) return false;
  if (!previousRow) return true;
  if (String(previousRow.last_status || "") !== "alert") return true;
  const minutesSinceLastAlert = diffMinutes(previousRow.last_alert_sent_at);
  if (minutesSinceLastAlert == null) return true;
  return minutesSinceLastAlert >= cooldownMinutes;
}

function formatAlertLines(failingChecks) {
  return failingChecks.flatMap((check) => {
    if (check.name === CHECK_NAMES.cron) {
      return [`Cron refresh issue: ${check.summary}`];
    }
    if (check.name === CHECK_NAMES.ingest) {
      return [
        `Ingest failures above threshold: ${check.details.failureCount} in ${check.details.lookbackMinutes} minute(s)`,
      ];
    }
    if (check.name === CHECK_NAMES.freshness) {
      return [
        `Portal freshness issue: ${check.details.staleCount} stale recently viewed record(s)`,
      ];
    }
    return [check.summary];
  });
}

module.exports = async (req, res) => {
  try {
    if (req.method === "OPTIONS") {
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
      return res.status(204).end();
    }

    if (req.method !== "GET" && req.method !== "POST") {
      return json(res, 405, { ok: false, error: "Method not allowed" });
    }

    const cfg = monitorConfig();
    if (cfg.authToken) {
      const authToken = extractBearerToken(req);
      if (!authToken || authToken !== cfg.authToken) {
        return json(res, 401, { ok: false, error: "Unauthorized" });
      }
    }

    const [cronCheck, ingestCheck, freshnessCheck, alertState] = await Promise.all([
      evaluateCronCheck(cfg),
      evaluateIngestCheck(cfg),
      evaluateFreshnessCheck(cfg),
      loadAlertState(cfg),
    ]);

    const checks = [cronCheck, ingestCheck, freshnessCheck];
    const failingChecks = checks.filter((check) => !check.ok);
    const alertCfg = getMonitoringAlertConfig();
    const canSendAlerts = isMonitoringAlertReady(alertCfg);
    const checksNeedingAlert = failingChecks.filter((check) =>
      shouldSendAlert(alertState.get(check.name), check, cfg.alertCooldownMinutes)
    );

    let alertResult = {
      attempted: false,
      sent: false,
      reason: canSendAlerts ? "no_alert_needed" : "monitor_alert_not_configured",
    };

    if (checksNeedingAlert.length && canSendAlerts) {
      alertResult = await sendMonitoringAlertEmail({
        subject: `[Candidate Portal] Monitor alert: ${checksNeedingAlert.map((check) => check.name).join(", ")}`,
        summary: `${checksNeedingAlert.length} monitor check(s) are failing`,
        lines: formatAlertLines(checksNeedingAlert),
      });
    }

    const nowIso = new Date().toISOString();
    await Promise.all(
      checks.map((check) =>
        upsertMonitorAlertState(
          {
            check_name: check.name,
            last_status: check.ok ? "ok" : "alert",
            last_summary: check.summary,
            last_evaluated_at: nowIso,
            ...(checksNeedingAlert.some((candidate) => candidate.name === check.name) && alertResult.sent
              ? { last_alert_sent_at: nowIso }
              : {}),
          },
          cfg
        )
      )
    );

    return json(res, failingChecks.length ? 503 : 200, {
      ok: failingChecks.length === 0,
      checkedAt: nowIso,
      alerts: {
        configured: canSendAlerts,
        cooldownMinutes: cfg.alertCooldownMinutes,
        result: alertResult,
      },
      checks,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return json(res, 500, { ok: false, error: "Monitor execution failed", details: msg });
  }
};
const { config } = require("./webhooks/lever/_lib/env");

function json(res, status, body) {
  return res.status(status).json(body);
}

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
    return res.status(204).end();
  }

  if (req.method !== "GET") {
    return json(res, 405, { ok: false, error: "Method not allowed" });
  }

  let cfg;
  try {
    cfg = config();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return json(res, 503, {
      ok: false,
      status: "degraded",
      checkedAt: new Date().toISOString(),
      error: msg,
    });
  }

  try {
    const resp = await fetch(
      `${cfg.supabaseUrl}/rest/v1/ingest_events?select=id&limit=1`,
      {
        method: "GET",
        headers: {
          apikey: cfg.serviceRole,
          Authorization: `Bearer ${cfg.serviceRole}`,
        },
      }
    );

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`Supabase health check failed: ${resp.status} ${resp.statusText} :: ${text}`);
    }

    return json(res, 200, {
      ok: true,
      status: "ok",
      checkedAt: new Date().toISOString(),
      checks: {
        api: "ok",
        supabase: "ok",
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return json(res, 503, {
      ok: false,
      status: "degraded",
      checkedAt: new Date().toISOString(),
      checks: {
        api: "ok",
        supabase: "failed",
      },
      error: msg,
    });
  }
};
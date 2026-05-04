// api/get-offer-url.js
//
// Generates a signed, 1-hour download URL for a candidate's offer letter.
//
// Behavior:
// - Validates identity via token + lastName + phone10 (same inputs as portal-status).
// - Resolves person_key from magic_token (people table).
// - Finds the best application row with an offer (offer_letter_key or offer_access).
// - Supports legacy keys like "offer_{opportunityId}.pdf" by listing Storage under "{opportunityId}/"
//   and selecting the newest PDF automatically.
// - Signs the resolved object in Supabase Storage bucket: "offer-letters".
//
// NOTE:
// - Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Vercel env.
// - This is server-side only (service role must never be exposed to the browser).

const TOKEN_FAIL_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const TOKEN_FAIL_LIMIT = 5;
const { normalizePhone10, normalizeLastName } = require("./webhooks/lever/_lib/identity");

const tokenFailBuckets = globalThis.__tokenFailBuckets ?? new Map();
globalThis.__tokenFailBuckets = tokenFailBuckets;

function _now() {
  return Date.now();
}

function isTokenBlocked(token) {
  const key = String(token || "").trim();
  if (!key) return false;

  const arr = tokenFailBuckets.get(key);
  if (!arr || arr.length === 0) return false;

  const cutoff = _now() - TOKEN_FAIL_WINDOW_MS;
  const recent = arr.filter((ts) => ts >= cutoff);

  if (recent.length === 0) {
    tokenFailBuckets.delete(key);
    return false;
  }

  tokenFailBuckets.set(key, recent);
  return recent.length >= TOKEN_FAIL_LIMIT;
}

function registerTokenFailure(token) {
  const key = String(token || "").trim();
  if (!key) return 0;

  const cutoff = _now() - TOKEN_FAIL_WINDOW_MS;
  const arr = (tokenFailBuckets.get(key) ?? []).filter((ts) => ts >= cutoff);
  arr.push(_now());

  tokenFailBuckets.set(key, arr);
  return arr.length;
}

function clearTokenFailures(token) {
  const key = String(token || "").trim();
  if (!key) return;
  tokenFailBuckets.delete(key);
}

function json(res, status, body) {
  return res.status(status).json(body);
}

async function supaFetch(url, opts, SUPABASE_URL, SERVICE_ROLE) {
  const resp = await fetch(url, {
    ...opts,
    headers: {
      ...(opts.headers || {}),
      apikey: SERVICE_ROLE,
      Authorization: `Bearer ${SERVICE_ROLE}`,
    },
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    const err = new Error(`Supabase request failed: ${resp.status} ${resp.statusText} :: ${text}`);
    err.status = resp.status;
    err.details = text;
    throw err;
  }

  return resp;
}

function pickBestOfferRow(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return null;

  // Prefer rows that explicitly have offer_access true, then those with offer_letter_key,
  // and pick most recently updated/created.
  const scored = rows.map((r) => {
    const offerAccess = !!r.offer_access;
    const hasKey = !!(r.offer_letter_key && String(r.offer_letter_key).trim());
    const stageUpdated = r.stage_updated ? new Date(r.stage_updated).getTime() : 0;
    const createdAt = r.created_at ? new Date(r.created_at).getTime() : 0;
    const recency = Math.max(stageUpdated, createdAt);

    const score =
      (offerAccess ? 1000 : 0) +
      (hasKey ? 100 : 0) +
      (recency ? Math.min(99, Math.floor(recency / 1000000000)) : 0);

    return { r, score, recency };
  });

  scored.sort((a, b) => (b.score - a.score) || (b.recency - a.recency));
  return scored[0].r;
}

async function resolveStorageKeyFromRow(row, SUPABASE_URL, SERVICE_ROLE) {
  const rawKey = String(row.offer_letter_key || "").trim();

  // New/canonical format: "{opportunityId}/{offerId}_{status}.pdf"
  if (rawKey.includes("/")) return rawKey;

  // Legacy format: "offer_{opportunityId}.pdf" (or anything without a slash)
  // Best effort: list storage objects under "{opportunityId}/" and pick newest PDF.
  const opportunityId = String(row.lever_id || "").trim();
  if (!opportunityId) return null;

  // Storage list endpoint: POST /storage/v1/object/list/{bucket}
  // Body supports prefix and limit.
  const listUrl = `${SUPABASE_URL}/storage/v1/object/list/offer-letters`;
  const listResp = await supaFetch(
    listUrl,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prefix: `${opportunityId}/`,
        limit: 100,
        offset: 0,
        sortBy: { column: "updated_at", order: "desc" },
      }),
    },
    SUPABASE_URL,
    SERVICE_ROLE
  );

  const items = await listResp.json().catch(() => []);
  if (!Array.isArray(items) || items.length === 0) return null;

  // Prefer PDFs
  const pdfs = items.filter((x) => String(x?.name || "").toLowerCase().endsWith(".pdf"));
  const pick = (pdfs.length ? pdfs : items)[0];
  const name = String(pick?.name || "").trim();
  if (!name) return null;

  // list returns "name" relative to prefix folder (e.g. "abc_offer.pdf" or "offerId_status.pdf")
  return `${opportunityId}/${name}`;
}

async function signOfferKey(key, SUPABASE_URL, SERVICE_ROLE) {
  // Keep slashes, encode each segment
  const safeKey = key.split("/").map(encodeURIComponent).join("/");

  const signUrl = `${SUPABASE_URL}/storage/v1/object/sign/offer-letters/${safeKey}`;
  const signResp = await supaFetch(
    signUrl,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expiresIn: 3600 }),
    },
    SUPABASE_URL,
    SERVICE_ROLE
  );

  const signed = await signResp.json();
  const signedURL = signed?.signedURL;
  if (!signedURL) return null;

  return `${SUPABASE_URL}/storage/v1${signedURL}`;
}

// NEW: helper to create a stable "now" ISO with seconds precision (matches portal-status)
function nowIsoUtcSeconds() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

module.exports = async (req, res) => {
  try {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") return res.status(204).end();

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!SUPABASE_URL || !SERVICE_ROLE) {
      return json(res, 500, { ok: false, error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" });
    }

    // Accept token + lastName + phone via querystring or body (supports both)
    const token = String((req.query.token ?? req.body?.token) ?? "").trim();
    const lastNameInput = (req.query.lastName ?? req.body?.lastName);
    const phoneInput = (req.query.phone ?? req.body?.phone);

    if (!token || !lastNameInput || !phoneInput) {
      return json(res, 400, { ok: false, error: "Missing token, lastName, or phone" });
    }

    if (isTokenBlocked(token)) {
      return json(res, 429, { ok: false, error: "Too many attempts. Try again later." });
    }

    const lastNameNorm = normalizeLastName(lastNameInput);
    const phoneNorm = normalizePhone10(phoneInput);
    if (!lastNameNorm || !phoneNorm) {
      registerTokenFailure(token);
      return json(res, 200, { ok: false });
    }

    // 1) Resolve person_key from people row with this token, and validate identity.
    // We select identity factors from the same row as the token.
    const tokenLookupUrl =
      `${SUPABASE_URL}/rest/v1/people` +
      `?select=person_key,application_last_name_norm,application_phone10` +
      `&magic_token_current=eq.${encodeURIComponent(token)}` +
      `&limit=1`;

    const tokenResp = await supaFetch(
      tokenLookupUrl,
      { method: "GET" },
      SUPABASE_URL,
      SERVICE_ROLE
    );

    const tokenRows = await tokenResp.json().catch(() => []);
    const tokenRow = tokenRows?.[0];

    if (!tokenRow || !tokenRow.person_key) {
      registerTokenFailure(token);
      return json(res, 200, { ok: false });
    }

    const dbLastNameNorm = normalizeLastName(tokenRow.application_last_name_norm);
    const dbPhoneNorm = normalizePhone10(tokenRow.application_phone10);

    if (dbLastNameNorm !== lastNameNorm || dbPhoneNorm !== phoneNorm) {
      registerTokenFailure(token);
      return json(res, 200, { ok: false });
    }

    clearTokenFailures(token);

    const personKey = String(tokenRow.person_key).trim();

    // NEW: optional hygiene — clear stale next_interview for this person.
    // (Keeps Bulk Refresh and Interview flow clean separation; this is read-side cleanup only.)
    try {
      const nowIso = nowIsoUtcSeconds();
      const clearUrl =
        `${SUPABASE_URL}/rest/v1/applications` +
        `?person_key=eq.${encodeURIComponent(personKey)}` +
        `&next_interview=lt.${encodeURIComponent(nowIso)}`;

      await supaFetch(
        clearUrl,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Prefer: "return=minimal",
          },
          body: JSON.stringify({ next_interview: null }),
        },
        SUPABASE_URL,
        SERVICE_ROLE
      );
    } catch {
      // Do not block offer downloads on cleanup failures.
    }

    // 2) Pull normalized applications for this person_key and enrich with shadow offer metadata.
    const appsUrl =
      `${SUPABASE_URL}/rest/v1/applications` +
      `?select=lever_opportunity_id,stage_updated,created_at` +
      `&person_key=eq.${encodeURIComponent(personKey)}` +
      `&order=created_at.desc`;

    const appsResp = await supaFetch(
      appsUrl,
      { method: "GET" },
      SUPABASE_URL,
      SERVICE_ROLE
    );

    const normalizedApps = await appsResp.json().catch(() => []);
    const leverIds = (Array.isArray(normalizedApps) ? normalizedApps : [])
      .map((row) => String(row?.lever_opportunity_id || "").trim())
      .filter(Boolean);

    let shadowMap = new Map();
    if (leverIds.length) {
      const shadowUrl =
        `${SUPABASE_URL}/rest/v1/Candidates_shadow` +
        `?select=lever_id,offer_access,offer_letter_key,stage_updated,created_at` +
        `&lever_id=in.(${leverIds.map((id) => encodeURIComponent(id)).join(",")})`;

      const shadowResp = await supaFetch(
        shadowUrl,
        { method: "GET" },
        SUPABASE_URL,
        SERVICE_ROLE
      );
      const shadowRows = await shadowResp.json().catch(() => []);
      shadowMap = new Map((Array.isArray(shadowRows) ? shadowRows : []).map((r) => [String(r?.lever_id || ""), r]));
    }

    const apps = (Array.isArray(normalizedApps) ? normalizedApps : []).map((app) => {
      const leverId = String(app?.lever_opportunity_id || "").trim();
      const shadow = shadowMap.get(leverId) || {};
      return {
        id: null,
        lever_id: leverId,
        offer_access: !!shadow?.offer_access,
        offer_letter_key: shadow?.offer_letter_key || null,
        stage_updated: app?.stage_updated || shadow?.stage_updated || null,
        created_at: app?.created_at || shadow?.created_at || null,
      };
    });

    // Only allow signing when the application is explicitly offer-eligible.
    // This prevents generic folder discovery from returning files for non-offer rows.
    const offerEligibleApps = apps.filter((row) => {
      const hasOfferAccess = !!row.offer_access;
      const hasOfferKey = !!String(row.offer_letter_key || "").trim();
      return hasOfferAccess || hasOfferKey;
    });

    const best = pickBestOfferRow(offerEligibleApps);

    if (!best) return json(res, 404, { ok: false, error: "No offer-eligible application found" });

    // 3) Resolve storage key (handles legacy)
    const key = await resolveStorageKeyFromRow(best, SUPABASE_URL, SERVICE_ROLE);
    if (!key) return json(res, 404, { ok: false, error: "No offer file found" });

    // 4) Sign it
    const url = await signOfferKey(key, SUPABASE_URL, SERVICE_ROLE);
    if (!url) return json(res, 500, { ok: false, error: "Signing failed" });

    return json(res, 200, { ok: true, url });

  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: "Unhandled error",
      details: String(e?.message || e),
    });
  }
};

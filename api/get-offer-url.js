// api/get-offer-url.js

// --- Token-scoped failure throttling (in-memory) ---
// Goal: stop brute-force even across rotating IPs.
// NOTE: in-memory resets on cold starts (still valuable + zero cost).
const TOKEN_FAIL_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const TOKEN_FAIL_LIMIT = 5;                  // 5 failed attempts per window

const tokenFailBuckets = globalThis.__tokenFailBuckets ?? new Map();
globalThis.__tokenFailBuckets = tokenFailBuckets;

function _now() { return Date.now(); }

function isTokenBlocked(token) {
  const key = String(token || "").trim();
  if (!key) return false;

  const arr = tokenFailBuckets.get(key);
  if (!arr || arr.length === 0) return false;

  const cutoff = _now() - TOKEN_FAIL_WINDOW_MS;
  const recent = arr.filter(ts => ts >= cutoff);

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

  const arr = (tokenFailBuckets.get(key) ?? []).filter(ts => ts >= cutoff);
  arr.push(_now());

  tokenFailBuckets.set(key, arr);
  return arr.length; // do not return this count to clients
}

function clearTokenFailures(token) {
  const key = String(token || "").trim();
  if (!key) return;
  tokenFailBuckets.delete(key);
}

module.exports = async (req, res) => {
  try {
    // Basic CORS (optional but helpful)
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") return res.status(204).end();

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!SUPABASE_URL || !SERVICE_ROLE) {
      return res.status(500).json({ error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" });
    }

    // Accept token/last4 via querystring (easy for your static portal to call)
    const token = (req.query.token || "").toString().trim();
    const last4 = (req.query.last4 || "").toString().trim();

    if (!token || !last4) {
      return res.status(400).json({ error: "Missing token or last4" });
    }

    // Token-scoped throttling: block early (before any DB / signing work)
    if (isTokenBlocked(token)) {
      return res.status(429).json({ error: "Too many attempts. Try again later." });
    }

    // Lookup candidate by magic_token
    const candidatesUrl =
      `${SUPABASE_URL}/rest/v1/Candidates` +
      `?select=offer_letter_key,last_four` +
      `&magic_token=eq.${encodeURIComponent(token)}` +
      `&limit=1`;

    const candResp = await fetch(candidatesUrl, {
      headers: {
        apikey: SERVICE_ROLE,
        Authorization: `Bearer ${SERVICE_ROLE}`,
      },
    });

    if (!candResp.ok) {
      const text = await candResp.text();
      return res.status(500).json({ error: "Supabase query failed", details: text });
    }

    const rows = await candResp.json();
    const row = rows?.[0];

    if (!row) return res.status(404).json({ error: "Candidate not found" });

    // If the identity check fails, register a token failure before returning.
    if ((row.last_four || "").toString() !== last4) {
      registerTokenFailure(token);
      return res.status(401).json({ error: "Invalid credentials." });
    }

    // Identity success: clear prior failures for this token.
    clearTokenFailures(token);

    const key = (row.offer_letter_key || "").toString().trim();
    if (!key) return res.status(404).json({ error: "No offer_letter_key on candidate" });

    // Keep slashes, encode each path segment
    const safeKey = key.split("/").map(encodeURIComponent).join("/");

    // Request a signed URL from Supabase Storage
    const signUrl = `${SUPABASE_URL}/storage/v1/object/sign/offer-letters/${safeKey}`;
    const signResp = await fetch(signUrl, {
      method: "POST",
      headers: {
        apikey: SERVICE_ROLE,
        Authorization: `Bearer ${SERVICE_ROLE}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ expiresIn: 3600 }), // 1 hour
    });

    if (!signResp.ok) {
      const text = await signResp.text();
      return res.status(500).json({ error: "Signing failed", details: text });
    }

    const signed = await signResp.json();
    // signed.signedURL looks like "/object/sign/offer-letters/...."
    const fullUrl = `${SUPABASE_URL}/storage/v1${signed.signedURL}`;

    return res.status(200).json({ url: fullUrl });
  } catch (e) {
    return res.status(500).json({ error: "Unhandled error", details: String(e) });
  }
};

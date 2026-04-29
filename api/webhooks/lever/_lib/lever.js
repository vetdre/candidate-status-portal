function authHeader(apiKey) {
  return `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`;
}

async function leverGet(path, cfg) {
  const url = `${cfg.leverApiBaseUrl.replace(/\/$/, "")}${path}`;
  const resp = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: authHeader(cfg.leverApiKey),
      "Content-Type": "application/json",
    },
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Lever request failed: ${resp.status} ${resp.statusText} :: ${text}`);
  }

  return resp.json();
}

async function getOpportunity(opportunityId, cfg) {
  const payload = await leverGet(`/opportunities/${encodeURIComponent(opportunityId)}`, cfg);
  return payload?.data || {};
}

async function getCandidate(candidateId, cfg) {
  const payload = await leverGet(`/candidates/${encodeURIComponent(candidateId)}`, cfg);
  return payload?.data || {};
}

async function getOpportunityInterviews(opportunityId, cfg) {
  const payload = await leverGet(`/opportunities/${encodeURIComponent(opportunityId)}/interviews`, cfg);
  return Array.isArray(payload?.data) ? payload.data : [];
}

async function listOpportunities({ limit = 50, cursor, archived } = {}, cfg) {
  const qs = new URLSearchParams();
  qs.set("limit", String(limit));
  qs.append("expand[]", "contact");
  if (cursor) qs.set("cursor", cursor);
  if (archived !== undefined) qs.set("archived", String(archived));

  const payload = await leverGet(`/opportunities?${qs.toString()}`, cfg);
  return {
    data: Array.isArray(payload?.data) ? payload.data : [],
    hasNext: payload?.hasNext || false,
    next: payload?.next || null,
  };
}

module.exports = {
  getOpportunity,
  getCandidate,
  getOpportunityInterviews,
  listOpportunities,
};

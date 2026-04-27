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

async function getOpportunityInterviews(opportunityId, cfg) {
  const payload = await leverGet(`/opportunities/${encodeURIComponent(opportunityId)}/interviews`, cfg);
  return Array.isArray(payload?.data) ? payload.data : [];
}

module.exports = {
  getOpportunity,
  getOpportunityInterviews,
};

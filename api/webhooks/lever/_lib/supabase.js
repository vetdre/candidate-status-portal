function json(res, status, body) {
  return res.status(status).json(body);
}

async function supaFetch(pathOrUrl, opts, cfg) {
  const url = pathOrUrl.startsWith("http") ? pathOrUrl : `${cfg.supabaseUrl}${pathOrUrl}`;
  const resp = await fetch(url, {
    ...opts,
    headers: {
      ...(opts.headers || {}),
      apikey: cfg.serviceRole,
      Authorization: `Bearer ${cfg.serviceRole}`,
    },
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    const err = new Error(`Supabase request failed: ${resp.status} ${resp.statusText} :: ${text}`);
    err.status = resp.status;
    throw err;
  }
  return resp;
}

async function insertIngestEvent(row, cfg) {
  const url = `/rest/v1/ingest_events`;
  const body = {
    source: "lever",
    event_type: row.eventType,
    event_id: row.eventId,
    dedupe_key: row.dedupeKey,
    signature_valid: row.signatureValid,
    payload: row.payload,
    headers: row.headers,
    process_status: "received",
  };

  const resp = await fetch(`${cfg.supabaseUrl}${url}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Prefer: "resolution=ignore-duplicates,return=representation",
      apikey: cfg.serviceRole,
      Authorization: `Bearer ${cfg.serviceRole}`,
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`ingest_events insert failed: ${resp.status} ${resp.statusText} :: ${text}`);
  }

  const rows = await resp.json().catch(() => []);
  const row0 = Array.isArray(rows) ? rows[0] : null;
  if (!row0 || !row0.id) {
    return { inserted: false, id: null };
  }
  return { inserted: true, id: row0.id };
}

async function updateIngestStatus(id, status, errorText, cfg) {
  if (!id) return;
  const q = `/rest/v1/ingest_events?id=eq.${encodeURIComponent(id)}`;
  const body = {
    process_status: status,
    processed_at: new Date().toISOString(),
    process_error: errorText || null,
  };

  await supaFetch(
    q,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify(body),
    },
    cfg
  );
}

async function getLegacyCandidateByLeverId(leverId, cfg) {
  const q =
    `/rest/v1/Candidates` +
    `?select=lever_id,name,email,phone,position,person_key,magic_token,application_phone,application_last_name,application_last_name_norm,identity_confidence` +
    `&lever_id=eq.${encodeURIComponent(leverId)}` +
    `&limit=1`;

  const resp = await supaFetch(q, { method: "GET" }, cfg);
  const rows = await resp.json().catch(() => []);
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

async function upsertApplicationNormalized(app, cfg) {
  if (!app || !app.lever_opportunity_id || !app.person_key) return;

  // Guard: only write to applications if the person_key already exists in people.
  // In Phase 1 the people table is empty, so this will always skip — that is correct.
  const checkResp = await supaFetch(
    `/rest/v1/people?person_key=eq.${encodeURIComponent(app.person_key)}&select=person_key&limit=1`,
    { method: "GET" },
    cfg
  );
  const checkRows = await checkResp.json().catch(() => []);
  if (!Array.isArray(checkRows) || checkRows.length === 0) return;

  const q = `/rest/v1/applications?on_conflict=lever_opportunity_id`;
  await supaFetch(
    q,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(app),
    },
    cfg
  );
}

async function replaceInterviewsForOpportunity(opportunityId, interviews, ingestEventId, cfg) {
  if (!opportunityId) return;

  await supaFetch(
    `/rest/v1/interviews?lever_opportunity_id=eq.${encodeURIComponent(opportunityId)}`,
    {
      method: "DELETE",
      headers: { Prefer: "return=minimal" },
    },
    cfg
  );

  const rows = (Array.isArray(interviews) ? interviews : []).map((x) => ({
    lever_interview_id: x?.id ? String(x.id) : null,
    lever_opportunity_id: String(opportunityId),
    interview_at: x?.date ? new Date(Number(x.date)).toISOString() : null,
    canceled_at: x?.canceledAt ? new Date(Number(x.canceledAt)).toISOString() : null,
    source_event_id: ingestEventId ? String(ingestEventId) : null,
  }));

  if (!rows.length) return;

  await supaFetch(
    `/rest/v1/interviews`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify(rows),
    },
    cfg
  );
}

async function upsertCandidateShadow(row, cfg) {
  const q = `/rest/v1/Candidates_shadow?on_conflict=lever_id`;
  await supaFetch(
    q,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(row),
    },
    cfg
  );
}

module.exports = {
  json,
  insertIngestEvent,
  updateIngestStatus,
  getLegacyCandidateByLeverId,
  upsertApplicationNormalized,
  replaceInterviewsForOpportunity,
  upsertCandidateShadow,
};

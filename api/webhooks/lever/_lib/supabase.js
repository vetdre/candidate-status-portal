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

async function getShadowCandidateByLeverId(leverId, cfg) {
  const q =
    `/rest/v1/Candidates_shadow` +
    `?select=lever_id,name,email,phone,position,person_key,magic_token,application_phone,application_last_name,application_last_name_norm,identity_confidence,current_stage,invite_sent_at` +
    `&lever_id=eq.${encodeURIComponent(leverId)}` +
    `&limit=1`;

  const resp = await supaFetch(q, { method: "GET" }, cfg);
  const rows = await resp.json().catch(() => []);
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

async function findMagicTokenByPersonKey(personKey, cfg) {
  if (!personKey) return null;

  const shadowQuery =
    `/rest/v1/Candidates_shadow` +
    `?select=magic_token` +
    `&person_key=eq.${encodeURIComponent(personKey)}` +
    `&magic_token=not.is.null` +
    `&limit=1`;
  const shadowResp = await supaFetch(shadowQuery, { method: "GET" }, cfg);
  const shadowRows = await shadowResp.json().catch(() => []);
  const shadowToken = Array.isArray(shadowRows) && shadowRows[0]?.magic_token ? String(shadowRows[0].magic_token) : null;
  if (shadowToken) return shadowToken;

  const legacyQuery =
    `/rest/v1/Candidates` +
    `?select=magic_token` +
    `&person_key=eq.${encodeURIComponent(personKey)}` +
    `&magic_token=not.is.null` +
    `&limit=1`;
  const legacyResp = await supaFetch(legacyQuery, { method: "GET" }, cfg);
  const legacyRows = await legacyResp.json().catch(() => []);
  return Array.isArray(legacyRows) && legacyRows[0]?.magic_token ? String(legacyRows[0].magic_token) : null;
}

async function upsertPersonNormalized(person, cfg) {
  if (!person || !person.person_key) return;

  const row = {
    person_key: person.person_key,
    updated_at: new Date().toISOString(),
    ...(person.primary_email ? { primary_email: person.primary_email } : {}),
    ...(person.primary_phone10 ? { primary_phone10: person.primary_phone10 } : {}),
    ...(person.application_last_name_norm ? { application_last_name_norm: person.application_last_name_norm } : {}),
    ...(person.application_phone10 ? { application_phone10: person.application_phone10 } : {}),
    ...(person.magic_token_current ? { magic_token_current: person.magic_token_current } : {}),
    ...(typeof person.identity_confidence === "number" ? { identity_confidence: person.identity_confidence } : {}),
  };

  const q = `/rest/v1/people?on_conflict=person_key`;
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

async function upsertApplicationNormalized(app, cfg) {
  if (!app || !app.lever_opportunity_id || !app.person_key) return;

  // Guard: only write to applications when parent person exists.
  // Callers should upsert people first via upsertPersonNormalized.
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

async function hasApplicationByLeverOpportunityId(opportunityId, cfg) {
  if (!opportunityId) return false;

  const resp = await supaFetch(
    `/rest/v1/applications?lever_opportunity_id=eq.${encodeURIComponent(opportunityId)}&select=lever_opportunity_id&limit=1`,
    { method: "GET" },
    cfg
  );
  const rows = await resp.json().catch(() => []);
  return Array.isArray(rows) && rows.length > 0;
}

async function replaceInterviewsForOpportunity(opportunityId, interviews, ingestEventId, cfg) {
  if (!opportunityId) return;

  const hasApplication = await hasApplicationByLeverOpportunityId(opportunityId, cfg);
  if (!hasApplication) {
    return { skipped: true, reason: "missing_application" };
  }

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

  if (!rows.length) return { skipped: false, inserted: 0 };

  await supaFetch(
    `/rest/v1/interviews`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify(rows),
    },
    cfg
  );

  return { skipped: false, inserted: rows.length };
}

async function replaceRawInterviewEventsForOpportunity(opportunityId, candidateId, interviews, ingestEventId, cfg) {
  if (!opportunityId) return { inserted: 0 };

  await supaFetch(
    `/rest/v1/interview_events_raw?lever_opportunity_id=eq.${encodeURIComponent(opportunityId)}`,
    {
      method: "DELETE",
      headers: { Prefer: "return=minimal" },
    },
    cfg
  );

  const rows = (Array.isArray(interviews) ? interviews : []).map((x) => ({
    lever_opportunity_id: String(opportunityId),
    lever_candidate_id: candidateId ? String(candidateId) : null,
    lever_interview_id: x?.id ? String(x.id) : null,
    interview_at: x?.date ? new Date(Number(x.date)).toISOString() : null,
    canceled_at: x?.canceledAt ? new Date(Number(x.canceledAt)).toISOString() : null,
    source_event_id: ingestEventId ? String(ingestEventId) : null,
    payload: x ?? null,
  }));

  if (!rows.length) return { inserted: 0 };

  await supaFetch(
    `/rest/v1/interview_events_raw`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify(rows),
    },
    cfg
  );

  return { inserted: rows.length };
}

async function markInviteSentOnShadow(leverId, cfg) {
  await supaFetch(
    `/rest/v1/Candidates_shadow?lever_id=eq.${encodeURIComponent(leverId)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ invite_sent_at: new Date().toISOString() }),
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
  getShadowCandidateByLeverId,
  findMagicTokenByPersonKey,
  upsertApplicationNormalized,
  hasApplicationByLeverOpportunityId,
  replaceInterviewsForOpportunity,
  replaceRawInterviewEventsForOpportunity,
  upsertCandidateShadow,
  markInviteSentOnShadow,
};

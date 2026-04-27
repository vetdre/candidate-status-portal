import { env } from "../config/env.js";

function leverAuthHeader(): string {
  // Lever API typically uses Basic auth with token as username and blank password.
  const basic = Buffer.from(`${env.leverApiKey}:`).toString("base64");
  return `Basic ${basic}`;
}

async function leverGet(path: string): Promise<any> {
  const url = `${env.leverApiBaseUrl.replace(/\/$/, "")}${path}`;
  const resp = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: leverAuthHeader(),
      "Content-Type": "application/json",
    },
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`Lever GET failed: ${resp.status} ${resp.statusText} :: ${body}`);
  }

  return resp.json();
}

export interface LeverInterview {
  id?: string;
  date?: number | null;
  canceledAt?: number | null;
}

export async function fetchLeverInterviewsByOpportunity(
  opportunityId: string
): Promise<LeverInterview[]> {
  const payload = await leverGet(`/opportunities/${encodeURIComponent(opportunityId)}/interviews`);
  return Array.isArray(payload?.data) ? payload.data : [];
}

export interface LeverOpportunity {
  id?: string;
  stage?: string | null;
  archived?: {
    reason?: string | null;
  } | null;
}

export async function fetchLeverOpportunity(opportunityId: string): Promise<LeverOpportunity> {
  const payload = await leverGet(`/opportunities/${encodeURIComponent(opportunityId)}`);
  return (payload?.data ?? {}) as LeverOpportunity;
}

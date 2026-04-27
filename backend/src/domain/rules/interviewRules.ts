export interface LeverInterview {
  date?: number | null;
  canceledAt?: number | null;
}

export function resolveNextInterviewUtc(
  interviews: LeverInterview[],
  nowEpochMs = Date.now()
): string | null {
  const future = interviews
    .filter((x) => !x.canceledAt)
    .map((x) => Number(x.date || 0))
    .filter((ms) => Number.isFinite(ms) && ms > nowEpochMs)
    .sort((a, b) => a - b);

  if (future.length === 0) return null;
  return new Date(future[0]).toISOString();
}

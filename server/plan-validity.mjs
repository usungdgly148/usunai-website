const DAY_MS = 86400000;

const normalizeDate = (value, fallback) => {
  const candidate = String(value || fallback || '').trim();
  return Number.isFinite(new Date(candidate).getTime()) ? candidate : String(fallback || '').trim();
};

/**
 * Resolve a points-plan validity change without stacking durations.
 * Finite plans keep the later absolute expiry; permanent validity always wins.
 */
export function resolveMaxPlanValidity(existingUser, { validFrom, validDays, fallbackStart }) {
  const requestedDays = Math.max(0, Number(validDays) || 0);
  const requestedStart = normalizeDate(validFrom, fallbackStart);

  if (requestedDays === 0) {
    return { planValidFrom: requestedStart, planValidDays: 0, winner: 'incoming' };
  }

  const existingStart = existingUser && existingUser.planValidFrom
    ? String(existingUser.planValidFrom)
    : '';
  const existingDays = existingUser ? Number(existingUser.planValidDays) : NaN;

  if (existingStart && existingDays === 0) {
    return { planValidFrom: existingStart, planValidDays: 0, winner: 'existing' };
  }

  const requestedStartMs = new Date(requestedStart).getTime();
  const requestedExpiryMs = Number.isFinite(requestedStartMs)
    ? requestedStartMs + requestedDays * DAY_MS
    : NaN;
  const existingStartMs = new Date(existingStart).getTime();
  const existingExpiryMs = Number.isFinite(existingStartMs) && Number.isFinite(existingDays) && existingDays > 0
    ? existingStartMs + existingDays * DAY_MS
    : NaN;

  if (Number.isFinite(existingExpiryMs) && (!Number.isFinite(requestedExpiryMs) || existingExpiryMs >= requestedExpiryMs)) {
    return { planValidFrom: existingStart, planValidDays: existingDays, winner: 'existing' };
  }

  return { planValidFrom: requestedStart, planValidDays: requestedDays, winner: 'incoming' };
}

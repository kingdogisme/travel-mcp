/**
 * An upstream PointsYeah award inventory of 9999 is not evidence of 9,999
 * bookable seats. Treat sentinel, missing and malformed counts as unverified.
 */
export const UNVERIFIED_SEAT_SENTINEL = 9999;

export function normalizeSeatCount(raw: unknown): number | null {
  if (
    typeof raw !== 'number' ||
    !Number.isSafeInteger(raw) ||
    raw < 0 ||
    raw >= UNVERIFIED_SEAT_SENTINEL
  ) {
    return null;
  }
  return raw;
}

/**
 * Sanitize Explorer / recommendation responses without mutating the source.
 * Leave flight candidates visible while removing unsupported seat-count claims.
 */
export function normalizeAwardSeatFields<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeAwardSeatFields(entry)) as T;
  }
  if (value !== null && typeof value === 'object') {
    const original = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(original)) {
      result[key] = key === 'seats' ? normalizeSeatCount(entry) : normalizeAwardSeatFields(entry);
    }
    if (
      Object.prototype.hasOwnProperty.call(original, 'seats') &&
      original.seats !== null &&
      result.seats === null
    ) {
      result.seat_count_status = 'unverified';
    }
    return result as T;
  }
  return value;
}

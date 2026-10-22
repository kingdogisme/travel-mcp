/**
 * PointsYeah sometimes reports 9999 in award availability fields.
 * This is not evidence of 9,999 bookable seats; the upstream meaning is unknown.
 * An unverifiable count must not satisfy a party-size requirement.
 */
export function normalizeAwardSeatCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value < 9999
    ? value
    : null;
}

const COUNT_KEYS = new Set(['seats', 'available_seats', 'remaining_seats']);

/** Recursively sanitize returned (not request) JSON without mutating the source. */
export function sanitizeAwardSeatFields<T>(data: T): { value: T; unverified: number } {
  let unverified = 0;
  const walk = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(walk);
    if (input === null || typeof input !== 'object') return input;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      if (COUNT_KEYS.has(key)) {
        const seats = normalizeAwardSeatCount(value);
        if (seats === null && value !== null) unverified++;
        out[key] = seats;
      } else {
        out[key] = walk(value);
      }
    }
    return out;
  };
  return { value: walk(data) as T, unverified };
}

export const UNKNOWN_SEAT_NOTE =
  'Some award seat counts are unverified (for example, PointsYeah reports 9999). ' +
  'Unknown counts cannot establish bookable inventory; check the loyalty program for the full party before transferring points.';

import type { FlightResult } from './types.js';

/** One FlightResult is a program/date/route GROUP, not one award itinerary. */
export function countAwardItineraries(groups: FlightResult[]): number {
  return groups.reduce((sum, group) => sum + (group.routes?.length ?? 0), 0);
}

/**
 * Limit the NUMBER OF ACTUAL FLIGHT OPTIONS, independently of the legacy
 * `limit` parameter (which limits result groups).
 *
 * Preserve the existing group/route order and do not mutate source objects.
 * Running after sort/filters means the most relevant options are kept.
 */
export function limitAwardItineraries(
  groups: FlightResult[],
  maxOptions?: number
): { results: FlightResult[]; omitted_options: number } {
  const total = countAwardItineraries(groups);
  if (maxOptions === undefined) {
    return { results: groups, omitted_options: 0 };
  }
  if (!Number.isSafeInteger(maxOptions) || maxOptions < 1 || maxOptions > 200) {
    throw new Error('maxOptions must be an integer between 1 and 200');
  }
  let remaining = maxOptions;
  const results: FlightResult[] = [];
  for (const group of groups) {
    if (remaining === 0) break;
    const routes = group.routes ?? [];
    if (!routes.length) continue;
    const shown = routes.slice(0, remaining);
    if (shown.length > 0) {
      results.push({ ...group, routes: shown });
      remaining -= shown.length;
    }
  }
  return { results, omitted_options: total - countAwardItineraries(results) };
}

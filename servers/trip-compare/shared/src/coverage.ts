/**
 * Which booking programs the live sources actually search.
 *
 * The list mirrors the program codes the PointsYeah client sends by default
 * (servers/pointsyeah/shared/src/pointsyeah-client/lib/search.ts,
 * DEFAULT_AIRLINE_PROGRAMS). Anything outside it is a coverage gap: the
 * comparison may say "the sources we searched returned nothing", but it must
 * not report that as "no award space exists" or "cash is the only option".
 *
 * When PointsYeah's program list changes, update SEARCHED_PROGRAM_CODES and
 * bump COVERAGE_LAST_VERIFIED.
 */

/** Date this coverage list was last checked against the live sources. */
export const COVERAGE_LAST_VERIFIED = '2026-10-11';

/** Program codes the PointsYeah award search queries by default. */
export const SEARCHED_PROGRAM_CODES: readonly string[] = [
  'AR',
  'AM',
  'AC',
  'KL',
  'AS',
  'AA',
  'AV',
  'DL',
  'EK',
  'EY',
  'AY',
  'B6',
  'LH',
  'QF',
  'SK',
  'SQ',
  'NK',
  'TK',
  'UA',
  'VS',
  'VA',
];

export interface CoverageGap {
  code: string;
  name: string;
  note: string;
}

/**
 * Booking programs we know are not searched. A trip on a carrier these
 * programs can book is exactly the case where "nothing found" must not be
 * read as "nothing bookable".
 */
export const KNOWN_COVERAGE_GAPS: readonly CoverageGap[] = [
  {
    code: 'IB',
    name: 'Iberia Club',
    note: 'Iberia Avios awards are outside the searched program list. Check Iberia Club directly, or a searched partner such as Finnair Plus (AY) that can book Iberia.',
  },
  {
    code: 'BA',
    name: 'British Airways Club',
    note: 'BA Avios awards are outside the searched program list. Check British Airways Club directly for partner awards on the operating carrier.',
  },
];

/** Fresh copy, so callers cannot mutate the shared list. */
export function coverageGaps(): CoverageGap[] {
  return KNOWN_COVERAGE_GAPS.map((gap) => ({ ...gap }));
}

/** "Iberia Club (IB) and British Airways Club (BA)" */
export function describeCoverageGaps(gaps: readonly CoverageGap[]): string {
  const labels = gaps.map((gap) => `${gap.name} (${gap.code})`);
  if (labels.length === 0) return 'no known programs';
  if (labels.length === 1) return labels[0];
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}

/**
 * Which booking programs the live sources actually search, and what a trip can
 * be booked with when the searched programs come up empty.
 *
 * SEARCHED_PROGRAM_CODES mirrors the codes the PointsYeah client sends by
 * default (servers/pointsyeah/shared/src/pointsyeah-client/lib/search.ts,
 * DEFAULT_AIRLINE_PROGRAMS). Everything else is a coverage gap: the comparison
 * may say "the sources we searched returned nothing", but it must not report
 * that as "no award space exists" or "cash is the only option".
 *
 * CARRIER_COVERAGE maps an operating carrier (IATA airline code) to the loyalty
 * programs that can book it but are not searched. Keep entries to facts worth
 * acting on, and bump COVERAGE_LAST_VERIFIED whenever this file is re-checked.
 *
 * Deferred on purpose (P3 in the review): a browser adapter that queries Iberia
 * Club / British Airways Club directly. It only makes sense once those lookups
 * are shown to be frequent and a free, stable interface exists — the official
 * pages below are the manual verification path until then.
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
  /** Program code, e.g. "IB". */
  code: string;
  /** Program name, e.g. "Iberia Club". */
  name: string;
  note: string;
  /** Why this gap is being reported. */
  source: 'program_list' | 'operating_carrier';
  /** Operating carrier that triggered it, when the gap came from a carrier. */
  carrier?: string;
  /** Official award-search page, when we know it. */
  official_search_url?: string;
}

interface UnsearchedProgram {
  code: string;
  name: string;
  official_search_url?: string;
}

/**
 * Loyalty programs that are not searched, with the official award-search page
 * where we have verified one. Program codes follow the airlines' own naming.
 */
const UNSERCHED_PROGRAMS: Record<string, UnsearchedProgram> = {
  IB: {
    code: 'IB',
    name: 'Iberia Club',
    official_search_url: 'https://www.iberia.com/us/iberia-club/purchase-flights-avios/',
  },
  BA: {
    code: 'BA',
    name: 'British Airways Club',
    official_search_url:
      'https://www.britishairways.com/content/the-british-airways-club/avios/spending-avios/reward-flights',
  },
  EI: { code: 'EI', name: 'Aer Lingus AerClub' },
  JL: { code: 'JL', name: 'Japan Airlines Mileage Bank' },
  NH: { code: 'NH', name: 'ANA Mileage Club' },
  CX: { code: 'CX', name: 'Cathay Pacific Asia Miles' },
  QR: { code: 'QR', name: 'Qatar Airways Privilege Club' },
  KE: { code: 'KE', name: 'Korean Air SKYPASS' },
  ET: { code: 'ET', name: 'Ethiopian ShebaMiles' },
  MS: { code: 'MS', name: 'EgyptAir Plus' },
  MH: { code: 'MH', name: 'Malaysia Airlines Enrich' },
  TG: { code: 'TG', name: 'Thai Airways Royal Orchid Plus' },
  AI: { code: 'AI', name: 'Air India Maharaja Club' },
  CA: { code: 'CA', name: 'Air China PhoenixMiles' },
  MU: { code: 'MU', name: 'China Eastern Eastern Miles' },
  PR: { code: 'PR', name: 'Philippine Airlines Mabuhay Miles' },
  GA: { code: 'GA', name: 'Garuda Indonesia GarudaMiles' },
  VN: { code: 'VN', name: 'Vietnam Airlines Lotusmiles' },
  NZ: { code: 'NZ', name: 'Air New Zealand Airpoints' },
  WS: { code: 'WS', name: 'WestJet Rewards' },
  SV: { code: 'SV', name: 'Saudia AlFursan' },
  AZ: { code: 'AZ', name: 'ITA Airways Volare' },
  LA: { code: 'LA', name: 'LATAM Pass' },
  CM: { code: 'CM', name: 'Copa ConnectMiles' },
  AT: { code: 'AT', name: 'Royal Air Maroc Safar Flyer' },
};

/**
 * Searched programs that may hold award space on the same carriers, grouped by
 * alliance. These are cross-checks, not guarantees: each program prices and
 * releases partner seats independently.
 */
const ONEWORLD_CROSS_CHECK = ['AA', 'AS', 'AY', 'QF'];
const STAR_CROSS_CHECK = ['AC', 'LH', 'SK', 'SQ', 'TK', 'UA'];
const SKYTEAM_CROSS_CHECK = ['AM', 'AR', 'DL', 'KL', 'VS'];

interface CarrierCoverage {
  name: string;
  /** The carrier's own program, which the search does not cover. */
  program: string;
  /** Searched programs worth cross-checking for the same carrier. */
  cross_check_with: string[];
}

/**
 * Operating carriers whose own loyalty program is not searched. When a trip
 * flies one of these, "nothing found" is especially weak evidence — the seats
 * may simply be sitting in a program nobody queried.
 */
const CARRIER_COVERAGE: Record<string, CarrierCoverage> = {
  IB: { name: 'Iberia', program: 'IB', cross_check_with: ONEWORLD_CROSS_CHECK },
  BA: { name: 'British Airways', program: 'BA', cross_check_with: ONEWORLD_CROSS_CHECK },
  EI: { name: 'Aer Lingus', program: 'EI', cross_check_with: ['AA', 'BA'] },
  JL: { name: 'Japan Airlines', program: 'JL', cross_check_with: ONEWORLD_CROSS_CHECK },
  CX: { name: 'Cathay Pacific', program: 'CX', cross_check_with: ONEWORLD_CROSS_CHECK },
  QR: { name: 'Qatar Airways', program: 'QR', cross_check_with: ONEWORLD_CROSS_CHECK },
  MH: { name: 'Malaysia Airlines', program: 'MH', cross_check_with: ONEWORLD_CROSS_CHECK },
  AT: { name: 'Royal Air Maroc', program: 'AT', cross_check_with: ONEWORLD_CROSS_CHECK },
  NH: { name: 'ANA', program: 'NH', cross_check_with: STAR_CROSS_CHECK },
  NZ: { name: 'Air New Zealand', program: 'NZ', cross_check_with: STAR_CROSS_CHECK },
  TG: { name: 'Thai Airways', program: 'TG', cross_check_with: STAR_CROSS_CHECK },
  AI: { name: 'Air India', program: 'AI', cross_check_with: STAR_CROSS_CHECK },
  CA: { name: 'Air China', program: 'CA', cross_check_with: STAR_CROSS_CHECK },
  ET: { name: 'Ethiopian Airlines', program: 'ET', cross_check_with: STAR_CROSS_CHECK },
  MS: { name: 'EgyptAir', program: 'MS', cross_check_with: STAR_CROSS_CHECK },
  KE: { name: 'Korean Air', program: 'KE', cross_check_with: SKYTEAM_CROSS_CHECK },
  VN: { name: 'Vietnam Airlines', program: 'VN', cross_check_with: SKYTEAM_CROSS_CHECK },
  GA: { name: 'Garuda Indonesia', program: 'GA', cross_check_with: SKYTEAM_CROSS_CHECK },
  MU: { name: 'China Eastern', program: 'MU', cross_check_with: SKYTEAM_CROSS_CHECK },
  SV: { name: 'Saudia', program: 'SV', cross_check_with: SKYTEAM_CROSS_CHECK },
  CM: { name: 'Copa Airlines', program: 'CM', cross_check_with: SKYTEAM_CROSS_CHECK },
  AZ: { name: 'ITA Airways', program: 'AZ', cross_check_with: SKYTEAM_CROSS_CHECK },
  PR: { name: 'Philippine Airlines', program: 'PR', cross_check_with: [] },
  WS: { name: 'WestJet', program: 'WS', cross_check_with: [] },
  LA: { name: 'LATAM', program: 'LA', cross_check_with: [] },
};

/** Program codes whose own loyalty program the search does not cover. */
export function unsearchedProgramCodes(): string[] {
  return Object.keys(UNSERCHED_PROGRAMS);
}

function gapForProgram(program: UnsearchedProgram, carrier?: string): CoverageGap {
  const crossCheck = carrier ? CARRIER_COVERAGE[carrier]?.cross_check_with ?? [] : [];
  const crossCheckText =
    crossCheck.length > 0
      ? ` Searched programs that may see the same seats: ${crossCheck.join(', ')} — each prices partner space separately.`
      : '';
  return {
    code: program.code,
    name: program.name,
    note:
      (carrier
        ? `${CARRIER_COVERAGE[carrier].name} flies this trip, and its own program ${program.name} is not searched.`
        : `${program.name} is not in the searched program list.`) + crossCheckText,
    source: carrier ? 'operating_carrier' : 'program_list',
    ...(carrier ? { carrier } : {}),
    ...(program.official_search_url ? { official_search_url: program.official_search_url } : {}),
  };
}

/** Gaps that apply to every search: the programs we know we never query. */
export function staticCoverageGaps(): CoverageGap[] {
  return ['IB', 'BA'].map((code) => gapForProgram(UNSERCHED_PROGRAMS[code]));
}

/**
 * Gaps for the carriers that actually fly this trip. An unsearched program on
 * an unrelated airline is noise; one on the operating carrier is the whole
 * point of the coverage check.
 */
export function coverageGapsForCarriers(carrierCodes: readonly string[]): CoverageGap[] {
  const seen = new Set<string>();
  const gaps: CoverageGap[] = [];
  for (const raw of carrierCodes) {
    const carrier = raw.trim().toUpperCase();
    const coverage = CARRIER_COVERAGE[carrier];
    if (!coverage) continue;
    const program = UNSERCHED_PROGRAMS[coverage.program];
    if (!program) continue;
    const key = `${carrier}:${program.code}`;
    if (seen.has(key)) continue;
    seen.add(key);
    gaps.push(gapForProgram(program, carrier));
  }
  return gaps;
}

/** Merge gap lists, keeping the first entry for each program code. */
export function mergeCoverageGaps(...lists: readonly CoverageGap[][]): CoverageGap[] {
  const merged: CoverageGap[] = [];
  const seen = new Set<string>();
  for (const list of lists) {
    for (const gap of list) {
      if (seen.has(gap.code)) continue;
      seen.add(gap.code);
      merged.push(gap);
    }
  }
  return merged;
}

export interface VerificationLink {
  label: string;
  url: string;
  purpose: string;
}

/**
 * Manual verification entry points for the gaps we cannot search. These are
 * links only — no scraping, no extra request volume.
 */
export const VERIFICATION_LINKS: readonly VerificationLink[] = [
  {
    label: 'Iberia Club award search',
    url: 'https://www.iberia.com/us/iberia-club/purchase-flights-avios/',
    purpose: 'Check Iberia Avios availability on an Iberia-operated flight.',
  },
  {
    label: 'British Airways Avios reward flights',
    url: 'https://www.britishairways.com/content/the-british-airways-club/avios/spending-avios/reward-flights',
    purpose: 'Check BA Avios availability, including partner-operated flights.',
  },
  {
    label: 'Roame Iberia Plus',
    url: 'https://roame.travel/programs/iberia',
    purpose: 'Free web lookup for Iberia Plus award space (manual check).',
  },
];

/** "Iberia Club (IB) and British Airways Club (BA)" */
export function describeCoverageGaps(gaps: readonly CoverageGap[]): string {
  const labels = gaps.map((gap) => `${gap.name} (${gap.code})`);
  if (labels.length === 0) return 'no known programs';
  if (labels.length === 1) return labels[0];
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}

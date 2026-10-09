/**
 * PointsYeah's live search only accepts concrete IATA airport codes. A city
 * name like "Tokyo" makes the API answer 404, and a metro pseudo-code such as
 * "TYO" or "LON" is accepted but matched against nothing, so the search comes
 * back empty. Both are resolved here to the city's main airport before a
 * search is built.
 *
 * Every entry maps to a single airport rather than a metro code: PointsYeah
 * searches one airport per side, so a caller who wants a different airport
 * (HND instead of NRT, LGW instead of LHR) passes that IATA code directly.
 * Codes outside this table pass through untouched.
 */
const CITY_CODES: Record<string, string> = {
  // Multi-airport metros -> their main airport
  london: 'LHR',
  'new york': 'JFK',
  tokyo: 'NRT',
  osaka: 'KIX',
  paris: 'CDG',
  milan: 'MXP',
  rome: 'FCO',
  moscow: 'SVO',
  seoul: 'ICN',
  beijing: 'PEK',
  shanghai: 'PVG',
  washington: 'IAD',
  chicago: 'ORD',
  toronto: 'YYZ',
  montreal: 'YUL',
  'sao paulo': 'GRU',
  'rio de janeiro': 'GIG',
  'buenos aires': 'EZE',
  stockholm: 'ARN',
  jakarta: 'CGK',
  houston: 'IAH',
  dallas: 'DFW',
  miami: 'MIA',
  // Asia
  bangkok: 'BKK',
  singapore: 'SIN',
  'hong kong': 'HKG',
  taipei: 'TPE',
  'kuala lumpur': 'KUL',
  manila: 'MNL',
  hanoi: 'HAN',
  'ho chi minh city': 'SGN',
  saigon: 'SGN',
  bali: 'DPS',
  denpasar: 'DPS',
  phuket: 'HKT',
  'chiang mai': 'CNX',
  delhi: 'DEL',
  'new delhi': 'DEL',
  mumbai: 'BOM',
  bangalore: 'BLR',
  nagoya: 'NGO',
  sapporo: 'CTS',
  fukuoka: 'FUK',
  okinawa: 'OKA',
  busan: 'PUS',
  guangzhou: 'CAN',
  shenzhen: 'SZX',
  chengdu: 'CTU',
  // Middle East & Africa
  dubai: 'DXB',
  'abu dhabi': 'AUH',
  doha: 'DOH',
  riyadh: 'RUH',
  'tel aviv': 'TLV',
  istanbul: 'IST',
  cairo: 'CAI',
  johannesburg: 'JNB',
  'cape town': 'CPT',
  nairobi: 'NBO',
  casablanca: 'CMN',
  // Europe
  madrid: 'MAD',
  barcelona: 'BCN',
  amsterdam: 'AMS',
  frankfurt: 'FRA',
  munich: 'MUC',
  berlin: 'BER',
  zurich: 'ZRH',
  geneva: 'GVA',
  vienna: 'VIE',
  brussels: 'BRU',
  copenhagen: 'CPH',
  oslo: 'OSL',
  helsinki: 'HEL',
  dublin: 'DUB',
  lisbon: 'LIS',
  porto: 'OPO',
  athens: 'ATH',
  prague: 'PRG',
  warsaw: 'WAW',
  budapest: 'BUD',
  edinburgh: 'EDI',
  manchester: 'MAN',
  reykjavik: 'KEF',
  // Americas
  'los angeles': 'LAX',
  'san francisco': 'SFO',
  seattle: 'SEA',
  boston: 'BOS',
  atlanta: 'ATL',
  denver: 'DEN',
  'las vegas': 'LAS',
  phoenix: 'PHX',
  portland: 'PDX',
  'san diego': 'SAN',
  orlando: 'MCO',
  honolulu: 'HNL',
  vancouver: 'YVR',
  calgary: 'YYC',
  'mexico city': 'MEX',
  cancun: 'CUN',
  bogota: 'BOG',
  lima: 'LIM',
  santiago: 'SCL',
  // Oceania & Pacific
  sydney: 'SYD',
  melbourne: 'MEL',
  brisbane: 'BNE',
  perth: 'PER',
  auckland: 'AKL',
  wellington: 'WLG',
  christchurch: 'CHC',
  nadi: 'NAN',
  guam: 'GUM',
};

/**
 * Metro pseudo-codes a caller may pass directly. They look like IATA codes but
 * are not airports, so PointsYeah would silently return nothing; map each to
 * the city's main airport instead.
 */
const METRO_CODES: Record<string, string> = {
  LON: 'LHR',
  NYC: 'JFK',
  TYO: 'NRT',
  OSA: 'KIX',
  PAR: 'CDG',
  MIL: 'MXP',
  ROM: 'FCO',
  MOW: 'SVO',
  SEL: 'ICN',
  BJS: 'PEK',
  SHA: 'PVG',
  WAS: 'IAD',
  CHI: 'ORD',
  YTO: 'YYZ',
  YMQ: 'YUL',
  SAO: 'GRU',
  RIO: 'GIG',
  BUE: 'EZE',
  STO: 'ARN',
  JKT: 'CGK',
  REK: 'KEF',
};

const IATA_RE = /^[A-Za-z]{3}$/;

/** Trim and normalise a city name into a lookup key. */
function cityKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Resolve a user-supplied place into something PointsYeah actually searches:
 * an airport code passes through (upper-cased), a metro pseudo-code becomes its
 * main airport, a known city name becomes its main airport, and anything else is
 * rejected with an actionable message instead of a silently empty search.
 */
export function resolvePlaceCode(value: string): string {
  const trimmed = value.trim();
  if (IATA_RE.test(trimmed)) {
    const code = trimmed.toUpperCase();
    return METRO_CODES[code] ?? code;
  }

  const known = CITY_CODES[cityKey(trimmed)];
  if (known) return known;

  throw new Error(
    `Could not resolve "${trimmed}" to an airport code. Pass an IATA code such as "NRT", or a city name from the supported list (Tokyo, London, Bangkok, ...); use find_airport_code on the google-flights server for anything else.`
  );
}

/** Resolve a list of places, dropping empty entries. */
export function resolvePlaceCodes(values: string[]): string[] {
  return values
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .map((value) => resolvePlaceCode(value));
}

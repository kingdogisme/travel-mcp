/**
 * PointsYeah's live search only accepts IATA codes — a city name like "Tokyo"
 * makes the API answer 404 — so the tools accept the common city names and
 * resolve them here before a search is built.
 *
 * The multi-airport entries mirror the metro map on the Google Flights server
 * (servers/google-flights/shared/src/flights-client/flights-client.ts,
 * CITY_METRO_CODES); the single-airport entries exist because PointsYeah has no
 * name lookup of its own. Codes pass through untouched, so anything outside
 * this table still works as long as the caller passes an IATA code.
 */
const CITY_CODES: Record<string, string> = {
  // Multi-airport metros (same codes Google Flights uses)
  london: 'LON',
  'new york': 'NYC',
  tokyo: 'TYO',
  osaka: 'OSA',
  paris: 'PAR',
  milan: 'MIL',
  rome: 'ROM',
  moscow: 'MOW',
  seoul: 'SEL',
  beijing: 'BJS',
  shanghai: 'SHA',
  washington: 'WAS',
  chicago: 'CHI',
  toronto: 'YTO',
  montreal: 'YMQ',
  'sao paulo': 'SAO',
  'rio de janeiro': 'RIO',
  'buenos aires': 'BUE',
  stockholm: 'STO',
  jakarta: 'JKT',
  houston: 'HOU',
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
  reykjavik: 'REK',
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

const IATA_RE = /^[A-Za-z]{3}$/;

/** Trim and normalise a city name into a lookup key. */
function cityKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Resolve a user-supplied place into something PointsYeah accepts: an IATA code
 * passes through (upper-cased), a known city name becomes its code, and anything
 * else is rejected with an actionable message instead of the API's bare 404.
 */
export function resolvePlaceCode(value: string): string {
  const trimmed = value.trim();
  if (IATA_RE.test(trimmed)) return trimmed.toUpperCase();

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

import protobuf from 'protobufjs';
import type {
  FlightOffer,
  FlightSegment,
  FlightLayover,
  FlightEmissions,
  PriceInsights,
  PricePoint,
  FlightExtensions,
  DateGridEntry,
  DateGridResult,
  SearchFlightsOptions,
  SearchFlightsResult,
  GetDateGridOptions,
  AirportResult,
  SeatClass,
  TripType,
} from './types.js';
import { logDebug, logWarning } from '../logging.js';

// Protobuf enum mappings
const SEAT_MAP: Record<SeatClass, number> = {
  economy: 1,
  premium_economy: 2,
  business: 3,
  first: 4,
};

const TRIP_MAP: Record<TripType, number> = {
  round_trip: 1,
  one_way: 2,
};

// Default headers to mimic a Chrome navigation request. A realistic header set
// (client hints + fetch metadata) is part of staying under Google's radar.
const DEFAULT_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'sec-ch-ua': '"Chromium";v="131", "Not_A Brand";v="24", "Google Chrome";v="131"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  'sec-fetch-dest': 'document',
  'sec-fetch-mode': 'navigate',
  'sec-fetch-site': 'none',
  'sec-fetch-user': '?1',
  'upgrade-insecure-requests': '1',
  Cookie: 'CONSENT=PENDING+987; SOCS=CAESHAgBEhJnd3NfMjAyMzA4MTAtMF9SQzIaAmRlIAEaBgiAo_CmBg',
};

// =============================================================================
// POLITE FETCHING
//
// Google rate-limits and occasionally serves consent/interstitial pages when it
// sees suspicious traffic. Three things keep us out of trouble:
//   1. Requests are serialized and spaced with jitter, so bursts never happen.
//   2. Retryable responses (429/403/5xx) back off exponentially with jitter.
//   3. Blocked/interstitial pages are detected and retried rather than parsed.
// =============================================================================

const MIN_REQUEST_INTERVAL_MS = 1500;
/** Hard ceiling on live lookups per date-grid call — keeps us polite to Google. */
const MAX_GRID_DATES = 14;
const MAX_JITTER_MS = 900;
const MAX_ATTEMPTS = 4;
const BASE_BACKOFF_MS = 3000;
const MAX_BACKOFF_MS = 30_000;

let lastRequestTime = 0;
let requestChain: Promise<void> = Promise.resolve();

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function jitter(max = MAX_JITTER_MS): number {
  return Math.floor(Math.random() * max);
}

/** Serialize requests and keep a polite gap (plus jitter) between them. */
async function acquireSlot(): Promise<void> {
  const previous = requestChain;
  let release: () => void = () => {};
  requestChain = new Promise<void>((resolve) => {
    release = resolve;
  });

  await previous;
  const elapsed = Date.now() - lastRequestTime;
  const wait = MIN_REQUEST_INTERVAL_MS + jitter() - elapsed;
  if (wait > 0) await sleep(wait);
  lastRequestTime = Date.now();
  release();
}

/** Detect Google's rate-limit / consent / captcha interstitials. */
function detectBlock(html: string): string | null {
  if (html.includes('unusual traffic')) return 'unusual traffic interstitial';
  if (html.includes("Please show you&#39;re not a robot")) return 'captcha challenge';
  if (html.includes('sorry/index')) return 'rate-limit redirect';
  if (html.length < 50_000 && html.includes('consent.google.com')) return 'consent interstitial';
  return null;
}

function retryDelay(attempt: number, response?: Response): number {
  const header = response?.headers?.get('retry-after');
  const retryAfterMs = header ? Number(header) * 1000 : Number.NaN;
  const backoff = Number.isFinite(retryAfterMs)
    ? retryAfterMs
    : Math.min(BASE_BACKOFF_MS * 2 ** (attempt - 1), MAX_BACKOFF_MS);
  return backoff + jitter(1500);
}

async function rateLimitedFetch(url: string): Promise<string> {
  let lastError = 'unknown error';

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    await acquireSlot();

    let response: Response;
    try {
      response = await fetch(url, { headers: DEFAULT_HEADERS });
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (attempt === MAX_ATTEMPTS) break;
      logWarning('fetch', `Network error (${lastError}), retrying (${attempt}/${MAX_ATTEMPTS})`);
      await sleep(retryDelay(attempt));
      continue;
    }

    if (response.status === 429 || response.status === 403 || response.status >= 500) {
      lastError = `HTTP ${response.status}`;
      if (attempt === MAX_ATTEMPTS) break;
      const delay = retryDelay(attempt, response);
      logWarning(
        'fetch',
        `Google returned ${response.status}, backing off ${Math.round(delay)}ms (${attempt}/${MAX_ATTEMPTS})`
      );
      await sleep(delay);
      continue;
    }

    if (!response.ok) {
      throw new Error(`Google Flights returned HTTP ${response.status}`);
    }

    const html = await response.text();
    const block = detectBlock(html);
    if (block) {
      lastError = block;
      if (attempt === MAX_ATTEMPTS) break;
      const delay = retryDelay(attempt, response);
      logWarning(
        'fetch',
        `Blocked by ${block}, backing off ${Math.round(delay)}ms (${attempt}/${MAX_ATTEMPTS})`
      );
      await sleep(delay);
      continue;
    }

    return html;
  }

  throw new Error(
    `Google is rate-limiting requests (${lastError}). Please wait a few minutes before trying again.`
  );
}

// =============================================================================
// PROTOBUF ENCODING
// =============================================================================

let protoRoot: protobuf.Root | null = null;

function getProtoRoot(): protobuf.Root {
  if (protoRoot) return protoRoot;

  // Define protobuf schema programmatically (avoids needing .proto file at runtime)
  const root = new protobuf.Root();

  const Airport = new protobuf.Type('Airport').add(new protobuf.Field('airport', 2, 'string'));

  // Google encodes multi-airport legs by repeating these fields, so they must be
  // declared as repeated even though a single-airport search only sets one.
  const FlightData = new protobuf.Type('FlightData')
    .add(new protobuf.Field('date', 2, 'string'))
    .add(new protobuf.Field('maxStops', 9, 'int32', 'optional'))
    .add(new protobuf.Field('fromFlight', 13, 'Airport', 'repeated'))
    .add(new protobuf.Field('toFlight', 14, 'Airport', 'repeated'));

  const Seat = new protobuf.Enum('Seat', {
    UNKNOWN_SEAT: 0,
    ECONOMY: 1,
    PREMIUM_ECONOMY: 2,
    BUSINESS: 3,
    FIRST: 4,
  });

  const Trip = new protobuf.Enum('Trip', {
    UNKNOWN_TRIP: 0,
    ROUND_TRIP: 1,
    ONE_WAY: 2,
    MULTI_CITY: 3,
  });

  const Passenger = new protobuf.Enum('Passenger', {
    UNKNOWN_PASSENGER: 0,
    ADULT: 1,
    CHILD: 2,
    INFANT_IN_SEAT: 3,
    INFANT_ON_LAP: 4,
  });

  const Info = new protobuf.Type('Info')
    .add(new protobuf.Field('seat', 1, 'Seat'))
    .add(new protobuf.Field('data', 3, 'FlightData', 'repeated'))
    .add(new protobuf.Field('passengers', 6, 'Passenger', 'repeated'))
    .add(new protobuf.Field('trip', 19, 'Trip'));

  root.add(Airport);
  root.add(FlightData);
  root.add(Seat);
  root.add(Trip);
  root.add(Passenger);
  root.add(Info);

  protoRoot = root;
  return root;
}

/**
 * Google accepts several airports per leg (the `from_flight` / `to_flight`
 * fields are repeated). Accepts "SFO", "SFO,OAK" or ["SFO", "OAK"].
 */
export function parseAirportList(value: string | string[]): string[] {
  const raw = Array.isArray(value) ? value : String(value).split(',');
  const codes = raw
    .map((code) => code.trim().toUpperCase())
    .filter((code) => code.length > 0);
  if (codes.length === 0) {
    throw new Error('At least one airport code is required');
  }
  for (const code of codes) {
    if (!/^[A-Z]{3}$/.test(code)) {
      throw new Error(`Invalid airport code "${code}" — expected a 3-letter IATA code`);
    }
  }
  return codes;
}

export async function buildTfsParam(options: {
  origin: string | string[];
  destination: string | string[];
  departureDate: string;
  returnDate?: string;
  tripType: TripType;
  seatClass: SeatClass;
  adults: number;
  children: number;
  infantsInSeat: number;
  infantsOnLap: number;
  maxStops?: number;
}): Promise<string> {
  const root = getProtoRoot();
  const Info = root.lookupType('Info');

  // Build passenger list
  const passengers: number[] = [];
  for (let i = 0; i < options.adults; i++) passengers.push(1); // ADULT
  for (let i = 0; i < options.children; i++) passengers.push(2); // CHILD
  for (let i = 0; i < options.infantsInSeat; i++) passengers.push(3);
  for (let i = 0; i < options.infantsOnLap; i++) passengers.push(4);

  // Build flight legs
  const flightData: protobuf.Message[] = [];

  const origins = parseAirportList(options.origin);
  const destinations = parseAirportList(options.destination);

  const outboundLeg: Record<string, unknown> = {
    date: options.departureDate,
    fromFlight: origins.map((airport) => ({ airport })),
    toFlight: destinations.map((airport) => ({ airport })),
  };
  if (options.maxStops !== undefined) {
    outboundLeg.maxStops = options.maxStops;
  }
  flightData.push(outboundLeg as unknown as protobuf.Message);

  // Return leg for round trips
  if (options.tripType === 'round_trip' && options.returnDate) {
    const returnLeg: Record<string, unknown> = {
      date: options.returnDate,
      fromFlight: destinations.map((airport) => ({ airport })),
      toFlight: origins.map((airport) => ({ airport })),
    };
    if (options.maxStops !== undefined) {
      returnLeg.maxStops = options.maxStops;
    }
    flightData.push(returnLeg as unknown as protobuf.Message);
  }

  const message = Info.create({
    data: flightData,
    seat: SEAT_MAP[options.seatClass],
    passengers,
    trip: TRIP_MAP[options.tripType],
  });

  const buffer = Info.encode(message).finish();
  return Buffer.from(buffer)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

// =============================================================================
// HTML FETCHING & PARSING
// =============================================================================

function buildFlightsUrl(tfs: string, currency: string): string {
  const url = new URL('https://www.google.com/travel/flights');
  url.searchParams.set('tfs', tfs);
  url.searchParams.set('hl', 'en');
  url.searchParams.set('tfu', 'EgQIABABIgA');
  url.searchParams.set('curr', currency);
  return url.toString();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractDs1(html: string): any | null {
  const marker = "AF_initDataCallback({key: 'ds:1'";
  const start = html.indexOf(marker);
  if (start === -1) return null;

  const dataStart = html.indexOf('data:', start) + 5;
  let depth = 0;
  for (let i = dataStart; i < html.length; i++) {
    if (html[i] === '[' || html[i] === '{') depth++;
    if (html[i] === ']' || html[i] === '}') depth--;
    if (depth === 0) {
      try {
        return JSON.parse(html.substring(dataStart, i + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

function formatTime(timeArr: number[] | null | undefined): string {
  if (!timeArr || timeArr.length === 0) return '';
  const hour = timeArr[0];
  const minute = timeArr.length > 1 ? timeArr[1] : 0;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function formatDate(dateArr: number[] | null | undefined): string {
  if (!dateArr || dateArr.length < 3) return '';
  return `${dateArr[0]}-${String(dateArr[1]).padStart(2, '0')}-${String(dateArr[2]).padStart(2, '0')}`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseSegment(leg: any[]): FlightSegment | null {
  if (!leg) return null;

  const flightInfo = leg[22]; // [carrier_code, flight_number, null, marketing_carrier]

  return {
    flight_number: flightInfo ? `${flightInfo[0]}${flightInfo[1]}` : '',
    airline: flightInfo?.[3] || '',
    airline_code: flightInfo?.[0] || '',
    operated_by: leg[2] || null,
    aircraft: leg[17] || null,
    origin: leg[3] || '',
    origin_name: leg[4] || '',
    destination: leg[6] || '',
    destination_name: leg[5] || '',
    departure: formatTime(leg[8]),
    arrival: formatTime(leg[10]),
    departure_date: formatDate(leg[20]),
    arrival_date: formatDate(leg[21]),
    duration_minutes: leg[11] || 0,
    legroom: leg[30] || leg[14] || null,
  };
}

// Layovers live in details[13]: one entry per connection, shaped as
// [minutes, code, code, null, airport name, city, ...]. Google only populates
// it for itineraries with at least one stop.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseLayovers(details: any): FlightLayover[] {
  const raw = details?.[13];
  if (!Array.isArray(raw)) return [];

  const layovers: FlightLayover[] = [];
  for (const entry of raw) {
    if (!Array.isArray(entry)) continue;
    const minutes = entry[0];
    const airport = entry[1];
    if (typeof minutes !== 'number' || typeof airport !== 'string') continue;
    layovers.push({
      airport,
      airport_name: typeof entry[4] === 'string' ? entry[4] : null,
      minutes,
    });
  }
  return layovers;
}

// Emissions live in details[22], alongside the fare tier:
//   [_, _, fareTier, deltaPercent, _, _, _, grams, typicalGrams, _, otherTypical, ...]
// `grams` is this itinerary's CO2e estimate, `typicalGrams` is Google's
// reference for the route, and `deltaPercent` is the rounded difference
// (negative = less CO2 than typical). Verified: grams / typicalGrams - 1
// reproduces deltaPercent across sampled offers.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseEmissions(details: any): FlightEmissions | null {
  const raw = details?.[22];
  if (!Array.isArray(raw)) return null;

  const grams = raw[7];
  const typicalGrams = raw[8];
  const deltaPercent = raw[3];
  if (typeof grams !== 'number' || typeof typicalGrams !== 'number') return null;

  return {
    grams,
    typical_grams: typicalGrams,
    delta_percent:
      typeof deltaPercent === 'number'
        ? deltaPercent
        : Math.round((grams / typicalGrams - 1) * 100),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseExtensions(raw: any): FlightExtensions {
  // offer[4][6] contains baggage amenity flags: [carry_on_flag, checked_bag_flag]
  // carry_on_flag: 0 = included
  // checked_bag_flag: 0 = not included, 1 = one bag included, 2 = two bags included
  const amenityFlags = raw?.[4]?.[6];
  const carryOnIncluded = Array.isArray(amenityFlags) ? amenityFlags[0] === 0 : true;
  const checkedBagsIncluded = Array.isArray(amenityFlags) ? amenityFlags[1] || 0 : 0;

  return {
    carry_on_included: carryOnIncluded,
    checked_bags_included: checkedBagsIncluded,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseFareBrand(raw: any): string | null {
  // Google Flights does not include fare brand names (e.g. "Basic Economy", "Main Cabin")
  // in the initial search results HTML. However, details[22][2] contains a numeric fare tier
  // indicator that correlates with fare restrictions and amenity levels.
  //
  // Observed mapping from cross-referencing with amenity data and pricing patterns:
  //   1 = Economy (lowest tier for the airline — often "Basic Economy" for US carriers)
  //   2 = Economy+ / Standard (mid-tier with some extras like seat selection)
  //   3 = Economy Flex / Full (higher tier with more flexibility, carry-on, etc.)
  //
  // This is a best-effort interpretation of undocumented numeric codes.
  // Use the `extensions` field for concrete amenity details (carry-on, checked bags).
  const fareTier = raw?.[0]?.[22]?.[2];
  if (fareTier === undefined || fareTier === null) return null;

  switch (fareTier) {
    case 1:
      return 'Economy';
    case 2:
      return 'Economy+';
    case 3:
      return 'Economy Flex';
    default:
      return null;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseRawOffer(raw: any, currency: string): FlightOffer | null {
  const details = raw[0];
  const priceData = raw[1];
  const rankData = raw[5]; // [is_best (1/0), ?, ?]

  if (!details || !priceData) return null;

  // Parse segments
  const segments: FlightSegment[] = [];
  const legs = details[2];
  if (Array.isArray(legs)) {
    for (const leg of legs) {
      const segment = parseSegment(leg);
      if (segment) segments.push(segment);
    }
  }

  const price = priceData[0]?.[1];
  if (price === undefined || price === null) return null;

  return {
    price,
    currency,
    airline: details[1]?.[0] || '',
    airline_code: details[0] || '',
    is_best: rankData?.[0] === 1,
    fare_brand: parseFareBrand(raw),
    departure: formatTime(details[5]),
    arrival: formatTime(details[8]),
    departure_date: formatDate(details[4]),
    arrival_date: formatDate(details[7]),
    duration_minutes: details[9] || 0,
    stops: segments.length > 0 ? segments.length - 1 : 0,
    segments,
    layovers: parseLayovers(details),
    emissions: parseEmissions(details),
    extensions: parseExtensions(raw),
    booking_token: priceData[1] || '',
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseFlightOffers(ds1: any, currency: string): FlightOffer[] {
  const offers: FlightOffer[] = [];
  const seenTokens = new Set<string>();

  // Google Flights returns results in two sections:
  // - ds1[2][0]: "Best flights" (featured/highlighted flights, typically 3)
  // - ds1[3][0]: "Other flights" (the main results list)
  // Both sections use the same offer structure. In practice flights are not
  // duplicated between them, but we deduplicate by booking_token defensively
  // since this is an undocumented scraped API that could change.
  //
  // The is_best flag comes from raw[5][0] (per-offer rankData), not from which
  // section the offer appears in. Google sets this flag on all ds1[2][0] offers
  // and sometimes on ds1[3][0] offers too.

  // Parse "best flights" from ds1[2][0]
  const bestFlights = ds1?.[2]?.[0];
  if (Array.isArray(bestFlights)) {
    for (const raw of bestFlights) {
      try {
        const offer = parseRawOffer(raw, currency);
        if (offer && !seenTokens.has(offer.booking_token)) {
          seenTokens.add(offer.booking_token);
          offers.push(offer);
        }
      } catch (e) {
        logDebug('parseFlightOffers', `Skipping malformed best offer: ${(e as Error).message}`);
      }
    }
  }

  // Parse "other flights" from ds1[3][0]
  const otherFlights = ds1?.[3]?.[0];
  if (Array.isArray(otherFlights)) {
    for (const raw of otherFlights) {
      try {
        const offer = parseRawOffer(raw, currency);
        if (offer && !seenTokens.has(offer.booking_token)) {
          seenTokens.add(offer.booking_token);
          offers.push(offer);
        }
      } catch (e) {
        logDebug('parseFlightOffers', `Skipping malformed offer: ${(e as Error).message}`);
      }
    }
  }

  return offers;
}

function sortOffers(offers: FlightOffer[], sortBy: SearchFlightsOptions['sort_by']): FlightOffer[] {
  const sorted = [...offers];

  switch (sortBy) {
    case 'price':
      sorted.sort((a, b) => a.price - b.price);
      break;
    case 'duration':
      sorted.sort((a, b) => a.duration_minutes - b.duration_minutes);
      break;
    case 'departure':
      sorted.sort((a, b) => a.departure.localeCompare(b.departure));
      break;
    case 'arrival':
      sorted.sort((a, b) => a.arrival.localeCompare(b.arrival));
      break;
    case 'emissions':
      sorted.sort((a, b) => {
        const aGrams = a.emissions?.grams ?? Number.POSITIVE_INFINITY;
        const bGrams = b.emissions?.grams ?? Number.POSITIVE_INFINITY;
        if (aGrams !== bGrams) return aGrams - bGrams;
        return a.price - b.price;
      });
      break;
    case 'best':
    default:
      // Google's default ordering: best flights first, then others
      sorted.sort((a, b) => {
        if (a.is_best && !b.is_best) return -1;
        if (!a.is_best && b.is_best) return 1;
        return a.price - b.price;
      });
      break;
  }

  return sorted;
}

function filterByStops(
  offers: FlightOffer[],
  maxStops: SearchFlightsOptions['max_stops']
): FlightOffer[] {
  if (maxStops === 'any') return offers;

  const maxStopsNum = maxStops === 'nonstop' ? 0 : parseInt(maxStops, 10);

  return offers.filter((o) => o.stops <= maxStopsNum);
}

function minutesOfDay(time: string): number | null {
  const [hours, minutes] = time.split(':').map((part) => Number(part));
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return hours * 60 + minutes;
}

/** Local-time window check; unparseable times are kept rather than dropped. */
function withinWindow(time: string, after?: string, before?: string): boolean {
  const value = minutesOfDay(time);
  if (value === null) return true;
  if (after) {
    const from = minutesOfDay(after);
    if (from !== null && value < from) return false;
  }
  if (before) {
    const to = minutesOfDay(before);
    if (to !== null && value > to) return false;
  }
  return true;
}

function matchesAirlineList(offer: FlightOffer, wanted: string[]): boolean {
  const codes = wanted.map((value) => value.trim().toUpperCase());
  const names = wanted.map((value) => value.trim().toLowerCase());
  return offer.segments.some(
    (segment) =>
      codes.includes(segment.airline_code.toUpperCase()) ||
      names.includes(segment.airline.toLowerCase())
  );
}

/**
 * Airline, time-of-day, duration and layover preferences. Google's own query
 * does not cover these, so they are applied to the parsed offers.
 */
export type OfferPreferences = Pick<
  SearchFlightsOptions,
  | 'airlines'
  | 'exclude_airlines'
  | 'departure_after'
  | 'departure_before'
  | 'arrival_after'
  | 'arrival_before'
  | 'max_duration_minutes'
  | 'max_layover_minutes'
>;

export function filterOffersByPreferences(
  offers: FlightOffer[],
  options: OfferPreferences
): FlightOffer[] {
  let filtered = offers;

  if (options.airlines && options.airlines.length > 0) {
    filtered = filtered.filter((offer) => matchesAirlineList(offer, options.airlines!));
  }
  if (options.exclude_airlines && options.exclude_airlines.length > 0) {
    filtered = filtered.filter((offer) => !matchesAirlineList(offer, options.exclude_airlines!));
  }
  if (options.departure_after || options.departure_before) {
    filtered = filtered.filter((offer) =>
      withinWindow(offer.departure, options.departure_after, options.departure_before)
    );
  }
  if (options.arrival_after || options.arrival_before) {
    filtered = filtered.filter((offer) =>
      withinWindow(offer.arrival, options.arrival_after, options.arrival_before)
    );
  }
  if (options.max_duration_minutes !== undefined) {
    const limit = options.max_duration_minutes;
    filtered = filtered.filter((offer) => offer.duration_minutes <= limit);
  }
  if (options.max_layover_minutes !== undefined) {
    const limit = options.max_layover_minutes;
    filtered = filtered.filter((offer) => offer.layovers.every((l) => l.minutes <= limit));
  }

  return filtered;
}

// Determine whether an offer is a true basic-economy fare for the purposes of
// the exclude_basic_economy filter.
//
// The fare-tier number (fare_brand "Economy" = tier 1) is NOT a reliable
// indicator on its own. On many international routes Google ranks standard,
// fully-amenitied economy fares as the lowest tier — e.g. United's SFO→CTS
// nonstop is tier 1 yet includes a free checked bag and is surfaced as a normal
// option on Google's web UI. Excluding every tier-1 fare therefore silently
// drops legitimate (often the cheapest) itineraries.
//
// A genuine basic-economy product is distinguished by stripping amenities. The
// dependable signal in Google's payload is checked-bag inclusion: the carry-on
// flag (amenityFlags[0]) is frequently null on international fares, but the
// checked-bag count is populated. We therefore treat a fare as basic economy
// only when it is the lowest fare tier AND includes no free checked bag. This
// keeps amenitied tier-1 fares (like the United example) while still excluding
// the bare-bones, restriction-heavy fares the filter is meant to remove.
export function isBasicEconomy(offer: FlightOffer): boolean {
  return offer.fare_brand === 'Economy' && offer.extensions.checked_bags_included === 0;
}

// =============================================================================
// PRICE INSIGHTS
// =============================================================================

// Google renders its verdict as an icon and a sentence ("Prices are currently
// low"). The icon name is the most stable signal.
function parsePriceLevel(html: string): PriceInsights['level'] {
  // Icon names look like ic_price_typical_dark_32px / ic_price_typical_2_32px.
  const icon = html.match(/ic_price_(low|typical|high)(?:_[a-z0-9]+)*_32px/);
  if (icon) return icon[1] as PriceInsights['level'];

  // Fall back to the sentence, ignoring whatever markup wraps the keyword.
  const stripped = html.replace(/<[^>]*>/g, ' ');
  const text = stripped.match(/Prices are currently\s+(low|typical|high)\b/i);
  return text ? (text[1].toLowerCase() as PriceInsights['level']) : null;
}

// ds1[5][1..5] holds the price-history summary as [null, value] pairs:
//   [1] current price, [2] baseline price, [3] difference from baseline,
//   [4] low end of the tracked range, [5] high end of the tracked range.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parsePriceInsights(ds1: any, html: string): PriceInsights | null {
  const pick = (index: number): number | null => {
    const entry = ds1?.[5]?.[index];
    const value = Array.isArray(entry) ? entry[1] : undefined;
    return typeof value === 'number' ? value : null;
  };

  const currentPrice = pick(1);
  const baseline = pick(2);
  const difference = pick(3);
  const rangeLow = pick(4);
  const rangeHigh = pick(5);
  const level = parsePriceLevel(html);

  if (
    currentPrice === null &&
    baseline === null &&
    rangeLow === null &&
    rangeHigh === null &&
    level === null
  ) {
    return null;
  }

  return {
    level,
    current_price: currentPrice,
    baseline_price: baseline,
    difference_from_baseline: difference,
    range_low: rangeLow,
    range_high: rangeHigh,
  };
}

// =============================================================================
// PUBLIC API
// =============================================================================

interface FetchedSearchPage {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ds1: any;
  html: string;
  url: string;
  /** False when Google served fares from a different cabin than requested. */
  cabin_honored: boolean;
}

const CABIN_PHRASE: Record<SeatClass, string> = {
  economy: 'economy class',
  premium_economy: 'premium economy class',
  business: 'business class',
  first: 'first class',
};

interface SearchPageOptions {
  origin: string | string[];
  destination: string | string[];
  departure_date: string;
  return_date?: string;
  trip_type: TripType;
  seat_class: SeatClass;
  adults: number;
  children: number;
  infants_in_seat: number;
  infants_on_lap: number;
  currency: string;
}

/**
 * Google quietly ignores the cabin enum inside `tfs`: a business-class `tfs`
 * still comes back with economy fares. Its natural-language query endpoint does
 * honour the cabin, so for anything above economy we ask in words instead of
 * protobuf. (Premium economy is not understood by that endpoint, so it falls
 * back to `tfs` and is reported as not honoured.)
 */
export function buildQueryString(options: SearchPageOptions): string {
  const origins = parseAirportList(options.origin);
  const destinations = parseAirportList(options.destination);

  let query = `Flights from ${origins.join(' or ')} to ${destinations.join(' or ')}`;
  if (options.trip_type === 'round_trip' && options.return_date) {
    query += ` departing ${options.departure_date} returning ${options.return_date}`;
  } else {
    query += ` on ${options.departure_date}`;
  }

  const travellers = options.adults + options.children;
  if (travellers > 1) {
    query += ` for ${travellers} passengers`;
  }

  query += ` ${CABIN_PHRASE[options.seat_class]}`;
  return query;
}

function buildQueryUrl(query: string, currency: string): string {
  const url = new URL('https://www.google.com/travel/flights');
  url.searchParams.set('q', query);
  url.searchParams.set('hl', 'en');
  url.searchParams.set('curr', currency);
  return url.toString();
}

/**
 * Build the Google Flights URL for a query, fetch it politely, and parse the
 * embedded result payload. Shared by searchFlights and getDateGrid so both go
 * through the same rate limiter.
 */
async function fetchSearchPage(options: SearchPageOptions): Promise<FetchedSearchPage> {
  // Cabin-aware path: ask in words when the caller wants more than economy.
  if (options.seat_class !== 'economy') {
    const queryUrl = buildQueryUrl(buildQueryString(options), options.currency);
    const queryHtml = await rateLimitedFetch(queryUrl);
    const queryDs1 = extractDs1(queryHtml);
    if (queryDs1) {
      const probe = parseFlightOffers(queryDs1, options.currency);
      if (probe.length > 0) {
        return { ds1: queryDs1, html: queryHtml, url: queryUrl, cabin_honored: true };
      }
    }
    logWarning(
      'fetch',
      `Natural-language cabin search returned no fares for ${options.seat_class}; falling back to tfs (cabin may be ignored)`
    );
  }

  const tfs = await buildTfsParam({
    origin: options.origin,
    destination: options.destination,
    departureDate: options.departure_date,
    returnDate: options.return_date,
    tripType: options.trip_type,
    seatClass: options.seat_class,
    adults: options.adults,
    children: options.children,
    infantsInSeat: options.infants_in_seat,
    infantsOnLap: options.infants_on_lap,
  });

  const url = buildFlightsUrl(tfs, options.currency);
  const html = await rateLimitedFetch(url);

  const ds1 = extractDs1(html);
  if (!ds1) {
    throw new Error(
      'Failed to parse Google Flights response. The page structure may have changed.'
    );
  }

  return {
    ds1,
    html,
    url,
    cabin_honored: options.seat_class === 'economy',
  };
}

/** Parse the historical low-price series Google embeds (past ~60 days). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parsePriceHistory(ds1: any): PricePoint[] {
  const series = ds1?.[5]?.[10]?.[0];
  if (!Array.isArray(series)) return [];

  const points: PricePoint[] = [];
  for (const entry of series) {
    if (Array.isArray(entry) && typeof entry[0] === 'number' && typeof entry[1] === 'number') {
      points.push({ date: new Date(entry[0]).toISOString().split('T')[0], price: entry[1] });
    }
  }
  return points;
}

export async function searchFlights(options: SearchFlightsOptions): Promise<SearchFlightsResult> {
  // Note: max_stops filtering is done client-side after parsing results.
  // Sending maxStops=0 in the protobuf can cause Google to return empty results.
  const { ds1, html, url, cabin_honored } = await fetchSearchPage({
    origin: options.origin,
    destination: options.destination,
    departure_date: options.departure_date,
    return_date: options.return_date,
    trip_type: options.trip_type,
    seat_class: options.seat_class,
    adults: options.adults,
    children: options.children,
    infants_in_seat: options.infants_in_seat,
    infants_on_lap: options.infants_on_lap,
    currency: options.currency,
  });

  let allOffers = parseFlightOffers(ds1, options.currency);

  // Apply client-side stop filter (supplements the protobuf filter)
  allOffers = filterByStops(allOffers, options.max_stops);

  // Airline / time-of-day / duration / layover preferences
  allOffers = filterOffersByPreferences(allOffers, options);

  // Drop itineraries above the emissions threshold (percent above typical).
  if (options.max_emissions_percent !== undefined) {
    const limit = options.max_emissions_percent;
    allOffers = allOffers.filter(
      (o) => o.emissions === null || o.emissions.delta_percent <= limit
    );
  }

  // Filter out basic economy fares. A fare is treated as basic economy only when
  // it is the lowest fare tier AND includes no free checked bag — see isBasicEconomy
  // for why the tier number alone over-excludes legitimate amenitied economy fares.
  if (options.exclude_basic_economy) {
    allOffers = allOffers.filter((o) => !isBasicEconomy(o));
  }

  // Sort
  allOffers = sortOffers(allOffers, options.sort_by);

  const totalResults = allOffers.length;

  // Paginate
  const paginated = allOffers.slice(options.offset, options.offset + options.max_results);

  return {
    query: {
      origin: options.origin,
      destination: options.destination,
      origins: parseAirportList(options.origin),
      destinations: parseAirportList(options.destination),
      departure_date: options.departure_date,
      return_date: options.return_date,
      trip_type: options.trip_type,
      seat_class: options.seat_class,
      cabin_honored,
      passengers: {
        adults: options.adults,
        children: options.children,
        infants_in_seat: options.infants_in_seat,
        infants_on_lap: options.infants_on_lap,
      },
    },
    total_results: totalResults,
    search_url: url,
    price_insights: parsePriceInsights(ds1, html),
    price_history: parsePriceHistory(ds1),
    showing: {
      offset: options.offset,
      count: paginated.length,
    },
    has_more: options.offset + paginated.length < totalResults,
    next_offset:
      options.offset + paginated.length < totalResults ? options.offset + paginated.length : null,
    notes: cabin_honored
      ? []
      : [
          `Google did not apply the ${options.seat_class.replace('_', ' ')} cabin filter for this query, so these fares may be from a lower cabin.`,
        ],
    flights: paginated,
  };
}

/**
 * Enumerate the dates a caller asked for, honouring the weekday filter and the
 * cap on how many live lookups we are willing to make in one call.
 */
function enumerateGridDates(options: GetDateGridOptions): { dates: string[]; truncated: boolean } {
  const from = options.start_date ?? options.departure_date;
  if (!from) {
    throw new Error('start_date (or departure_date) is required for a date grid');
  }
  const to = options.end_date ?? from;

  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error('Invalid date range — expected YYYY-MM-DD');
  }
  if (end < start) {
    throw new Error('end_date must not be before start_date');
  }

  const weekdays = options.weekdays?.map((day) => day.toLowerCase());
  const all: string[] = [];
  for (const cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    if (weekdays && weekdays.length > 0) {
      const name = cursor
        .toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' })
        .toLowerCase();
      if (!weekdays.includes(name)) continue;
    }
    all.push(cursor.toISOString().split('T')[0]);
  }

  const maxDates = Math.min(options.max_dates ?? 7, MAX_GRID_DATES);
  return { dates: all.slice(0, maxDates), truncated: all.length > maxDates };
}

export async function getDateGrid(options: GetDateGridOptions): Promise<DateGridResult> {
  const { dates, truncated } = enumerateGridDates(options);

  const samples: DateGridEntry[] = [];
  const noResults: string[] = [];
  let priceHistory: PricePoint[] = [];
  let insights: PriceInsights | null = null;
  let anchorUrl = '';
  let cabinHonored = options.seat_class === 'economy';

  for (const date of dates) {
    const page = await fetchSearchPage({
      origin: options.origin,
      destination: options.destination,
      departure_date: date,
      return_date: options.return_date,
      trip_type: options.trip_type,
      seat_class: options.seat_class,
      adults: options.adults,
      children: 0,
      infants_in_seat: 0,
      infants_on_lap: 0,
      currency: options.currency,
    });

    if (!anchorUrl) {
      anchorUrl = page.url;
      cabinHonored = page.cabin_honored;
      priceHistory = parsePriceHistory(page.ds1);
      insights = parsePriceInsights(page.ds1, page.html);
    }

    let offers = parseFlightOffers(page.ds1, options.currency);
    if (options.exclude_basic_economy) {
      offers = offers.filter((offer) => !isBasicEconomy(offer));
    }
    offers = filterOffersByPreferences(offers, options);
    if (offers.length === 0) {
      noResults.push(date);
      continue;
    }

    const best = offers.reduce((cheapest, offer) => (offer.price < cheapest.price ? offer : cheapest));
    samples.push({
      date,
      price: best.price,
      airline: best.airline,
      stops: best.stops,
      duration_minutes: best.duration_minutes,
      emissions_delta_percent: best.emissions?.delta_percent ?? null,
    });
  }

  const byPrice = [...samples].sort((a, b) => a.price - b.price || a.date.localeCompare(b.date));
  const limit = options.max_results ?? 10;

  return {
    date_grid: options.sort === 'price' ? byPrice : samples,
    cheapest: byPrice[0] ?? null,
    cheapest_dates: byPrice.slice(0, limit),
    date_range: samples.length > 0 ? { from: samples[0].date, to: samples[samples.length - 1].date } : null,
    searched_dates: dates,
    truncated,
    no_results_dates: noResults,
    price_history: priceHistory,
    price_insights: insights,
    search_url: anchorUrl,
    currency: options.currency,
    cabin_honored: cabinHonored,
    notes: cabinHonored
      ? []
      : [
          `Google did not apply the ${options.seat_class.replace('_', ' ')} cabin filter for this query, so these fares may be from a lower cabin.`,
        ],
  };
}

export async function findAirportCode(query: string): Promise<AirportResult[]> {
  // Google embeds airport entries in the flights page as
  //   [["HND",0],"Haneda Airport",["/m/0gxs8","Tokyo",...]]
  // so one request gives us code + name + city without a separate lookup API.
  const searchQuery = encodeURIComponent(query);
  const url = `https://www.google.com/travel/flights?q=${searchQuery}&hl=en`;

  const html = await rateLimitedFetch(url);

  const results: AirportResult[] = [];
  const seen = new Set<string>();

  const push = (code: string, name: string, city: string, country: string) => {
    if (seen.has(code)) return;
    seen.add(code);
    results.push({ code, name, city, country });
  };

  // Strategy 1: structured entries, which carry the city.
  const structured =
    /\[+"([A-Z]{3})",0\],"([^"]+)",\["(\/m\/[^"]+)","([^"]+)"/g;
  let match;
  while ((match = structured.exec(html)) !== null) {
    push(match[1], match[2], match[4], '');
  }

  // Strategy 2: entries without a city (still gives code + name).
  const plain = /\[+"([A-Z]{3})",0\],"([^"]+)"/g;
  while ((match = plain.exec(html)) !== null) {
    push(match[1], match[2], '', '');
  }

  // Strategy 3: airport-name strings that appear outside the data payload.
  if (results.length === 0) {
    const named =
      /\["([A-Z]{3})","([^"]*(?:International|Airport|Regional|Municipal)[^"]*)"/g;
    while ((match = named.exec(html)) !== null) {
      push(match[1], match[2], '', '');
    }
  }

  // Score and sort results by relevance to the query.
  const queryLower = query.toLowerCase();
  const scored = results.map((r) => {
    let score = 0;
    if (r.code.toLowerCase() === queryLower) score += 100;
    if (r.code.toLowerCase().includes(queryLower)) score += 50;
    if (r.name.toLowerCase().includes(queryLower)) score += 30;
    if (r.city.toLowerCase().includes(queryLower)) score += 40;
    if (r.country.toLowerCase().includes(queryLower)) score += 10;
    return { ...r, score };
  });

  // Filter to only relevant results (score > 0) unless we have no matches
  const relevant = scored.filter((r) => r.score > 0);
  const finalResults = relevant.length > 0 ? relevant : scored;

  finalResults.sort((a, b) => b.score - a.score);

  return finalResults.map(({ score: _score, ...rest }) => rest);
}

// For testing: export the internal parser
export { extractDs1, parseFlightOffers, formatTime, formatDate, filterByStops };

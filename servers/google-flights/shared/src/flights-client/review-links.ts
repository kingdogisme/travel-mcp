import protobuf from 'protobufjs';
import type { FlightSegment, MultiCityLeg, SeatClass } from './types.js';

/**
 * Public Google Flights link encoders (not airline checkout).
 *
 * TFS encoding here uses the current booking-page fields, which differ from
 * the legacy search-page encoder elsewhere in this service. The reverse-
 * engineered schema comes from KasperBuilds/google-flights-proto-mcp and fli.
 * A syntactically valid URL does NOT confirm Google retained the itinerary,
 * passenger total, or price. Always verify in the browser before paying.
 */
const IATA = /^[A-Z]{3}$/;
const FLIGHT = /^([A-Z0-9]{2})([0-9]{1,4})$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const CABINS: Record<SeatClass, number> = {
  economy: 1,
  premium_economy: 2,
  business: 3,
  first: 4,
};

function schema(): protobuf.Type {
  const root = new protobuf.Root();
  const airport = new protobuf.Type('Airport').add(new protobuf.Field('airport', 2, 'string'));
  const selected = new protobuf.Type('SelectedFlight')
    .add(new protobuf.Field('origin', 1, 'string'))
    .add(new protobuf.Field('date', 2, 'string'))
    .add(new protobuf.Field('destination', 3, 'string'))
    .add(new protobuf.Field('airline', 5, 'string'))
    .add(new protobuf.Field('flightNumber', 6, 'string'));
  const data = new protobuf.Type('FlightData')
    .add(new protobuf.Field('date', 2, 'string'))
    .add(new protobuf.Field('selectedFlights', 4, 'SelectedFlight', 'repeated'))
    .add(new protobuf.Field('fromAirport', 13, 'Airport', 'repeated'))
    .add(new protobuf.Field('toAirport', 14, 'Airport', 'repeated'));
  const pin = new protobuf.Type('MaxPin').add(new protobuf.Field('value', 1, 'uint64'));
  const info = new protobuf.Type('Info')
    .add(new protobuf.Field('markerOne', 1, 'uint32'))
    .add(new protobuf.Field('markerTwo', 2, 'uint32'))
    .add(new protobuf.Field('data', 3, 'FlightData', 'repeated'))
    .add(new protobuf.Field('passengers', 8, 'int32', 'repeated'))
    .add(new protobuf.Field('seat', 9, 'int32'))
    .add(new protobuf.Field('markerFourteen', 14, 'uint32'))
    .add(new protobuf.Field('pin', 16, 'MaxPin'))
    .add(new protobuf.Field('trip', 19, 'int32'));
  for (const type of [airport, selected, data, pin, info]) root.add(type);
  return info;
}
const TfsInfo = schema();

function assertAirport(code: string): string {
  const normalized = code.trim().toUpperCase();
  if (!IATA.test(normalized)) throw new Error('Exact Google itinerary link requires 3-letter IATA airports');
  return normalized;
}

function assertDate(value: string): string {
  if (!DATE.test(value) || Number.isNaN(Date.parse(value + 'T00:00:00Z'))) {
    throw new Error('Invalid departure date for exact Google itinerary link');
  }
  return value;
}

function encode(payload: Record<string, unknown>): string {
  const problem = TfsInfo.verify(payload);
  if (problem) throw new Error('Invalid Google TFS booking payload: ' + problem);
  return Buffer.from(TfsInfo.encode(TfsInfo.create(payload)).finish()).toString('base64url');
}

function url(path: 'search' | 'booking', tfs: string, currency: string): string {
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error('Currency must be an ISO code');
  const result = new URL('https://www.google.com/travel/flights/' + path);
  result.searchParams.set('tfs', tfs);
  result.searchParams.set('hl', 'en');
  result.searchParams.set('gl', 'US');
  result.searchParams.set('curr', currency);
  return result.toString();
}

function passengers(adults: number, children: number): number[] {
  if (!Number.isInteger(adults) || adults < 1 || adults > 9 ||
      !Number.isInteger(children) || children < 0 || adults + children > 9) {
    throw new Error('Google itinerary review link supports 1-9 travelers');
  }
  return [
    ...Array<number>(adults).fill(1),
    ...Array<number>(children).fill(2),
  ];
}

function encodedSegments(
  segments: FlightSegment[],
  from: string,
  to: string,
  departureDate: string
): Array<Record<string, string>> {
  if (segments.length < 1 || segments.length > 4) {
    throw new Error('Exact Google booking link requires 1-4 flight segments in each direction');
  }
  if (assertAirport(segments[0].origin) !== from ||
      assertAirport(segments[segments.length - 1].destination) !== to ||
      assertDate(segments[0].departure_date) !== departureDate) {
    throw new Error('Booking-link flight segments do not match the requested endpoints/date');
  }
  const encoded: Array<Record<string, string>> = [];
  for (let i = 0; i < segments.length; i++) {
    const leg = segments[i];
    const origin = assertAirport(leg.origin);
    const destination = assertAirport(leg.destination);
    const date = assertDate(leg.departure_date);
    const number = leg.flight_number.toUpperCase().match(FLIGHT);
    if (!number || leg.airline_code.toUpperCase() !== number[1] ||
        (i && (segments[i - 1].destination.toUpperCase() !== origin ||
          segments[i - 1].arrival_date > date)) ||
        date < departureDate) {
      throw new Error('Disjoint or invalid flight numbers/dates in Google booking deep link');
    }
    encoded.push({
      origin,
      date,
      destination,
      airline: number[1],
      flightNumber: number[2],
    });
  }
  return encoded;
}

/**
 * Generate a deterministic Google booking-page REVIEW link for the exact
 * OUTBOUND and RETURN flights, without scraping seller quotes.
 * This is NOT an airline/OTA checkout URL and does not verify the price.
 */
export function buildExactRoundTripReviewLink(options: {
  outbound: FlightSegment[];
  inbound: FlightSegment[];
  departure_date: string;
  return_date: string;
  origin: string;
  destination: string;
  adults: number;
  children: number;
  seat_class: SeatClass;
  currency: string;
}): string {
  const origin = assertAirport(options.origin);
  const destination = assertAirport(options.destination);
  const departureDate = assertDate(options.departure_date);
  const returnDate = assertDate(options.return_date);
  if (returnDate < departureDate) throw new Error('Return date precedes departure');
  const out = encodedSegments(options.outbound, origin, destination, departureDate);
  const back = encodedSegments(options.inbound, destination, origin, returnDate);
  const payload = {
    markerOne: 28,
    markerTwo: 2,
    data: [
      { date: departureDate, fromAirport: [{ airport: origin }],
        toAirport: [{ airport: destination }], selectedFlights: out },
      { date: returnDate, fromAirport: [{ airport: destination }],
        toAirport: [{ airport: origin }], selectedFlights: back },
    ],
    passengers: passengers(options.adults, options.children),
    seat: CABINS[options.seat_class],
    trip: 1,
    markerFourteen: 1,
    // uint64 max represented by low/high 32-bit words (avoid JS precision loss).
    pin: { value: { low: 0xffffffff, high: 0xffffffff, unsigned: true } },
  };
  return url('booking', encode(payload), options.currency);
}

/**
 * An initial Google MULTI-CITY search-page link. DO NOT treat the URL as
 * evidence of a joint ticket quote: Google may fetch its results through a
 * separate client-side RPC and may not preserve all legs on every device.
 */
export function buildMultiCityResearchLink(options: {
  legs: MultiCityLeg[];
  adults: number;
  children: number;
  infants_in_seat: number;
  infants_on_lap: number;
  seat_class: SeatClass;
  currency: string;
}): string {
  if (options.legs.length < 2 || options.legs.length > 6) {
    throw new Error('Multi-city search link requires 2-6 legs');
  }
  const travellerCodes = passengers(options.adults, options.children);
  if (!Number.isInteger(options.infants_in_seat) || options.infants_in_seat < 0 ||
      !Number.isInteger(options.infants_on_lap) || options.infants_on_lap < 0 ||
      options.infants_in_seat + travellerCodes.length > 9 ||
      options.infants_on_lap > options.adults) {
    throw new Error('Invalid infant count for Google multi-city research link');
  }
  travellerCodes.push(...Array<number>(options.infants_in_seat).fill(3));
  travellerCodes.push(...Array<number>(options.infants_on_lap).fill(4));

  const data = options.legs.map((leg) => ({
    date: assertDate(leg.date),
    fromAirport: [{ airport: assertAirport(leg.origin) }],
    toAirport: [{ airport: assertAirport(leg.destination) }],
  }));
  const result = encode({
    data, passengers: travellerCodes,
    seat: CABINS[options.seat_class], trip: 3,
  });
  return url('search', result, options.currency);
}

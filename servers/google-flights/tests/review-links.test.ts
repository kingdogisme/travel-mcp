import { describe, expect, it } from 'vitest';
import protobuf from 'protobufjs';
import {
  buildExactRoundTripReviewLink,
  buildMultiCityResearchLink,
} from '../shared/src/flights-client/review-links.js';
import type { FlightSegment } from '../shared/src/flights-client/types.js';

function flight(changes: Partial<FlightSegment> = {}): FlightSegment {
  return {
    flight_number: 'UA327', airline: 'United Airlines', airline_code: 'UA',
    operated_by: null, aircraft: 'Boeing 737',
    origin: 'SAN', origin_name: 'San Diego',
    destination: 'EWR', destination_name: 'Newark',
    departure: '08:00', arrival: '16:00',
    departure_date: '2026-11-20', arrival_date: '2026-11-20',
    duration_minutes: 360, legroom: null,
    ...changes,
  };
}

const outbound = [
  flight(),
  flight({
    flight_number: 'UA54', origin: 'EWR', destination: 'CDG',
    departure_date: '2026-11-20', arrival_date: '2026-11-21',
  }),
];

const inbound = [
  flight({
    flight_number: 'UA986', origin: 'CDG', destination: 'ORD',
    departure_date: '2026-11-29', arrival_date: '2026-11-29',
  }),
  flight({
    flight_number: 'UA2472', origin: 'ORD', destination: 'SAN',
    departure_date: '2026-11-29', arrival_date: '2026-11-29',
  }),
];

const bookingInput = {
  origin: 'SAN', destination: 'CDG',
  outbound, inbound,
  departure_date: '2026-11-20',
  return_date: '2026-11-29',
  adults: 2, children: 0, seat_class: 'economy' as const,
  currency: 'USD',
};

type DecodedField = { n: number; v: number | string | Uint8Array };
function fields(bytes: Uint8Array): DecodedField[] {
  const r = protobuf.Reader.create(bytes);
  const result: DecodedField[] = [];
  while (r.pos < r.len) {
    const tag = r.uint32(), n = tag >>> 3, wire = tag & 7;
    if (wire === 0) result.push({ n, v: r.uint64().toString() });
    else if (wire === 2) result.push({ n, v: r.bytes() });
    else {
      r.skipType(wire);
      throw new Error('Unexpected test TFS wire type ' + wire);
    }
  }
  return result;
}

function decodeLink(url: string) {
  const parsed = new URL(url);
  const tfs = parsed.searchParams.get('tfs');
  if (!tfs) throw new Error('Missing TFS');
  return { parsed, root: fields(Buffer.from(tfs, 'base64url')) };
}

function legFields(raw: DecodedField) {
  if (!(raw.v instanceof Uint8Array)) throw new Error('Expected nested protobuf');
  return fields(raw.v);
}

describe('exact Google Flights review links', () => {
  it('pins all four physical segments, correct passengers and booking markers', () => {
    const link = buildExactRoundTripReviewLink(bookingInput);
    const { parsed, root } = decodeLink(link);
    expect(parsed.origin).toBe('https://www.google.com');
    expect(parsed.pathname).toBe('/travel/flights/booking');
    expect(parsed.searchParams.has('tfu')).toBe(false);
    expect(parsed.searchParams.get('curr')).toBe('USD');
    expect(parsed.searchParams.get('gl')).toBe('US');

    const routeRecords = root.filter((x) => x.n === 3);
    expect(routeRecords).toHaveLength(2);
    expect(legFields(routeRecords[0]).filter((x) => x.n === 4)).toHaveLength(2);
    expect(legFields(routeRecords[1]).filter((x) => x.n === 4)).toHaveLength(2);
    const text = Buffer.from(parsed.searchParams.get('tfs')!, 'base64url').toString('latin1');
    for (const value of ['SAN', 'EWR', 'CDG', 'ORD', '327', '54', '986', '2472']) {
      expect(text).toContain(value);
    }
    expect(root.find((x) => x.n === 1)?.v).toBe('28');
    expect(root.find((x) => x.n === 2)?.v).toBe('2');
    expect(root.find((x) => x.n === 9)?.v).toBe('1');
    expect(root.find((x) => x.n === 14)?.v).toBe('1');
    expect(root.find((x) => x.n === 19)?.v).toBe('1');
    const pack = root.find((x) => x.n === 8)?.v;
    expect(pack).toBeInstanceOf(Uint8Array);
    expect([...pack as Uint8Array]).toEqual([1, 1]);
    const pin = root.find((x) => x.n === 16);
    expect(pin).toBeDefined();
    expect(legFields(pin!).find((x) => x.n === 1)?.v).toBe('18446744073709551615');
  });

  it('generates deterministic URLs and never includes raw session/booking selection tokens', () => {
    const first = buildExactRoundTripReviewLink(bookingInput);
    expect(buildExactRoundTripReviewLink({ ...bookingInput })).toBe(first);
    expect(first).not.toContain('tfu=');
    expect(first).not.toContain('booking_token');
  });

  it('rejects disconnected routes, wrong dates and invalid passenger counts', () => {
    expect(() => buildExactRoundTripReviewLink({
      ...bookingInput, inbound: [inbound[0], flight({ ...inbound[1], origin: 'JFK' })],
    })).toThrow(/Disjoint/);
    expect(() => buildExactRoundTripReviewLink({
      ...bookingInput, inbound: [flight({ ...inbound[0], departure_date: '2026-11-28' }), inbound[1]],
    })).toThrow(/endpoints\/date/);
    expect(() => buildExactRoundTripReviewLink({ ...bookingInput, adults: 0 })).toThrow(/traveler/);
    expect(() => buildExactRoundTripReviewLink({ ...bookingInput, adults: 10 })).toThrow(/travelers/);
  });

  it('creates a two-leg Multi-city search UI link without pretending it is a joint quote', () => {
    const research = buildMultiCityResearchLink({
      legs: [
        { origin: 'SAN', destination: 'CDG', date: '2026-11-20' },
        { origin: 'FCO', destination: 'SAN', date: '2026-11-29' },
      ],
      adults: 2, children: 0, infants_in_seat: 0, infants_on_lap: 0,
      seat_class: 'economy', currency: 'USD',
    });
    const { parsed, root } = decodeLink(research);
    expect(parsed.pathname).toBe('/travel/flights/search');
    expect(root.filter((x) => x.n === 3)).toHaveLength(2);
    expect(root.find((x) => x.n === 19)?.v).toBe('3');
    expect(parsed.searchParams.has('tfu')).toBe(false);
    const data = Buffer.from(parsed.searchParams.get('tfs')!, 'base64url').toString('latin1');
    for (const code of ['SAN', 'CDG', 'FCO']) expect(data).toContain(code);
    expect(root.some((x) => x.n === 14 || x.n === 16)).toBe(false);
  });

  it('rejects invalid multi-city inputs rather than silently converting to a one-way', () => {
    const base = {
      adults: 2, children: 0, infants_in_seat: 0, infants_on_lap: 0,
      seat_class: 'economy' as const, currency: 'USD',
    };
    expect(() => buildMultiCityResearchLink({
      ...base, legs: [{ origin: 'SAN', destination: 'CDG', date: '2026-11-20' }],
    })).toThrow(/2-6/);
    expect(() => buildMultiCityResearchLink({
      ...base, legs: [
        { origin: 'SAN', destination: 'CDG', date: '2026-11-20' },
        { origin: '???', destination: 'SAN', date: '2026-11-29' },
      ],
    })).toThrow(/IATA/);
  });
});

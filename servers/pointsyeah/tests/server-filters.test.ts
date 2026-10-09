import { describe, expect, it } from 'vitest';
import { applyResultFilters } from '../shared/src/server.js';
import { buildSearchUrl } from '../shared/src/pointsyeah-client/lib/search.js';
import { getUserSubFromIdToken } from '../shared/src/pointsyeah-client/lib/auth.js';
import type { FlightResult, FlightRoute, FlightSegment, FlightSearchParams } from '../shared/src/types.js';

function segment(overrides: Partial<FlightSegment> = {}): FlightSegment {
  return {
    duration: 600,
    flight_number: 'AF83',
    dt: '2026-11-18T11:00:00',
    da: 'SFO',
    at: '2026-11-18T21:00:00',
    aa: 'LHR',
    cabin: 'Business',
    ...overrides,
  };
}

function route(overrides: {
  miles?: number;
  tax?: number;
  cabin?: string;
  seats?: number;
  segments?: FlightSegment[];
  transfer?: FlightRoute['transfer'];
} = {}): FlightRoute {
  return {
    payment: {
      currency: 'USD',
      tax: overrides.tax ?? 100,
      miles: overrides.miles ?? 70000,
      cabin: overrides.cabin ?? 'Business',
      unit: 'miles',
      seats: overrides.seats ?? 2,
      cash_price: 2000,
    },
    segments: overrides.segments ?? [segment()],
    transfer: overrides.transfer ?? [{ bank: 'Amex', actual_points: 70000, points: 70000 }],
  };
}

function result(overrides: Partial<FlightResult> & { routes?: FlightRoute[] } = {}): FlightResult {
  return {
    program: 'Flying Blue',
    code: 'flyingblue',
    date: '2026-11-18',
    departure: 'SFO',
    arrival: 'LHR',
    routes: [route()],
    ...overrides,
  };
}

const BASE: FlightSearchParams = {
  departure: 'SFO',
  arrival: 'LHR',
  departDate: '2026-11-18',
  tripType: '1',
  adults: 1,
  children: 0,
  cabins: ['Business'],
  multiday: false,
  transferBonusOnly: false,
  buyPointsPromotionOnly: false,
  excludeRedeye: false,
  sortBy: 'miles',
} as FlightSearchParams;

describe('applyResultFilters', () => {
  it('drops routes whose cabin does not match and counts them', () => {
    const stats: { droppedByCabin?: number } = {};
    const results = [
      result({ routes: [route({ cabin: 'Business' }), route({ cabin: 'Economy' })] }),
    ];
    const filtered = applyResultFilters(results, BASE, stats);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].routes).toHaveLength(1);
    expect(filtered[0].routes?.[0].payment?.cabin).toBe('Business');
    expect(stats.droppedByCabin).toBe(1);
  });

  it('removes results that have no route left after filtering', () => {
    const filtered = applyResultFilters([result({ routes: [route({ cabin: 'Economy' })] })], BASE);
    expect(filtered).toEqual([]);
  });

  it('applies miles, tax, seats and stop caps', () => {
    const results = [result({ routes: [route({ miles: 90000, tax: 300, seats: 1 })] })];
    expect(applyResultFilters(results, { ...BASE, maxMiles: 80000 })).toEqual([]);
    expect(applyResultFilters(results, { ...BASE, maxTax: 200 })).toEqual([]);
    expect(applyResultFilters(results, { ...BASE, minSeats: 2 })).toEqual([]);
    expect(applyResultFilters(results, { ...BASE, maxMiles: 100000, maxTax: 400, minSeats: 1 })).toHaveLength(1);

    const twoStops = result({
      routes: [
        route({
          segments: [
            segment({ dt: '2026-11-18T11:00:00', at: '2026-11-18T13:00:00', aa: 'JFK' }),
            segment({ dt: '2026-11-18T15:00:00', at: '2026-11-18T18:00:00', da: 'JFK', aa: 'CDG' }),
            segment({ dt: '2026-11-18T20:00:00', at: '2026-11-18T22:00:00', da: 'CDG' }),
          ],
        }),
      ],
    });
    expect(applyResultFilters([twoStops], { ...BASE, maxStops: 1 })).toEqual([]);
    expect(applyResultFilters([twoStops], { ...BASE, maxStops: 2 })).toHaveLength(1);
  });

  it('drops long layovers and red-eye departures', () => {
    const longLayover = result({
      routes: [
        route({
          segments: [
            segment({ dt: '2026-11-18T08:00:00', at: '2026-11-18T10:00:00', aa: 'JFK' }),
            segment({ dt: '2026-11-18T18:00:00', at: '2026-11-19T06:00:00', da: 'JFK' }),
          ],
        }),
      ],
    });
    expect(applyResultFilters([longLayover], { ...BASE, maxLayoverMinutes: 300 })).toEqual([]);
    expect(applyResultFilters([longLayover], { ...BASE, maxLayoverMinutes: 600 })).toHaveLength(1);

    const redeye = result({ routes: [route({ segments: [segment({ dt: '2026-11-18T23:30:00' })] })] });
    expect(applyResultFilters([redeye], { ...BASE, excludeRedeye: true })).toEqual([]);
    expect(applyResultFilters([redeye], BASE)).toHaveLength(1);
  });

  it('honours an explicit program list but ignores the promotion pseudo-programs', () => {
    const results = [result(), result({ program: 'Aeroplan', code: 'aeroplan' })];
    const filtered = applyResultFilters(results, { ...BASE, airlineProgram: ['flyingblue'] });
    expect(filtered.map((entry) => entry.code)).toEqual(['flyingblue']);
    expect(
      applyResultFilters(results, { ...BASE, airlineProgram: ['Bank transfer promotion only'] })
    ).toHaveLength(2);
  });

  it('sorts by miles and respects the limit', () => {
    const results = [
      result({ code: 'pricey', routes: [route({ miles: 90000 })] }),
      result({ code: 'cheap', routes: [route({ miles: 30000 })] }),
    ];
    const sorted = applyResultFilters(results, { ...BASE, sortBy: 'miles' });
    expect(sorted.map((entry) => entry.code)).toEqual(['cheap', 'pricey']);
    expect(applyResultFilters(results, { ...BASE, sortBy: 'miles', limit: 1 })).toHaveLength(1);
  });

  it('sorts routes inside a result and leaves program order alone when asked', () => {
    const results = [result({ routes: [route({ miles: 90000 }), route({ miles: 40000 })] })];
    const byMiles = applyResultFilters(results, { ...BASE, sortBy: 'miles' });
    expect(byMiles[0].routes?.map((entry) => entry.payment?.miles)).toEqual([40000, 90000]);

    const byProgram = applyResultFilters(results, { ...BASE, sortBy: 'program' });
    expect(byProgram[0].routes?.map((entry) => entry.payment?.miles)).toEqual([90000, 40000]);
  });
});

describe('buildSearchUrl', () => {
  it('encodes the search, cabins, banks and promotion flags', () => {
    const url = buildSearchUrl({
      ...BASE,
      cabins: ['Business', 'First'],
      airlineProgram: ['flyingblue'],
      banks: ['Amex'],
      transferBonusOnly: true,
    });
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe('https://www.pointsyeah.com/search');
    expect(parsed.searchParams.get('cabins')).toBe('Business,First');
    expect(parsed.searchParams.get('cabin')).toBe('Business');
    expect(parsed.searchParams.get('banks')).toBe('Amex');
    expect(parsed.searchParams.get('airlineProgram')).toBe('flyingblue,Bank transfer promotion only');
    expect(parsed.searchParams.get('tripType')).toBe('1');
    expect(parsed.searchParams.get('departure')).toBe('SFO');
    expect(parsed.searchParams.get('arrival')).toBe('LHR');
    expect(parsed.searchParams.get('multiday')).toBe('false');
  });

  it('turns on flexible dates for a multi-day or window search', () => {
    const window = new URL(buildSearchUrl({ ...BASE, departDateTo: '2026-11-25' }));
    expect(window.searchParams.get('multiday')).toBe('true');
    expect(window.searchParams.get('departDateSec')).toBe('2026-11-25');

    const roundTrip = new URL(buildSearchUrl({ ...BASE, tripType: '2', returnDate: '2026-11-25' }));
    expect(roundTrip.searchParams.get('tripType')).toBe('2');
    expect(roundTrip.searchParams.get('returnDate')).toBe('2026-11-25');
  });

  it('adds the second leg for multi-city searches', () => {
    const url = new URL(
      buildSearchUrl({
        ...BASE,
        departure2: 'LHR',
        arrival2: 'CDG',
        departDate2: '2026-11-22',
      })
    );
    expect(url.searchParams.get('departure2')).toBe('LHR');
    expect(url.searchParams.get('arrival2')).toBe('CDG');
    expect(url.searchParams.get('departDate2')).toBe('2026-11-22');
  });
});

describe('getUserSubFromIdToken', () => {
  function token(payload: Record<string, unknown>): string {
    const encode = (value: Record<string, unknown>) =>
      Buffer.from(JSON.stringify(value)).toString('base64url');
    return `${encode({ alg: 'RS256' })}.${encode(payload)}.signature`;
  }

  it('reads the sub claim out of the JWT payload', () => {
    expect(getUserSubFromIdToken(token({ sub: 'abc-123', email: 'a@b.c' }))).toBe('abc-123');
  });

  it('throws when the token has no sub', () => {
    expect(() => getUserSubFromIdToken(token({ email: 'a@b.c' }))).toThrow(/user sub/);
  });
});

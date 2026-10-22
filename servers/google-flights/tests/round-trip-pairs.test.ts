import { describe, expect, it } from 'vitest';
import {
  buildSelectionTfu,
  buildTfsParam,
  quoteMetadataForSearch,
} from '../shared/src/flights-client/flights-client.js';
import { isMatchingReturn, searchRoundTripPairs } from '../shared/src/flights-client/round-trip-pairs.js';
import type {
  FlightOffer, FlightSegment, RoundTripPairsOptions, SearchFlightsOptions, SearchFlightsResult,
} from '../shared/src/flights-client/types.js';

function segment(changes: Partial<FlightSegment> = {}): FlightSegment {
  return {
    flight_number: 'AS372',
    airline: 'Alaska Airlines',
    airline_code: 'AS',
    operated_by: null,
    aircraft: 'Boeing 737',
    origin: 'SFO',
    origin_name: 'San Francisco',
    destination: 'LAX',
    destination_name: 'Los Angeles',
    departure: '09:00',
    arrival: '10:45',
    departure_date: '2026-11-10',
    arrival_date: '2026-11-10',
    duration_minutes: 105,
    legroom: null,
    ...changes,
  };
}

function fare(price: number, changes: Partial<FlightOffer> = {}): FlightOffer {
  return {
    price,
    currency: 'USD',
    airline: 'Alaska Airlines',
    airline_code: 'AS',
    is_best: false,
    fare_brand: 'Economy+',
    departure: '09:00',
    arrival: '10:45',
    departure_date: '2026-11-10',
    arrival_date: '2026-11-10',
    duration_minutes: 105,
    stops: 0,
    segments: [segment()],
    layovers: [],
    emissions: null,
    extensions: { carry_on_included: true, checked_bags_included: 1 },
    booking_token: Buffer.from([1, 2, 3, 4]).toString('base64'),
    ...changes,
  };
}
const inbound = fare(58, {
  airline: 'American Airlines',
  airline_code: 'AA',
  departure_date: '2026-11-14',
  arrival_date: '2026-11-14',
  segments: [segment({
    flight_number: 'AA110', airline: 'American Airlines', airline_code: 'AA',
    origin: 'LAX', destination: 'SFO',
    departure_date: '2026-11-14', arrival_date: '2026-11-14',
  })],
  booking_token: 'selected-booking-option-placeholder',
});

const options: RoundTripPairsOptions = {
  origin: 'SFO', destination: 'LAX',
  departure_date: '2026-11-10',
  return_date: '2026-11-14',
  seat_class: 'economy',
  adults: 1,
  children: 0,
  currency: 'USD',
  max_stops: 'nonstop',
  exclude_basic_economy: false,
  max_outbounds: 2,
  max_return_options: 5,
};

function outboundResult(opts: SearchFlightsOptions, offers: FlightOffer[]): SearchFlightsResult {
  return {
    query: {
      origin: opts.origin, destination: opts.destination,
      origins: ['SFO'], destinations: ['LAX'],
      departure_date: opts.departure_date,
      return_date: opts.return_date,
      trip_type: 'round_trip',
      seat_class: opts.seat_class,
      cabin_honored: true,
      passengers: {
        adults: opts.adults, children: opts.children,
        infants_in_seat: opts.infants_in_seat, infants_on_lap: opts.infants_on_lap,
      },
    },
    ...quoteMetadataForSearch('round_trip'),
    total_results: offers.length,
    search_url: 'https://www.google.com/travel/flights?tfs=outbound',
    price_insights: null,
    price_history: [],
    showing: { offset: 0, count: offers.length },
    has_more: false,
    next_offset: null,
    notes: [],
    flights: offers,
    cheapest_offer: offers[0] ?? null,
  };
}

describe('Google selected-return protobuf protocol', () => {
  it('encodes the selected flight identity in TFS while retaining both trip dates', async () => {
    const selected = await buildTfsParam({
      origin: 'SFO', destination: 'LAX',
      departureDate: '2026-11-10', returnDate: '2026-11-14',
      tripType: 'round_trip', seatClass: 'economy', adults: 1, children: 0,
      infantsInSeat: 0, infantsOnLap: 0,
      selectedOutbound: segment(),
    });
    const bytes = Buffer.from(selected.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    const printable = bytes.toString('latin1');
    expect(printable).toContain('2026-11-10');
    expect(printable).toContain('2026-11-14');
    expect(printable).toContain('AS');
    expect(printable).toContain('372');
    expect(printable).toContain('SFO');
    expect(printable).toContain('LAX');
  });

  it('encodes BOTH physical legs for a one-stop outbound, including overnight date', async () => {
    const connecting = [
      segment({ flight_number: 'AA112', airline_code: 'AA', origin: 'SAN', destination: 'DFW',
        departure_date: '2026-11-20', arrival_date: '2026-11-20' }),
      segment({ flight_number: 'AA224', airline_code: 'AA', origin: 'DFW', destination: 'CDG',
        departure_date: '2026-11-20', arrival_date: '2026-11-21' }),
    ];
    const tfs = await buildTfsParam({
      origin: 'SAN', destination: 'CDG',
      departureDate: '2026-11-20', returnDate: '2026-11-29',
      tripType: 'round_trip', seatClass: 'economy',
      adults: 2, children: 0, infantsInSeat: 0, infantsOnLap: 0,
      selectedOutbound: connecting,
    });
    const decoded = Buffer.from(tfs.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('latin1');
    for (const value of ['SAN', 'DFW', 'CDG', 'AA', '112', '224', '2026-11-20', '2026-11-29']) {
      expect(decoded).toContain(value);
    }
  });

  it('rejects disjoint flights rather than silently pinning a truncated itinerary', async () => {
    await expect(buildTfsParam({
      origin: 'SAN', destination: 'CDG', departureDate: '2026-11-20',
      returnDate: '2026-11-29', tripType: 'round_trip',
      seatClass: 'economy', adults: 1, children: 0, infantsInSeat: 0, infantsOnLap: 0,
      selectedOutbound: [
        segment({ flight_number: 'AA112', airline_code: 'AA',
          origin: 'SAN', destination: 'DFW', departure_date: '2026-11-20' }),
        segment({ flight_number: 'AA224', airline_code: 'AA',
          origin: 'JFK', destination: 'CDG', departure_date: '2026-11-20' }),
      ],
    })).rejects.toThrow(/do not connect/);
  });

  it('encodes the selection TFU envelope exactly, without synthesizing a token', () => {
    const encoded = buildSelectionTfu('AQID');
    expect(Buffer.from(encoded, 'base64').toString('hex')).toBe(
      '0a030102031202080022030a0130'
    );
    expect(() => buildSelectionTfu('not*base64')).toThrow(/Invalid/);
    expect(() => buildSelectionTfu('')).toThrow(/Invalid/);
  });

  it('refuses a selected flight that is not the requested airport/date/airline', async () => {
    await expect(buildTfsParam({
      origin: 'SFO', destination: 'LAX',
      departureDate: '2026-11-10', returnDate: '2026-11-14',
      tripType: 'round_trip', seatClass: 'economy', adults: 1,
      children: 0, infantsInSeat: 0, infantsOnLap: 0,
      selectedOutbound: segment({ origin: 'OAK' }),
    })).rejects.toThrow(/does not match/);
  });
});

describe('Google round-trip pair completion', () => {
  it('returns an outbound + matching return at the second-stage displayed price (not the sum)', async () => {
    const initial = fare(48);
    let searches = 0;
    let selected = 0;
    const output = await searchRoundTripPairs(
      options,
      async (query) => {
        searches++;
        expect(query.trip_type).toBe('round_trip');
        expect(query.return_date).toBe(options.return_date);
        expect(query.max_stops).toBe('nonstop');
        return outboundResult(query, [initial]);
      },
      async (tfs, tfu, currency) => {
        selected++;
        expect(currency).toBe('USD');
        expect(tfs).toMatch(/^[A-Za-z0-9_-]+$/);
        expect(tfu).toBe(buildSelectionTfu(initial.booking_token));
        return { offers: [inbound], search_url: 'https://www.google.com/travel/flights?tfs=selected' };
      }
    );
    expect(searches).toBe(1);
    expect(selected).toBe(1);
    expect(output.search_status).toBe('pairs_found');
    expect(output.quote_status).toBe('round_trip_pair_selected');
    expect(output.pairs).toHaveLength(1);
    expect(output.cheapest_pair?.outbound.segments[0].flight_number).toBe('AS372');
    expect(output.cheapest_pair?.return_flight.segments[0].flight_number).toBe('AA110');
    expect(output.cheapest_pair?.displayed_round_trip_price).toBe(58);
    expect(output.cheapest_pair?.party_total).toBeNull();
    expect(output.cheapest_pair?.checkout_verified).toBe(false);
    expect(output.notes.join(' ')).toMatch(/not a confirmed booking-provider/i);
  });

  it('never calls an echoed outbound or wrong-date inbound a complete pair', async () => {
    const output = await searchRoundTripPairs(
      options,
      async (query) => outboundResult(query, [fare(48)]),
      async () => ({ offers: [
        fare(39),
        { ...inbound, segments: [segment({ origin: 'LAX', destination: 'SFO', departure_date: '2026-11-13' })] },
        { ...inbound, segments: [
          segment({ origin: 'LAX', destination: 'DEN', departure_date: '2026-11-14' }),
          segment({ origin: 'ORD', destination: 'SFO', departure_date: '2026-11-14' }),
        ] },
      ], search_url: 'https://www.google.com/travel/flights?tfs=wrong' })
    );
    expect(output.search_status).toBe('no_paired_results');
    expect(output.quote_status).toBe('round_trip_return_unselected');
    expect(output.pairs).toHaveLength(0);
    expect(output.cheapest_pair).toBeNull();
    expect(output.diagnostics[0].status).toBe('no_match');
  });

  it('skips connecting outbounds rather than encoding only their first flight', async () => {
    let selected = 0;
    const connection = fare(70, {
      stops: 1,
      segments: [segment({ destination: 'LAS' }), segment({ origin: 'LAS', destination: 'LAX' })],
    });
    const output = await searchRoundTripPairs(options,
      async (query) => outboundResult(query, [connection]),
      async () => {
        selected++;
        return { offers: [inbound], search_url: 'https://example.com' };
      }
    );
    expect(selected).toBe(0);
    expect(output.outbounds_considered).toBe(0);
    expect(output.search_status).toBe('no_outbound');
    expect(output.cheapest_pair).toBeNull();
  });

  it('selects a complete one-stop outbound and keeps two-adult pricing unverified', async () => {
    const multi = [
      segment({ flight_number: 'AA112', airline_code: 'AA', origin: 'SAN', destination: 'DFW',
        departure_date: '2026-11-20', arrival_date: '2026-11-20' }),
      segment({ flight_number: 'AA224', airline_code: 'AA', origin: 'DFW', destination: 'CDG',
        departure_date: '2026-11-20', arrival_date: '2026-11-21' }),
    ];
    const selected = fare(760, {
      stops: 1, segments: multi,
      booking_token: Buffer.from([10, 20, 30, 40]).toString('base64'),
    });
    const incoming = fare(820, {
      departure_date: '2026-11-29',
      segments: [segment({
        origin: 'CDG', destination: 'SAN',
        departure_date: '2026-11-29', arrival_date: '2026-11-29',
        flight_number: 'DL80', airline_code: 'DL',
      })],
    });
    const result = await searchRoundTripPairs({
      ...options, origin: 'SAN', destination: 'CDG',
      departure_date: '2026-11-20', return_date: '2026-11-29',
      outbound_max_stops: '1', adults: 2,
    }, async (query) => {
      expect(query.max_stops).toBe('1');
      expect(query.adults).toBe(2);
      const match = outboundResult(query, [selected]);
      match.query.origin = 'SAN';
      match.query.destination = 'CDG';
      match.query.origins = ['SAN'];
      match.query.destinations = ['CDG'];
      return match;
    }, async (tfs) => {
      const decoded = Buffer.from(tfs.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('latin1');
      expect(decoded).toContain('112');
      expect(decoded).toContain('224');
      return { offers: [incoming], search_url: 'https://www.google.com/travel/flights?tfs=selected' };
    });

    expect(result.search_status).toBe('pairs_found');
    expect(result.cheapest_pair?.outbound.segments).toHaveLength(2);
    expect(result.cheapest_pair?.return_flight.segments).toHaveLength(1);
    expect(result.cheapest_pair?.displayed_round_trip_price).toBe(820);
    expect(result.query.adults).toBe(2);
    expect(result.party_total).toBeNull();
    expect(result.cheapest_pair?.price_basis).toBe('google_displayed_fare_unverified');
    expect(result.cheapest_pair?.checkout_verified).toBe(false);
    expect(result.outbounds_considered).toBe(1);
  });

  it('rejects an outbound whose connection jumps airports despite one-stop opt-in', async () => {
    const broken = fare(790, {
      stops: 1, segments: [
        segment({ flight_number: 'AA112', airline_code: 'AA',
          origin: 'SAN', destination: 'DFW', departure_date: '2026-11-20' }),
        segment({ flight_number: 'AA224', airline_code: 'AA',
          origin: 'JFK', destination: 'CDG', departure_date: '2026-11-20' }),
      ],
    });
    const result = await searchRoundTripPairs({
      ...options, origin: 'SAN', destination: 'CDG',
      departure_date: '2026-11-20', return_date: '2026-11-29',
      outbound_max_stops: '1',
    }, async (query) => {
      const mock = outboundResult(query, [broken]);
      mock.query.origin = 'SAN';
      mock.query.destination = 'CDG';
      return mock;
    }, async () => {
      throw new Error('Must not query Google with an unconnected outbound');
    });
    expect(result.outbounds_considered).toBe(0);
    expect(result.return_searches).toBe(0);
    expect(result.cheapest_pair).toBeNull();
  });

  it('returns explicit partial results if a selected outbound cannot be fetched', async () => {
    const second = fare(60, {
      segments: [segment({ flight_number: 'AS401' })],
      booking_token: Buffer.from([9, 8, 7, 6]).toString('base64'),
    });
    let attempts = 0;
    const output = await searchRoundTripPairs(options,
      async (query) => outboundResult(query, [fare(48), second]),
      async () => {
        attempts++;
        if (attempts === 2) throw new Error('Google selected-leg parser changed');
        return { offers: [inbound], search_url: 'https://www.google.com/travel/flights?tfs=selected' };
      }
    );
    expect(output.search_status).toBe('partial');
    expect(output.pairs).toHaveLength(1);
    expect(output.diagnostics.map((x) => x.status)).toEqual(['ok', 'failed']);
    expect(output.diagnostics[1].note).toMatch(/parser changed/);
    expect(output.checkout_verified).toBe(false);
  });

  it('fails closed if Google did not honor the round-trip request or cabin', async () => {
    await expect(searchRoundTripPairs(options,
      async (query) => ({ ...outboundResult(query, [fare(48)]), quote_status: 'indicative_one_way' }),
      async () => ({ offers: [inbound], search_url: 'https://example.com' })
    )).rejects.toThrow(/did not honor/);

    await expect(searchRoundTripPairs(options,
      async (query) => ({ ...outboundResult(query, [fare(48)]), query: { ...outboundResult(query, [fare(48)]).query, cabin_honored: false } }),
      async () => ({ offers: [inbound], search_url: 'https://example.com' })
    )).rejects.toThrow(/did not honor/);
  });

  it('rejects non-economy cabin before making any requests', async () => {
    let called = false;
    await expect(searchRoundTripPairs(
      { ...options, seat_class: 'business' as never },
      async (query) => { called = true; return outboundResult(query, [fare(48)]); }
    )).rejects.toThrow(/economy only/);
    expect(called).toBe(false);
  });
});

describe('return route validation', () => {
  const origins = new Set(['SFO']);
  const destinations = new Set(['LAX']);
  it('accepts a same-day direct LAX to SFO return', () => {
    expect(isMatchingReturn(inbound, '2026-11-14', origins, destinations, 'nonstop', 'USD')).toBe(true);
  });
  it('rejects reversed flights and too many connections', () => {
    expect(isMatchingReturn(fare(48), '2026-11-14', origins, destinations, 'any', 'USD')).toBe(false);
    const connecting = fare(87, {
      segments: [
        segment({ origin: 'LAX', destination: 'DEN', departure_date: '2026-11-14' }),
        segment({ origin: 'DEN', destination: 'SFO', departure_date: '2026-11-14' }),
      ],
    });
    expect(isMatchingReturn(connecting, '2026-11-14', origins, destinations, 'nonstop', 'USD')).toBe(false);
    expect(isMatchingReturn(connecting, '2026-11-14', origins, destinations, '1', 'USD')).toBe(true);
  });
});

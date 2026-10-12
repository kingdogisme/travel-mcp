import { describe, expect, it } from 'vitest';
import { lowestPricedOffer, searchMultiCity } from '../shared/src/flights-client/flights-client.js';
import type {
  FlightOffer, SearchFlightsOptions, SearchFlightsResult, SearchMultiCityOptions,
} from '../shared/src/flights-client/types.js';

function fare(price: number, duration_minutes = 900): FlightOffer {
  return {
    price, currency: 'USD', airline: 'Mock Air', airline_code: 'MK',
    is_best: true, fare_brand: 'Economy', departure: '08:00', arrival: '12:00',
    departure_date: '2026-11-20', arrival_date: '2026-11-21',
    duration_minutes, stops: 1, segments: [], layovers: [],
    emissions: null, extensions: { carry_on_included: true, checked_bags_included: 1 },
    booking_token: 'mock-' + price,
  };
}

const itinerary: SearchMultiCityOptions = {
  legs: [
    { origin: 'SAN', destination: 'CDG', date: '2026-11-20' },
    { origin: 'FCO', destination: 'SAN', date: '2026-11-29' },
  ],
  seat_class: 'economy', adults: 2, children: 0, infants_in_seat: 0,
  infants_on_lap: 0, max_stops: '1', sort_by: 'duration',
  max_results: 1, currency: 'USD', exclude_basic_economy: false,
};

function result(opts: SearchFlightsOptions, displayed: FlightOffer[], lowest: FlightOffer | null): SearchFlightsResult {
  return {
    query: {
      origin: opts.origin, destination: opts.destination,
      origins: [String(opts.origin)], destinations: [String(opts.destination)],
      departure_date: opts.departure_date, trip_type: opts.trip_type,
      seat_class: opts.seat_class, cabin_honored: true,
      passengers: {
        adults: opts.adults, children: opts.children,
        infants_in_seat: opts.infants_in_seat, infants_on_lap: opts.infants_on_lap,
      },
    },
    total_results: displayed.length > 0 ? 4 : 0,
    search_url: 'https://www.google.com/travel/flights',
    price_insights: null, price_history: [], showing: { offset: 0, count: displayed.length },
    has_more: true, next_offset: 1, notes: [], flights: displayed,
    cheapest_offer: lowest,
  };
}

describe('multi-city price integrity', () => {
  it('finds the minimum independent of display order, then declines to invent a party/joint quote', async () => {
    const searcher = async (opts: SearchFlightsOptions) =>
      opts.origin === 'SAN'
        ? result(opts, [fare(1875, 400)], fare(760, 950))
        : result(opts, [fare(1697, 600)], fare(962, 1100));

    const response = await searchMultiCity(itinerary, searcher);
    expect(response.pricing_mode).toBe('separate_one_ways');
    expect(response.joint_ticket_quote).toBeNull();
    expect(response.price_basis).toBe('google_displayed_fare_unverified');
    expect(response.passengers.adults).toBe(2);
    expect(response.coverage_status).toBe('complete');
    expect(response.legs.map((leg) => leg.options[0].price)).toEqual([1875, 1697]);
    expect(response.legs.map((leg) => leg.lowest_price)).toEqual([760, 962]);
    expect(response.cheapest_total?.total).toBe(1722);
    expect(response.cheapest_total?.quote_kind).toBe('separate_one_way_displayed_fare_sum');
    expect(response.cheapest_total?.party_total).toBeNull();
    expect(response.notes.join(' ')).toMatch(/not an actual combined/i);
  });

  it('preserves valid legs and refuses to quote when one search fails', async () => {
    const searcher = async (opts: SearchFlightsOptions) => {
      if (opts.origin === 'FCO') throw new Error('upstream parser blocked');
      return result(opts, [fare(800)], fare(760));
    };
    const response = await searchMultiCity(itinerary, searcher);
    expect(response.coverage_status).toBe('partial');
    expect(response.cheapest_total).toBeNull();
    expect(response.legs[0].status).toBe('ok');
    expect(response.legs[1].status).toBe('failed');
    expect(response.legs[1].error).toMatch(/upstream parser blocked/);
    expect(response.legs[1].notes.join(' ')).toMatch(/not interpret this as no fares/i);
  });

  it('does not turn no-results or an unpriced partial page into a zero-cost itinerary', async () => {
    const empty = await searchMultiCity(itinerary, async (opts) =>
      opts.origin === 'SAN' ? result(opts, [], null) : result(opts, [fare(962)], fare(962)));
    expect(empty.legs[0].status).toBe('no_results');
    expect(empty.cheapest_total).toBeNull();

    const unknown = await searchMultiCity(itinerary, async (opts) =>
      opts.origin === 'SAN' ? result(opts, [fare(760)], undefined as never) : result(opts, [fare(962)], fare(962)));
    expect(unknown.legs[0].status).toBe('unpriced');
    expect(unknown.cheapest_total).toBeNull();
  });

  it('calculates lowest priced offer from the entire set without mutating it', () => {
    const offers = [fare(1875, 400), fare(760, 950), fare(900, 600)];
    expect(lowestPricedOffer(offers)?.price).toBe(760);
    expect(offers.map((entry) => entry.price)).toEqual([1875, 760, 900]);
    expect(lowestPricedOffer([])).toBeNull();
  });
});

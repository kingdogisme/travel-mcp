import { describe, expect, it } from 'vitest';
import { TripCompareClient } from '../shared/src/compare.js';
import type { CompareOptions } from '../shared/src/types.js';
import type { IFlightsClient, SearchFlightsResult, FlightOffer } from 'google-flights-mcp-server-shared';
import type {
  IPointsYeahClient,
  FlightResult,
  FlightSearchResults,
  CheapestAwardDatesResult,
} from 'pointsyeah-mcp-server-shared';
import type { SeatsAeroOption } from '../shared/src/seats-aero.js';

const CASH_OFFER: FlightOffer = {
  price: 2000,
  currency: 'USD',
  airline: 'United',
  airline_code: 'UA',
  is_best: true,
  fare_brand: 'Business',
  departure: '11:00',
  arrival: '15:00',
  departure_date: '2026-11-18',
  arrival_date: '2026-11-19',
  duration_minutes: 600,
  stops: 0,
  segments: [
    {
      flight_number: 'UA1',
      airline: 'United',
      airline_code: 'UA',
      operated_by: null,
      aircraft: 'Boeing 777',
      origin: 'SFO',
      origin_name: 'San Francisco',
      destination: 'LHR',
      destination_name: 'London',
      departure: '11:00',
      arrival: '15:00',
      departure_date: '2026-11-18',
      arrival_date: '2026-11-19',
      duration_minutes: 600,
      legroom: null,
    },
  ],
  layovers: [],
  emissions: null,
  extensions: { carry_on_included: true, checked_bags_included: 2 },
  booking_token: 'tok',
};

function cashResult(price = 2000): SearchFlightsResult {
  return {
    flights: [{ ...CASH_OFFER, price }],
    total_results: 1,
    has_more: false,
    next_offset: null,
    search_url: 'https://www.google.com/travel/flights?tfs=abc',
    quote_status: 'indicative_one_way',
    price_basis: 'google_displayed_fare_unverified',
    party_total: null,
    checkout_verified: false,
    query: {
      origin: 'SFO', destination: 'LHR', trip_type: 'one_way', cabin_honored: true,
      passengers: { adults: 1, children: 0, infants_in_seat: 0, infants_on_lap: 0 },
    },
    notes: [],
    price_insights: { level: 'typical', range_low: 1800, range_high: 2400 },
  } as unknown as SearchFlightsResult;
}

function awardResult(
  options: { miles?: number; tax?: number; seats?: number; bonus?: number } = {}
): FlightSearchResults {
  const result: FlightResult = {
    program: 'Flying Blue',
    code: 'flyingblue',
    date: '2026-11-18',
    departure: 'SFO',
    arrival: 'LHR',
    routes: [
      {
        payment: {
          currency: 'USD',
          tax: options.tax ?? 100,
          miles: options.miles ?? 70000,
          cabin: 'Business',
          unit: 'miles',
          seats: options.seats ?? 2,
          cash_price: 2000,
        },
        segments: [
          {
            duration: 600,
            flight_number: 'AF83',
            dt: '2026-11-18T11:00:00',
            da: 'SFO',
            at: '2026-11-19T15:00:00',
            aa: 'LHR',
            cabin: 'Business',
          },
        ],
        transfer: options.bonus
          ? [
              {
                bank: 'Amex',
                actual_points: 70000,
                points: 70000,
                bonus_percentage: options.bonus,
                bonus_end_date: Date.UTC(2026, 10, 30) / 1000,
                bonus_slogn: `${options.bonus}% Bonus, Exp Nov 30`,
                code: 'Amex',
              },
            ]
          : [{ bank: 'Amex', actual_points: 70000, points: 70000, code: 'Amex' }],
      },
    ],
  };
  return { total: 1, unfiltered_total: 3, results: [result], notes: [] };
}

interface Calls {
  cashDates: string[];
  awardDates: string[];
  awardTripTypes: string[];
  gridCalls: number;
  secondSourceCalls: number;
  secondSourceParams: Array<{ startDate: string; endDate: string; origins: string[] }>;
}

/** Dates relative to today, because the second source enforces a live window. */
function isoPlus(days: number): string {
  const now = new Date();
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + days));
  return date.toISOString().slice(0, 10);
}

const SOON = isoPlus(30);

/** A program that prices several distinct itineraries. */
function awardResultWithRoutes(routeCount: number): FlightSearchResults {
  const routes = Array.from({ length: routeCount }, (_, index) => ({
    payment: {
      currency: 'USD',
      tax: 100 + index,
      miles: 70000 + index * 5000,
      cabin: 'Business',
      unit: 'miles',
      seats: 2,
      cash_price: 2000,
    },
    segments: [
      {
        duration: 600,
        flight_number: `AF${80 + index}`,
        dt: `2026-11-18T1${index}:00:00`,
        da: 'SFO',
        at: '2026-11-19T15:00:00',
        aa: 'LHR',
        cabin: 'Business',
      },
    ],
    transfer: [{ bank: 'Amex', actual_points: 70000, points: 70000, code: 'Amex' }],
  }));
  const result: FlightResult = {
    program: 'Flying Blue',
    code: 'flyingblue',
    date: '2026-11-18',
    departure: 'SFO',
    arrival: 'LHR',
    routes,
  };
  return { total: routeCount, unfiltered_total: routeCount, results: [result], notes: [] };
}

function seatsAeroOptions(count = 2): SeatsAeroOption[] {
  return Array.from({ length: count }, (_, index) => ({
    flight_ref: `ref-${index}`,
    origin: 'SFO',
    destination: 'LHR',
    cabin: 'business',
    departs_at: '2026-11-18 18:15',
    arrives_at: '2026-11-19 14:25',
    stops: 0,
    flight_numbers: `IB35${index}`,
    miles: 22000 + index * 1000,
    program_id: 'american',
    program_code: 'AA',
    program_name: 'American Airlines AAdvantage',
    operating_carriers: ['IB'],
    tax: 100.7,
    tax_currency: 'USD',
    duration_minutes: 670,
    seats: index === 0 ? 2 : null,
    data_age_minutes: 1593,
  }));
}

function makeClient(config: {
  cash?: SearchFlightsResult | null;
  awards?: FlightSearchResults | null;
  gridCheapest?: { date: string; price: number; airline: string | null } | null;
  awardCheapest?: CheapestAwardDatesResult['cheapest'];
  cashThrows?: boolean;
  awardThrows?: boolean;
  routesPerProgram?: number;
  carrier?: string;
  secondSource?: SeatsAeroOption[] | 'throws';
}) {
  const calls: Calls = {
    cashDates: [],
    awardDates: [],
    awardTripTypes: [],
    gridCalls: 0,
    secondSourceCalls: 0,
    secondSourceParams: [],
  };
  const flights = {
    async searchFlights(options: { departure_date: string }) {
      calls.cashDates.push(options.departure_date);
      if (config.cashThrows) throw new Error('cash boom');
      if (config.cash === null) return { ...cashResult(), flights: [] } as SearchFlightsResult;
      const base = config.cash ?? cashResult();
      if (config.carrier) {
        return {
          ...base,
          flights: base.flights.map((offer) => ({ ...offer, airline_code: config.carrier })),
        } as SearchFlightsResult;
      }
      return base;
    },
    async getDateGrid() {
      calls.gridCalls += 1;
      return {
        cheapest: config.gridCheapest ?? null,
        quote_status: 'indicative_one_way',
        price_basis: 'google_displayed_fare_unverified',
        party_total: null,
        checkout_verified: false,
        cabin_honored: true,
      };
    },
  } as unknown as IFlightsClient;
  const pointsYeah = {
    async searchFlights(options: { departDate: string; tripType: string }) {
      calls.awardDates.push(options.departDate);
      calls.awardTripTypes.push(options.tripType);
      if (config.awardThrows) throw new Error('award boom');
      if (config.awards === null) {
        return { total: 0, unfiltered_total: 0, results: [], notes: [] } as FlightSearchResults;
      }
      if (config.awards) return config.awards;
      return config.routesPerProgram ? awardResultWithRoutes(config.routesPerProgram) : awardResult();
    },
    async findCheapestAwardDates() {
      return {
        window: { from: '2026-11-18', to: '2026-11-25' },
        dates: [],
        by_program: [],
        cheapest: config.awardCheapest ?? null,
        searched_dates: [],
        total_results: 0,
        unfiltered_total: 0,
        notes: [],
      } as CheapestAwardDatesResult;
    },
  } as unknown as IPointsYeahClient;

  const secondSource =
    config.secondSource === undefined
      ? undefined
      : {
          async searchFlights(params: { startDate: string; endDate: string; origins: string[] }) {
            calls.secondSourceCalls += 1;
            calls.secondSourceParams.push(params);
            if (config.secondSource === 'throws') throw new Error('seats boom');
            return config.secondSource as SeatsAeroOption[];
          },
        };

  return {
    client: new TripCompareClient({ flights, pointsYeah, ...(secondSource ? { secondSource } : {}) }),
    calls,
  };
}

const BASE: CompareOptions = {
  origin: 'SFO',
  destination: 'LHR',
  departDate: '2026-11-18',
  cabin: 'Business',
  adults: 1,
  useTransferBonuses: true,
  pointsLimit: 8,
  cashLimit: 5,
};

describe('PointsYeah incomplete upstream searches', () => {
  it('never recommends points or computes CPP after a partial timeout, even with seats', async () => {
    const awards = { ...awardResult({ seats: 9 }), completion_status: 'partial_timeout' as const };
    const { client } = makeClient({ awards });
    const response = await client.comparePointsVsCash(BASE);
    expect(response.points.completion_status).toBe('partial_timeout');
    expect(response.points.search_status).toBe('search_incomplete');
    expect(response.points.options.length).toBeGreaterThan(0);
    expect(response.points.options.every(option => option.cents_per_point === null)).toBe(true);
    expect(response.verdict.recommendation).toBe('insufficient_data');
    expect(response.verdict.cents_per_point).toBeNull();
    expect(response.verdict.best_award_program).toBeNull();
    expect(response.verdict.reason).toContain('partial_timeout');
  });

  it('treats partial results without awards as unknown, not a successful empty search', async () => {
    const awards = { ...awardResult(), completion_status: 'partial_error' as const, results: [] };
    const { client } = makeClient({ awards });
    const response = await client.comparePointsVsCash(BASE);
    expect(response.points.search_status).toBe('search_incomplete');
    expect(response.points.options).toHaveLength(0);
    expect(response.verdict.recommendation).toBe('insufficient_data');
    expect(response.verdict.reason).toContain('partial_error');
    expect(response.verdict.reason).not.toContain('returned no award space');
  });

  it('can still make an indicative recommendation when PointsYeah reports completed', async () => {
    const awards = { ...awardResult(), completion_status: 'completed' as const };
    const { client } = makeClient({ awards });
    const response = await client.comparePointsVsCash(BASE);
    expect(response.points.completion_status).toBe('completed');
    expect(response.points.search_status).toBe('awards_found');
    expect(response.verdict.recommendation).toBe('points');
    expect(response.verdict.cents_per_point).not.toBeNull();
  });
});

describe('comparePointsVsCash verdicts', () => {
  it('recommends points when the award clears the cents-per-point threshold', async () => {
    const { client } = makeClient({});
    const result = await client.comparePointsVsCash(BASE);
    expect(result.verdict.recommendation).toBe('points');
    expect(result.verdict.cents_per_point).toBeCloseTo(2.71, 2);
    expect(result.verdict.best_award_program).toBe('Flying Blue');
    expect(result.verdict.reason).toContain('Flying Blue');
    expect(result.cash.cheapest?.price).toBe(2000);
    expect(result.cash.search_status).toBe('fares_found');
    expect(result.cash.search_error).toBeNull();
    expect(result.cash.usable_for_valuation).toBe(true);
    expect(result.cash.comparable_price).toBe(2000);
    expect(result.cash.party_total).toBeNull();
    expect(result.cash.checkout_verified).toBe(false);
    expect(result.cash.price_insights_level).toBe('typical');
    expect(result.cash.price_history_low).toBe(1800);
  });

  it('recommends cash when the award is worth too little per mile', async () => {
    const { client } = makeClient({ cash: cashResult(500) });
    const result = await client.comparePointsVsCash(BASE);
    expect(result.verdict.recommendation).toBe('cash');
    expect(result.verdict.cents_per_point).toBeCloseTo(0.57, 2);
    expect(result.verdict.reason).toContain('below the 1.5 cent threshold');
  });

  it('honours a custom minCentsPerPoint threshold', async () => {
    const { client } = makeClient({});
    const result = await client.comparePointsVsCash({ ...BASE, minCentsPerPoint: 3 });
    expect(result.verdict.recommendation).toBe('cash');
  });

  it('reports insufficient_data when the searched sources return no awards', async () => {
    const { client } = makeClient({ awards: null });
    const result = await client.comparePointsVsCash(BASE);
    expect(result.verdict.recommendation).toBe('insufficient_data');
    expect(result.verdict.award_search_status).toBe('no_awards_returned');
    expect(result.points.search_status).toBe('no_awards_returned');
    expect(result.verdict.reason).toContain('not proof none is bookable');
    expect(result.verdict.reason).toContain('Iberia Club (IB)');
    expect(result.verdict.reason).toContain('check those directly');
    expect(result.verdict.reason).not.toContain('No award space was found');
    expect(result.points.options).toHaveLength(0);
  });

  it('keeps the award lead when no cash fare comes back, without claiming points win', async () => {
    const { client } = makeClient({ cash: null });
    const result = await client.comparePointsVsCash(BASE);
    expect(result.verdict.recommendation).toBe('insufficient_data');
    expect(result.cash.search_status).toBe('no_fares_returned');
    expect(result.cash.search_error).toBeNull();
    expect(result.verdict.reason).toContain('not proof no cash fare exists');
    expect(result.cash.cheapest).toBeNull();
    // No cash fare means no valuation — never a fabricated cents-per-point.
    expect(result.points.options[0].cents_per_point).toBeNull();
  });

  it('flags a failed cash lookup as unverified rather than free', async () => {
    const { client } = makeClient({ cashThrows: true });
    const result = await client.comparePointsVsCash(BASE);
    expect(result.cash.search_status).toBe('search_failed');
    expect(result.cash.search_error).toContain('cash boom');
    expect(result.verdict.recommendation).toBe('insufficient_data');
    expect(result.verdict.reason).toContain('no comparable cash price');
  });

  it('ignores award options that cannot seat the party', async () => {
    const { client } = makeClient({ awards: awardResult({ seats: 1 }) });
    const result = await client.comparePointsVsCash({ ...BASE, adults: 2 });
    expect(result.points.options).toHaveLength(1);
    expect(result.verdict.recommendation).toBe('insufficient_data');
    expect(result.cash.search_status).toBe('fares_unverified');
    expect(result.verdict.award_search_status).toBe('seats_insufficient');
    expect(result.verdict.reason).toContain('not a comparable completed ticket price');
  });

  it('keeps the comparison going when the award side errors, and says so', async () => {
    const { client } = makeClient({ awardThrows: true });
    const result = await client.comparePointsVsCash(BASE);
    expect(result.verdict.recommendation).toBe('insufficient_data');
    expect(result.verdict.award_search_status).toBe('search_failed');
    expect(result.points.search_error).toContain('award boom');
    expect(result.verdict.reason).toContain('did not complete');
    expect(result.cash.cheapest?.price).toBe(2000);
  });
});

describe('award coverage reporting', () => {
  it('lists the programs searched and the known coverage gaps', async () => {
    const { client } = makeClient({});
    const result = await client.comparePointsVsCash(BASE);
    expect(result.points.search_status).toBe('awards_found');
    expect(result.points.search_error).toBeNull();
    expect(result.points.programs_searched).toContain('AS');
    expect(result.points.programs_searched).toContain('AA');
    expect(result.points.programs_searched).not.toContain('IB');
    expect(result.points.coverage_gaps.map((gap) => gap.code)).toEqual(['IB', 'BA']);
    expect(result.points.coverage_last_verified).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('keeps unsearched programs visible when nothing comes back', async () => {
    const { client } = makeClient({ awards: null });
    const result = await client.comparePointsVsCash(BASE);
    expect(result.points.coverage_gaps.map((gap) => gap.code)).toContain('IB');
    expect(result.verdict.recommendation).toBe('insufficient_data');
    expect(result.verdict.best_award_program).toBeNull();
  });
});

describe('multiple itineraries per program', () => {
  it('keeps up to three routes per program instead of only the cheapest', async () => {
    const { client } = makeClient({ routesPerProgram: 5 });
    const result = await client.comparePointsVsCash(BASE);
    const miles = result.points.options.map((option) => option.miles).sort((a, b) => a - b);
    expect(miles).toEqual([70000, 75000, 80000]);
    expect(result.points.options.every((option) => option.program === 'flyingblue')).toBe(true);
  });

  it('keeps distinct itineraries under the same program', async () => {
    const { client } = makeClient({ routesPerProgram: 2 });
    const result = await client.comparePointsVsCash(BASE);
    expect(result.points.options).toHaveLength(2);
    expect(new Set(result.points.options.map((option) => option.itinerary)).size).toBe(2);
  });
});

/** The same Iberia-operated flight priced by three different programs. */
function sameFlightThreePrograms(): FlightSearchResults {
  const programs = [
    { code: 'aa', program: 'American Airlines AAdvantage', miles: 22500, tax: 100.7 },
    { code: 'as', program: 'Alaska Atmos Rewards', miles: 35000, tax: 25.6 },
    { code: 'ib', program: 'Iberia Club', miles: 32000, tax: 88.4 },
  ];
  const results: FlightResult[] = programs.map((entry) => ({
    program: entry.program,
    code: entry.code,
    date: '2026-11-18',
    departure: 'LAX',
    arrival: 'MAD',
    routes: [
      {
        payment: {
          currency: 'USD',
          tax: entry.tax,
          miles: entry.miles,
          cabin: 'Economy',
          unit: 'miles',
          seats: 2,
          cash_price: 900,
        },
        segments: [
          {
            duration: 670,
            flight_number: 'IB352',
            dt: '2026-11-18T18:15:00',
            da: 'LAX',
            at: '2026-11-19T14:25:00',
            aa: 'MAD',
            cabin: 'Economy',
          },
        ],
        transfer: [{ bank: 'Amex', actual_points: entry.miles, points: entry.miles, code: 'Amex' }],
      },
    ],
  }));
  return { total: 3, unfiltered_total: 3, results, notes: [] };
}

describe('acceptance: programs on the same flight', () => {
  it('keeps every program that prices the same operating flight', async () => {
    const { client } = makeClient({ awards: sameFlightThreePrograms() });
    const result = await client.comparePointsVsCash({ ...BASE, cabin: 'Economy' });
    const byProgram = new Map(result.points.options.map((option) => [option.program, option]));
    expect([...byProgram.keys()].sort()).toEqual(['aa', 'as', 'ib']);
    expect(byProgram.get('aa')?.miles).toBe(22500);
    expect(byProgram.get('as')?.miles).toBe(35000);
    expect(byProgram.get('ib')?.miles).toBe(32000);
    expect(byProgram.get('ib')?.operating_carriers).toContain('IB');
  });

  it('counts Alaska as supported when it returns live award space', async () => {
    const { client } = makeClient({ awards: sameFlightThreePrograms() });
    const result = await client.comparePointsVsCash({ ...BASE, cabin: 'Economy' });
    expect(result.points.programs_seen).toContain('as');
    expect(result.points.programs_searched).toContain('AS');
    expect(result.points.options.some((option) => option.program === 'as')).toBe(true);
  });
});

describe('carrier coverage gaps', () => {
  it('flags the operating carrier whose own program is not searched', async () => {
    const { client } = makeClient({ carrier: 'IB' });
    const result = await client.comparePointsVsCash(BASE);
    const gap = result.points.coverage_gaps.find((entry) => entry.carrier === 'IB');
    expect(gap).toBeDefined();
    expect(gap?.source).toBe('operating_carrier');
    expect(gap?.code).toBe('IB');
    expect(gap?.official_search_url).toContain('iberia.com');
    expect(gap?.note).toContain('Iberia');
    expect(result.points.verification_links.length).toBeGreaterThan(0);
  });

  it('reports only the static program list for a searched carrier', async () => {
    const { client } = makeClient({ carrier: 'UA' });
    const result = await client.comparePointsVsCash(BASE);
    expect(result.points.coverage_gaps.every((entry) => entry.source === 'program_list')).toBe(true);
    expect(result.points.coverage_gaps.map((entry) => entry.code)).toEqual(['IB', 'BA']);
  });
});

describe('cached second source', () => {
  it('fills a coverage gap with cached options that do not drive the verdict', async () => {
    const { client, calls } = makeClient({ awards: null, carrier: 'IB', secondSource: seatsAeroOptions(2) });
    const result = await client.comparePointsVsCash({ ...BASE, departDate: SOON });

    expect(calls.secondSourceCalls).toBe(1);
    expect(result.second_source?.status).toBe('ok');
    expect(result.second_source?.options_found).toBe(2);

    const cached = result.points.options.filter((option) => option.verification === 'cached');
    expect(cached).toHaveLength(2);
    expect(cached[0].source).toBe('seats.aero');
    expect(cached[0].data_age_minutes).toBe(1593);

    // Cached leads never become a valuation.
    expect(result.verdict.recommendation).toBe('insufficient_data');
    expect(result.verdict.best_award_program).toBeNull();
    expect(result.verdict.reason).toContain('Seats.aero');
  });

  it('never lets cached options into the valuation even when cash is priced', async () => {
    const { client } = makeClient({ awards: null, carrier: 'IB', secondSource: seatsAeroOptions(1) });
    const result = await client.comparePointsVsCash({ ...BASE, departDate: SOON });
    expect(result.cash.cheapest?.price).toBe(2000);
    expect(result.verdict.recommendation).toBe('insufficient_data');
    expect(result.verdict.cents_per_point).toBeNull();
  });

  it('skips the lookup when the caller opts out', async () => {
    const { client, calls } = makeClient({ awards: null, carrier: 'IB', secondSource: seatsAeroOptions(2) });
    const result = await client.comparePointsVsCash({ ...BASE, departDate: SOON, useSecondSource: false });
    expect(calls.secondSourceCalls).toBe(0);
    expect(result.second_source?.status).toBe('skipped');
    expect(result.points.options).toHaveLength(0);
  });

  it('skips the lookup when the live search already covers the route', async () => {
    const { client, calls } = makeClient({ carrier: 'UA', secondSource: seatsAeroOptions(2) });
    const result = await client.comparePointsVsCash(BASE);
    expect(calls.secondSourceCalls).toBe(0);
    expect(result.second_source?.status).toBe('skipped');
  });

  it('survives a failing second source', async () => {
    const { client } = makeClient({ awards: null, carrier: 'IB', secondSource: 'throws' });
    const result = await client.comparePointsVsCash({ ...BASE, departDate: SOON });
    expect(result.second_source?.status).toBe('error');
    expect(result.second_source?.error).toContain('seats boom');
    expect(result.verdict.recommendation).toBe('insufficient_data');
  });

  it('keeps the query window inside the anonymous date range', async () => {
    const { client, calls } = makeClient({ awards: null, carrier: 'IB', secondSource: seatsAeroOptions(1) });
    const lastDay = isoPlus(60);
    await client.comparePointsVsCash({ ...BASE, departDate: lastDay });
    expect(calls.secondSourceCalls).toBe(1);
    expect(calls.secondSourceParams[0].startDate).toBe(lastDay);
    expect(calls.secondSourceParams[0].endDate).toBe(lastDay);
  });

  it('skips the lookup when the date is outside the anonymous range', async () => {
    const { client, calls } = makeClient({ awards: null, carrier: 'IB', secondSource: seatsAeroOptions(1) });
    const result = await client.comparePointsVsCash({ ...BASE, departDate: isoPlus(120) });
    expect(calls.secondSourceCalls).toBe(0);
    expect(result.second_source?.status).toBe('skipped');
    expect(result.second_source?.note).toContain('60 days out');
  });
});

describe('transfer bonuses', () => {
  it('auto-applies the live bonus PointsYeah reports', async () => {
    const { client } = makeClient({ awards: awardResult({ bonus: 25 }) });
    const result = await client.comparePointsVsCash(BASE);
    const best = result.points.options[0];
    expect(best.effective_miles).toBe(56000);
    expect(best.cents_per_point_with_bonus).toBeCloseTo(3.39, 2);
    expect(best.transfer_bonus).toEqual({
      bank: 'Amex',
      percentage: 25,
      end_date: '2026-11-30',
      slogan: '25% Bonus, Exp Nov 30',
    });
    expect(result.auto_transfer_bonuses).toBe(true);
    expect(result.verdict.recommendation).toBe('points');
  });

  it('lets a manual bonus override the live one', async () => {
    const { client } = makeClient({ awards: awardResult({ bonus: 25 }) });
    const result = await client.comparePointsVsCash({ ...BASE, transferBonusPercent: 50 });
    const best = result.points.options[0];
    expect(best.effective_miles).toBe(Math.round(70000 / 1.5));
    expect(best.transfer_bonus).toBeNull();
    expect(result.transfer_bonus_percent).toBe(50);
    expect(result.auto_transfer_bonuses).toBe(false);
  });

  it('ignores bonuses when useTransferBonuses is false', async () => {
    const { client } = makeClient({ awards: awardResult({ bonus: 25 }) });
    const result = await client.comparePointsVsCash({ ...BASE, useTransferBonuses: false });
    const best = result.points.options[0];
    expect(best.effective_miles).toBeNull();
    expect(best.cents_per_point_with_bonus).toBeNull();
    expect(result.auto_transfer_bonuses).toBe(false);
    expect(result.verdict.recommendation).toBe('points');
  });
});

describe('flexible departure window', () => {
  it('compares on the cheapest cash day and reports the cheapest award day', async () => {
    const { client, calls } = makeClient({
      gridCheapest: { date: '2026-11-21', price: 1650, airline: 'United' },
      awardCheapest: {
        date: '2026-11-18',
        program: 'Flying Blue',
        program_code: 'flyingblue',
        miles: 60000,
        tax: 90,
        cabin: 'Business',
        seats: 2,
        stops: 0,
        itinerary: 'SFO 11:00 -> LHR 15:00',
      },
    });
    const result = await client.comparePointsVsCash({ ...BASE, departDateTo: '2026-11-25' });

    expect(calls.gridCalls).toBe(1);
    expect(result.window?.compared_date).toBe('2026-11-21');
    expect(result.window?.cash).toEqual({ date: '2026-11-21', price: 1650, airline: 'United' });
    expect(result.window?.points?.date).toBe('2026-11-18');
    expect(result.window?.note).toContain('cheapest cash day (2026-11-21)');
    expect(result.window?.note).toContain('cheapest award day was 2026-11-18');
    expect(calls.cashDates).toEqual(['2026-11-21']);
    expect(calls.awardDates).toEqual(['2026-11-21']);
    expect(result.route.depart_date).toBe('2026-11-21');
  });

  it('skips the window probe when departDateTo is not after departDate', async () => {
    const { client, calls } = makeClient({});
    const result = await client.comparePointsVsCash({ ...BASE, departDateTo: '2026-11-18' });
    expect(calls.gridCalls).toBe(0);
    expect(result.window).toBeNull();
    expect(result.route.depart_date).toBe('2026-11-18');
  });
});

describe('trip type', () => {
  it('passes round trips through to both sides', async () => {
    const { client, calls } = makeClient({});
    const result = await client.comparePointsVsCash({ ...BASE, returnDate: '2026-11-25' });
    expect(calls.awardTripTypes).toEqual(['2']);
    expect(result.route.return_date).toBe('2026-11-25');
    expect(result.cash.search_status).toBe('fares_unverified');
    expect(result.cash.usable_for_valuation).toBe(false);
    expect(result.cash.comparable_price).toBeNull();
    expect(result.verdict.cents_per_point).toBeNull();
    expect(result.verdict.recommendation).toBe('insufficient_data');
  });

  it('treats a missing return date as one-way', async () => {
    const { client, calls } = makeClient({});
    await client.comparePointsVsCash(BASE);
    expect(calls.awardTripTypes).toEqual(['1']);
  });
});

describe('PointsYeah unverified seat inventory', () => {
  it('does not treat 9999 as two confirmed award seats', async () => {
    const { client } = makeClient({ awards: awardResult({ seats: 9999 }) });
    const result = await client.comparePointsVsCash({ ...BASE, adults: 2 });

    expect(result.points.options).toHaveLength(1);
    expect(result.points.options[0].source).toBe('pointsyeah');
    expect(result.points.options[0].seats).toBeNull();
    expect(result.verdict.award_search_status).toBe('seats_unverified');
    expect(result.verdict.recommendation).toBe('insufficient_data');
    expect(result.verdict.reason).toMatch(/could not be confirmed/i);
  });

  it('keeps mixed unknown and one-seat awards as unverified, not sold out', async () => {
    const awards = awardResult({ seats: 9999 });
    const existing = awards.results[0].routes![0];
    awards.results[0].routes!.push({
      ...existing,
      payment: { ...existing.payment!, seats: 1, miles: 85000 },
    });
    const { client } = makeClient({ awards });
    const result = await client.comparePointsVsCash({ ...BASE, adults: 2 });

    expect(result.points.options.map((option) => option.seats)).toContain(null);
    expect(result.points.options.map((option) => option.seats)).toContain(1);
    expect(result.verdict.award_search_status).toBe('seats_unverified');
    expect(result.verdict.recommendation).toBe('insufficient_data');
  });

  it('preserves the legitimate 9-seat result for a two-person search', async () => {
    const { client } = makeClient({ awards: awardResult({ seats: 9 }) });
    const result = await client.comparePointsVsCash({ ...BASE, adults: 2 });
    expect(result.points.options[0].seats).toBe(9);
    expect(result.verdict.award_search_status).toBe('awards_found');
  });
});

describe('cash fare provenance gates', () => {
  it('returns insufficient_data for two passengers even with a plausible display price and award seats', async () => {
    const { client } = makeClient({ awards: awardResult({ seats: 9 }) });
    const response = await client.comparePointsVsCash({ ...BASE, adults: 2 });
    expect(response.cash.cheapest?.price).toBe(2000);
    expect(response.cash.quote_status).toBe('indicative_one_way');
    expect(response.cash.search_status).toBe('fares_unverified');
    expect(response.cash.comparable_price).toBeNull();
    expect(response.points.options[0].cents_per_point).toBeNull();
    expect(response.verdict.cents_per_point).toBeNull();
    expect(response.verdict.recommendation).toBe('insufficient_data');
  });

  it('rejects an actual outbound-only round-trip display even if its number looks cheap', async () => {
    const outboundOnly = {
      ...cashResult(48),
      quote_status: 'round_trip_return_unselected' as const,
      query: {
        ...cashResult().query,
        trip_type: 'round_trip',
        return_date: '2026-11-25',
      },
    };
    const { client } = makeClient({ cash: outboundOnly });
    const response = await client.comparePointsVsCash({ ...BASE, returnDate: '2026-11-25' });
    expect(response.cash.cheapest?.price).toBe(48);
    expect(response.cash.quote_status).toBe('round_trip_return_unselected');
    expect(response.cash.comparable_price).toBeNull();
    expect(response.cash.search_status).toBe('fares_unverified');
    expect(response.points.options.every((option) => option.cents_per_point === null)).toBe(true);
    expect(response.verdict.recommendation).toBe('insufficient_data');
  });

  it('fails closed for legacy clients that omit quote-stage metadata', async () => {
    const legacy = {
      ...cashResult(),
      quote_status: undefined as never,
      price_basis: undefined as never,
    };
    const { client } = makeClient({ cash: legacy });
    const response = await client.comparePointsVsCash(BASE);
    expect(response.cash.quote_status).toBe('unknown');
    expect(response.cash.price_basis).toBe('unknown');
    expect(response.cash.comparable_price).toBeNull();
    expect(response.verdict.recommendation).toBe('insufficient_data');
  });

  it('does not value another cabin if Google ignored the requested cabin filter', async () => {
    const result = cashResult(1800);
    result.query.cabin_honored = false;
    const { client } = makeClient({ cash: result });
    const response = await client.comparePointsVsCash(BASE);
    expect(response.cash.search_status).toBe('fares_unverified');
    expect(response.verdict.recommendation).toBe('insufficient_data');
    expect(response.verdict.cents_per_point).toBeNull();
  });

  it('does not let an unverified round-trip date grid pick the comparison day', async () => {
    const { client, calls } = makeClient({
      gridCheapest: { date: '2026-11-21', price: 48, airline: 'Frontier' },
    });
    const response = await client.comparePointsVsCash({
      ...BASE, departDateTo: '2026-11-25', returnDate: '2026-11-27',
    });
    expect(response.window?.cash).toBeNull();
    expect(response.window?.compared_date).toBe(BASE.departDate);
    expect(response.window?.note).toContain('No comparable cash date-grid quote');
    expect(calls.cashDates).toEqual([BASE.departDate]);
    expect(response.verdict.recommendation).toBe('insufficient_data');
  });

  it('does not allow a two-adult date grid to set comparison date from an ambiguous price', async () => {
    const { client } = makeClient({
      gridCheapest: { date: '2026-11-21', price: 760, airline: 'American' },
      awards: awardResult({ seats: 9 }),
    });
    const response = await client.comparePointsVsCash({
      ...BASE, adults: 2, departDateTo: '2026-11-25',
    });
    expect(response.window?.cash).toBeNull();
    expect(response.window?.compared_date).toBe(BASE.departDate);
    expect(response.verdict.cents_per_point).toBeNull();
  });
});

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
    query: { origin: 'SFO', destination: 'LHR' },
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
}

function makeClient(config: {
  cash?: SearchFlightsResult | null;
  awards?: FlightSearchResults | null;
  gridCheapest?: { date: string; price: number; airline: string | null } | null;
  awardCheapest?: CheapestAwardDatesResult['cheapest'];
  cashThrows?: boolean;
  awardThrows?: boolean;
}) {
  const calls: Calls = { cashDates: [], awardDates: [], awardTripTypes: [], gridCalls: 0 };
  const flights = {
    async searchFlights(options: { departure_date: string }) {
      calls.cashDates.push(options.departure_date);
      if (config.cashThrows) throw new Error('cash boom');
      return config.cash === null ? ({ ...cashResult(), flights: [] } as SearchFlightsResult) : config.cash ?? cashResult();
    },
    async getDateGrid() {
      calls.gridCalls += 1;
      return { cheapest: config.gridCheapest ?? null };
    },
  } as unknown as IFlightsClient;
  const pointsYeah = {
    async searchFlights(options: { departDate: string; tripType: string }) {
      calls.awardDates.push(options.departDate);
      calls.awardTripTypes.push(options.tripType);
      if (config.awardThrows) throw new Error('award boom');
      return config.awards === null ? ({ total: 0, unfiltered_total: 0, results: [], notes: [] } as FlightSearchResults) : config.awards ?? awardResult();
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
  return { client: new TripCompareClient({ flights, pointsYeah }), calls };
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

describe('comparePointsVsCash verdicts', () => {
  it('recommends points when the award clears the cents-per-point threshold', async () => {
    const { client } = makeClient({});
    const result = await client.comparePointsVsCash(BASE);
    expect(result.verdict.recommendation).toBe('points');
    expect(result.verdict.cents_per_point).toBeCloseTo(2.71, 2);
    expect(result.verdict.best_award_program).toBe('Flying Blue');
    expect(result.verdict.reason).toContain('Flying Blue');
    expect(result.cash.cheapest?.price).toBe(2000);
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

  it('falls back to cash when no award space is returned', async () => {
    const { client } = makeClient({ awards: null });
    const result = await client.comparePointsVsCash(BASE);
    expect(result.verdict.recommendation).toBe('cash');
    expect(result.verdict.reason).toContain('No award space');
    expect(result.points.options).toHaveLength(0);
  });

  it('falls back to points when no cash fare is returned', async () => {
    const { client } = makeClient({ cash: null });
    const result = await client.comparePointsVsCash(BASE);
    expect(result.verdict.recommendation).toBe('points');
    expect(result.verdict.reason).toContain('No cash fare');
    expect(result.cash.cheapest).toBeNull();
  });

  it('ignores award options that cannot seat the party', async () => {
    const { client } = makeClient({ awards: awardResult({ seats: 1 }) });
    const result = await client.comparePointsVsCash({ ...BASE, adults: 2 });
    expect(result.points.options).toHaveLength(1);
    expect(result.verdict.recommendation).toBe('cash');
    expect(result.verdict.reason).toContain('No award space');
  });

  it('keeps the comparison going when one side errors', async () => {
    const { client } = makeClient({ awardThrows: true });
    const result = await client.comparePointsVsCash(BASE);
    expect(result.verdict.recommendation).toBe('cash');
    expect(result.cash.cheapest?.price).toBe(2000);
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
  });

  it('treats a missing return date as one-way', async () => {
    const { client, calls } = makeClient({});
    await client.comparePointsVsCash(BASE);
    expect(calls.awardTripTypes).toEqual(['1']);
  });
});

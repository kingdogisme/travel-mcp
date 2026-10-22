import { describe, expect, it } from 'vitest';
import { mergeAwardBatches, pollAwardSearch } from '../shared/src/search-polling.js';
import { countAwardItineraries, limitAwardItineraries } from '../shared/src/result-limits.js';
import type {
  FlightResult, FlightRoute, FlightSearchResponse,
} from '../shared/src/types.js';

function itinerary(flight: string, miles = 30000, seats: number | null = 2): FlightRoute {
  return {
    payment: { miles, currency: 'USD', tax: 5.6, cabin: 'Economy', unit: 'miles', seats, cash_price: 0 },
    segments: [{
      flight_number: flight, duration: 120,
      da: 'HND', aa: 'SAN',
      dt: '2026-12-13T13:00:00', at: '2026-12-13T16:00:00',
      cabin: 'Economy',
    }],
    transfer: [],
  };
}
function group(routes: FlightRoute[]): FlightResult {
  return {
    program: 'Alaska Atmos Rewards', code: 'AS',
    date: '2026-12-13', departure: 'HND', arrival: 'SAN',
    routes,
  };
}
function reply(
  status: 'processing' | 'done' | 'failed',
  results: FlightResult[] = []
): FlightSearchResponse {
  return { code: 0, success: true, data: { status, result: results } };
}
function clock() {
  let current = 0;
  return {
    now: () => current,
    sleep: async (ms: number) => { current += ms; },
    advance: (ms: number) => { current += ms; },
  };
}

describe('PointsYeah bounded polling', () => {
  it('accumulates distinct itineraries across repeated program/date batches without duplication', async () => {
    const time = clock();
    let count = 0;
    const searches = [
      reply('processing', [group([itinerary('AS101')])]),
      reply('processing', [group([itinerary('AS101'), itinerary('AS102')])]),
      reply('done', [group([itinerary('AS102'), itinerary('AS103')])]),
    ];
    const r = await pollAwardSearch({
      deadlineMs: 120000, intervalMs: 1000, requestGuardMs: 500,
      now: time.now, sleep: time.sleep, poll: async () => searches[count++],
    });
    expect(r.completion).toBe('completed');
    expect(r.polls).toBe(3);
    expect(r.results).toHaveLength(1);
    expect(r.results[0].routes?.map((x) => x.segments?.[0].flight_number))
      .toEqual(['AS101', 'AS102', 'AS103']);
  });

  it('updates the latest count for a repeated itinerary, including unknown counts', () => {
    const existing = new Map<string, FlightResult>();
    mergeAwardBatches(existing, [group([itinerary('AS101', 30000, 9)])]);
    mergeAwardBatches(existing, [group([itinerary('AS101', 30000, null)])]);
    const shown = [...existing.values()];
    expect(shown).toHaveLength(1);
    expect(shown[0].routes?.length).toBe(1);
    expect(shown[0].routes?.[0].payment?.seats).toBeNull();
  });

  it('stops at the absolute deadline rather than the 360-second polling ceiling', async () => {
    const time = clock();
    let polls = 0;
    const r = await pollAwardSearch({
      deadlineMs: 3800, intervalMs: 1000, requestGuardMs: 500,
      now: time.now, sleep: async ms => { time.advance(ms + 200); },
      poll: async () => {
        polls++;
        return reply('processing', [group([itinerary('AS101')])]);
      },
    });
    expect(r.completion).toBe('partial_timeout');
    expect(r.polls).toBe(polls);
    expect(polls).toBeGreaterThan(0);
    expect(polls).toBeLessThan(120);
    expect(r.results).toHaveLength(1);
  });

  it('returns incomplete with zero results if the browser setup consumed the whole budget', async () => {
    let polled = false;
    const r = await pollAwardSearch({
      deadlineMs: 3000, intervalMs: 3000, requestGuardMs: 500,
      now: () => 2900, sleep: async () => {},
      poll: async () => { polled = true; return reply('done'); },
    });
    expect(polled).toBe(false);
    expect(r.polls).toBe(0);
    expect(r.completion).toBe('partial_timeout');
    expect(r.results).toEqual([]);
  });

  it('keeps partial records if a later HTTP poll throws', async () => {
    const time = clock();
    let polls = 0;
    const r = await pollAwardSearch({
      deadlineMs: 50000, intervalMs: 1000, requestGuardMs: 500,
      now: time.now, sleep: time.sleep,
      poll: async () => {
        polls++;
        if (polls === 1) return reply('processing', [group([itinerary('AS101')])]);
        throw new Error('upstream error with a private token that must not leak');
      },
    });
    expect(r.completion).toBe('partial_error');
    expect(r.failure_kind).toBe('upstream_failed');
    expect(r.results[0].routes).toHaveLength(1);
    expect(JSON.stringify(r)).not.toContain('private token');
  });

  it('distinguishes a finished empty search from an incomplete one', async () => {
    const time = clock();
    const r = await pollAwardSearch({
      deadlineMs: 50000, intervalMs: 1000, requestGuardMs: 500,
      now: time.now, sleep: time.sleep, poll: async () => reply('done'),
    });
    expect(r.completion).toBe('completed');
    expect(r.results).toEqual([]);
  });

  it('returns partial_error for an upstream rejected status', async () => {
    const time = clock();
    const r = await pollAwardSearch({
      deadlineMs: 50000, intervalMs: 1000, requestGuardMs: 500,
      now: time.now, sleep: time.sleep, poll: async () => reply('failed', [group([itinerary('AS101')])]),
    });
    expect(r.completion).toBe('partial_error');
    expect(r.failure_kind).toBe('upstream_rejected');
    expect(r.results[0].routes).toHaveLength(1);
  });
});

describe('PointsYeah group counts vs actual itineraries', () => {
  it('caps itinerary count separately while preserving order and original input', () => {
    const input = [group([itinerary('AS101'), itinerary('AS102'), itinerary('AS103')]),
      { ...group([itinerary('AA201'), itinerary('AA202')]), code: 'AA', program: 'AA AAdvantage' }];
    const capped = limitAwardItineraries(input, 4);
    expect(countAwardItineraries(input)).toBe(5);
    expect(capped.results).toHaveLength(2);
    expect(countAwardItineraries(capped.results)).toBe(4);
    expect(capped.omitted_options).toBe(1);
    expect(capped.results[1].routes?.map(r=>r.segments?.[0].flight_number)).toEqual(['AA201']);
    expect(input[1].routes).toHaveLength(2);
  });

  it('never treats the group count as the number of flight options', () => {
    const groups = [group(Array.from({ length: 80 }, (_, i) => itinerary('AS'+(100+i))))];
    expect(groups).toHaveLength(1);
    expect(countAwardItineraries(groups)).toBe(80);
    const capped = limitAwardItineraries(groups, 40);
    expect(capped.results).toHaveLength(1);
    expect(countAwardItineraries(capped.results)).toBe(40);
    expect(capped.omitted_options).toBe(40);
  });

  it('does not truncate when no maxOptions was supplied by an internal caller', () => {
    const groups = [group([itinerary('AS101'), itinerary('AS102')])];
    expect(limitAwardItineraries(groups).results).toBe(groups);
    expect(limitAwardItineraries(groups).omitted_options).toBe(0);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../shared/src/pointsyeah-client/lib/auth.js', () => ({
  refreshCognitoTokens: vi.fn(async () => ({
    accessToken: 'access-token',
    idToken: 'id-token',
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
  })),
  getUserSubFromIdToken: vi.fn(() => 'sub'),
}));

vi.mock('../shared/src/pointsyeah-client/lib/search.js', () => ({
  createSearchTask: vi.fn(),
}));

vi.mock('../shared/src/pointsyeah-client/lib/fetch-results.js', () => ({
  fetchSearchResults: vi.fn(),
}));

import { resolvePlaceCode, resolvePlaceCodes } from '../shared/src/places.js';
import { PointsYeahClient } from '../shared/src/server.js';
import { resetState, setRefreshToken } from '../shared/src/state.js';
import { createSearchTask } from '../shared/src/pointsyeah-client/lib/search.js';
import { fetchSearchResults } from '../shared/src/pointsyeah-client/lib/fetch-results.js';
import { recommendAwardDestinationsTool } from '../shared/src/tools/recommend-award-destinations.js';
import type { FlightSearchParams } from '../shared/src/types.js';

function searchParams(overrides: Partial<FlightSearchParams> = {}): FlightSearchParams {
  return {
    departure: 'SFO',
    arrival: 'NRT',
    departDate: '2026-11-18',
    tripType: '1',
    adults: 1,
    children: 0,
    cabins: ['Business'],
    multiday: false,
    ...overrides,
  };
}

describe('resolvePlaceCode', () => {
  it('passes IATA codes through, upper-cased', () => {
    expect(resolvePlaceCode('sfo')).toBe('SFO');
    expect(resolvePlaceCode(' NRT ')).toBe('NRT');
  });

  it('resolves multi-airport metro names to the metro code', () => {
    expect(resolvePlaceCode('London')).toBe('LON');
    expect(resolvePlaceCode('new york')).toBe('NYC');
    expect(resolvePlaceCode('Tokyo')).toBe('TYO');
  });

  it('resolves single-airport city names', () => {
    expect(resolvePlaceCode('Bangkok')).toBe('BKK');
    expect(resolvePlaceCode('San Francisco')).toBe('SFO');
    expect(resolvePlaceCode('Singapore')).toBe('SIN');
  });

  it('is case- and whitespace-insensitive', () => {
    expect(resolvePlaceCode('  hong   kong ')).toBe('HKG');
  });

  it('rejects an unknown place with an actionable message', () => {
    expect(() => resolvePlaceCode('Atlantis')).toThrow(/Could not resolve "Atlantis"/);
    expect(() => resolvePlaceCode('Atlantis')).toThrow(/find_airport_code/);
  });
});

describe('resolvePlaceCodes', () => {
  it('resolves each entry and drops blanks', () => {
    expect(resolvePlaceCodes(['SFO', 'Tokyo', '  '])).toEqual(['SFO', 'TYO']);
  });
});

describe('PointsYeah city-name resolution wiring', () => {
  beforeEach(() => {
    resetState();
    setRefreshToken('refresh-token');
    vi.mocked(createSearchTask).mockReset();
    vi.mocked(fetchSearchResults).mockReset();
  });

  it('resolves city names before creating the browser search task', async () => {
    vi.mocked(createSearchTask).mockResolvedValue({ task_id: 'task-1' } as never);
    vi.mocked(fetchSearchResults).mockResolvedValue({
      success: true,
      data: { status: 'done', result: [] },
    } as never);

    const client = new PointsYeahClient({} as never);
    await client.searchFlights(searchParams({ departure: 'San Francisco', arrival: 'Tokyo' }));

    const [sentParams] = vi.mocked(createSearchTask).mock.calls[0];
    expect(sentParams.departure).toBe('SFO');
    expect(sentParams.arrival).toBe('TYO');
  }, 15000);

  it('rejects an unknown place before touching the network', async () => {
    const client = new PointsYeahClient({} as never);
    await expect(
      client.searchFlights(searchParams({ departure: 'Atlantis' }))
    ).rejects.toThrow(/Could not resolve "Atlantis"/);
    expect(createSearchTask).not.toHaveBeenCalled();
  });

  it('resolves city names in the price-alert payload', async () => {
    const bodies: unknown[] = [];
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body ?? '{}')));
      return new Response(JSON.stringify({ success: true, data: { id: 1 } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    try {
      const client = new PointsYeahClient({} as never);
      await client.createPriceAlert({
        action: 'create',
        origin: 'San Francisco',
        destination: 'Tokyo',
        departDate: '2026-11-18',
        maxMiles: 80000,
      });

      const info = (bodies[0] as { info: { departure: string; arrival: string } }).info;
      expect(info.departure).toBe('SFO');
      expect(info.arrival).toBe('TYO');
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('resolves the departure in recommend_award_destinations', async () => {
    const calls: unknown[] = [];
    const tool = recommendAwardDestinationsTool(
      {} as never,
      () =>
        ({
          exploreAwardRecommend: async (body: unknown) => {
            calls.push(body);
            return { ok: true };
          },
        }) as never
    );

    const result = await tool.handler({ departure: 'San Francisco', arrivalAnywhere: true });
    expect(result.isError).toBeUndefined();
    expect((calls[0] as { departure: { airport: string } }).departure.airport).toBe('SFO');
  });

  it('reports an actionable error from recommend_award_destinations', async () => {
    const tool = recommendAwardDestinationsTool({} as never, () => ({}) as never);
    const result = await tool.handler({ departure: 'Atlantis' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/Could not resolve "Atlantis"/);
  });
});

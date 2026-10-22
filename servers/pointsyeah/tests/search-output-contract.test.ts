import { describe, expect, it } from 'vitest';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { searchFlightsTool } from '../shared/src/tools/search-flights.js';
import type {
  IPointsYeahClient,
} from '../shared/src/server.js';
import type {
  FlightSearchParams, FlightSearchResults,
} from '../shared/src/types.js';

const basicSearch = {
  departure: 'HND', arrival: 'SAN', departDate: '2026-12-13',
  tripType: '1', adults: 2, cabins: ['Economy'], minSeats: 2,
};

function makeTool(
  result: FlightSearchResults,
  receiver: (params: FlightSearchParams) => void = () => {}
) {
  const client = { searchFlights: async (params: FlightSearchParams) => {
    receiver(params);
    return result;
  } } as IPointsYeahClient;
  return searchFlightsTool({} as Server, () => client);
}

describe('PointsYeah MCP output contract', () => {
  it('distinguishes one group from forty itineraries and displays partial_timeout', async () => {
    const result: FlightSearchResults = {
      total: 1, unfiltered_total: 3,
      completion_status: 'partial_timeout', option_total: 40,
      unfiltered_option_total: 120, matched_option_total: 80,
      omitted_option_total: 40, poll_count: 48, elapsed_ms: 239000,
      unverified_seat_count: 120,
      results: [{
        program: 'Alaska Atmos Rewards', code: 'AS',
        date: '2026-12-13', departure: 'HND', arrival: 'SAN',
        routes: [{
          payment: {
            miles: 37500, tax: 83.1, seats: 9, cash_price: 0,
            cabin: 'Economy', unit: 'miles', currency: 'USD',
          },
          segments: [{
            flight_number: 'JL68', da: 'NRT', aa: 'SEA',
            dt: '2026-12-13T18:10:00',
            at: '2026-12-13T09:55:00', duration: 525, cabin: 'Economy',
          }],
          transfer: [],
        }],
      }],
      notes: ['Output cap triggered.'],
    };
    let maxOptions: number | undefined;
    const tool = makeTool(result, p => { maxOptions = p.maxOptions; });
    const response = await tool.handler(basicSearch);
    const body = response.content[0].text;
    expect(maxOptions).toBe(40);
    expect(body).toContain('**Search completion:** partial_timeout');
    expect(body).toContain('**Result groups:** 1 program/date group(s)');
    expect(body).toContain('**Flight itineraries shown:** 40 (of 80 matching');
    expect(body).toContain('40 omitted by maxOptions');
    expect(body).toContain('**WARNING:** Partial PointsYeah search');
    expect(body).toContain('JL68: NRT');
  });

  it('reports incomplete empty searches without pretending seats do not exist', async () => {
    const tool = makeTool({
      total: 0, unfiltered_total: 0, results: [],
      notes: ['Search reached safe deadline'],
      completion_status: 'partial_error', poll_count: 18,
    });
    const response = await tool.handler(basicSearch);
    const body = response.content[0].text;
    expect(body).toContain('Search completion: partial_error');
    expect(body).toContain('No-results does not establish lack of award availability');
    expect(body).toContain('Unknown seat inventory cannot satisfy minSeats');
  });

  it('allows explicitly raising maxOptions without confusing it with group limit', async () => {
    let received: FlightSearchParams | null = null;
    const tool = makeTool({ total: 0, unfiltered_total: 0, results: [], notes: [] },
      p => { received = p; });
    await tool.handler({ ...basicSearch, limit: 2, maxOptions: 120 });
    expect(received?.maxOptions).toBe(120);
    expect(received?.limit).toBe(2);
  });
});

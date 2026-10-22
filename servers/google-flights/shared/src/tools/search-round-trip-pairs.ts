import { z } from 'zod';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { FlightsClientFactory } from '../server.js';

export const SearchRoundTripPairsSchema = z.object({
  origin: z.string().min(3).describe('Departure IATA airport, e.g. SFO'),
  destination: z.string().min(3).describe('Destination IATA airport, e.g. LAX'),
  departure_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  return_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  seat_class: z.literal('economy').default('economy').describe('Experimental second-stage selection supports economy only'),
  adults: z.number().int().min(1).max(9).default(1),
  children: z.number().int().min(0).max(9).default(0),
  currency: z.string().length(3).default('USD'),
  max_stops: z.enum(['any', 'nonstop', '1', '2']).default('1')
    .describe('Max stops for return options; this experiment pins NONSTOP outbounds only'),
  exclude_basic_economy: z.boolean().default(true),
  max_outbounds: z.number().int().min(1).max(4).default(2)
    .describe('How many nonstop outbounds to pin (each costs an additional Google request)'),
  max_return_options: z.number().int().min(1).max(15).default(5),
});

export function searchRoundTripPairsTool(_server: Server, factory: FlightsClientFactory) {
  return {
    name: 'search_round_trip_pairs',
    description: `EXPERIMENTAL Google Flights round-trip PAIR selection. Unlike search_flights(round_trip), this tool attempts the real second stage: select a nonstop outbound via its Google token and search matching return flights in the same round-trip TFS. Each output has outbound + return_flight + displayed_round_trip_price. Skips any result that fails strict route/date validation.

P0 guardrails: Return selections are NOT airline-checkout-verified, price_basis is unverified, and party_total remains null even for two adults. No fake flight pair or party price is ever synthesized. If Google changes its undocumented selection format, search_status/diagnostics report no paired results or partial failure. Economy only, maximum four selected outbounds, maximum 15 returns each. Use research results to cross-check on Google Flights before booking; do not automatically feed this experimental price into trip-compare CPP.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        origin: { type: 'string', description: 'Departure IATA code, e.g. SFO' },
        destination: { type: 'string', description: 'Destination IATA code, e.g. LAX' },
        departure_date: { type: 'string', description: 'Outbound YYYY-MM-DD' },
        return_date: { type: 'string', description: 'Return YYYY-MM-DD' },
        seat_class: { type: 'string', enum: ['economy'], description: 'Only economy is supported for verified parsing' },
        adults: { type: 'number', description: 'Adult passengers (default 1)' },
        children: { type: 'number', description: 'Child passengers (default 0)' },
        currency: { type: 'string', description: 'Currency ISO code (default USD)' },
        max_stops: { type: 'string', enum: ['any', 'nonstop', '1', '2'], description: 'Return maximum stops' },
        exclude_basic_economy: { type: 'boolean', description: 'Exclude stripped-down basic fares' },
        max_outbounds: { type: 'number', minimum: 1, maximum: 4, description: 'How many nonstop outbounds to select, default 2' },
        max_return_options: { type: 'number', minimum: 1, maximum: 15, description: 'Return options per selected outbound, default 5' },
      },
      required: ['origin', 'destination', 'departure_date', 'return_date'],
    },
    handler: async (args: unknown) => {
      try {
        const options = SearchRoundTripPairsSchema.parse(args);
        const data = await factory().searchRoundTripPairs(options);
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { content: [{ type: 'text', text: `Round-trip selection error: ${message}` }], isError: true };
      }
    },
  };
}

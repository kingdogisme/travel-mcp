import { z } from 'zod';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { FlightsClientFactory } from '../server.js';

export const SearchAnywhereSchema = z.object({
  origin: z
    .string()
    .min(3)
    .describe(
      'Where the trip starts: an airport IATA code (e.g. "SFO"), a city or airport name (e.g. "Tokyo"), or several comma-separated codes ("SFO,OAK")'
    ),
  departure_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .describe('Departure date in YYYY-MM-DD format'),
  return_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe('Return date in YYYY-MM-DD format. Required when trip_type is round_trip'),
  trip_type: z.enum(['one_way', 'round_trip']).default('one_way').describe('Trip type'),
  destinations: z
    .array(z.string())
    .optional()
    .describe(
      'Candidate destinations to price, each an IATA code, a city name, or a comma-separated list, e.g. ["NRT", "Bangkok", "LIS,OPO"]'
    ),
  regions: z
    .array(z.string())
    .optional()
    .describe(
      'Regions, countries or cities to expand into candidate airports, e.g. ["Japan", "Thailand", "Hawaii"]. Each expands to airports_per_region airports'
    ),
  airports_per_region: z
    .number()
    .int()
    .min(1)
    .max(5)
    .default(3)
    .describe('How many airports to take from each region (default 3)'),
  max_destinations: z
    .number()
    .int()
    .min(1)
    .max(8)
    .default(5)
    .describe('Hard cap on destinations priced in one call (default 5, hard max 8). Each one is a polite lookup'),
  seat_class: z
    .enum(['economy', 'premium_economy', 'business', 'first'])
    .default('economy')
    .describe('Cabin class applied to every destination'),
  adults: z.number().int().min(1).max(9).default(1).describe('Number of adult passengers'),
  children: z.number().int().min(0).max(9).default(0).describe('Number of child passengers'),
  currency: z.string().min(3).max(3).default('USD').describe('Currency code for prices'),
  exclude_basic_economy: z
    .boolean()
    .default(true)
    .describe('Exclude basic economy fares (default true)'),
  max_stops: z
    .enum(['any', 'nonstop', '1', '2'])
    .default('any')
    .describe('Maximum number of stops'),
  max_price: z
    .number()
    .positive()
    .optional()
    .describe('Drop offers priced above this amount (in the search currency)'),
  exclude_redeye: z
    .boolean()
    .optional()
    .describe('Drop itineraries that depart between 22:00 and 06:00 local time'),
  require_checked_bag: z
    .boolean()
    .optional()
    .describe('Keep only itineraries that include at least one free checked bag'),
  max_layover_minutes: z.number().int().positive().optional().describe('Drop long connections'),
  max_duration_minutes: z.number().int().positive().optional().describe('Drop itineraries longer than this'),
  sort_by: z
    .enum(['price', 'duration'])
    .default('price')
    .describe('How to order the priced destinations (default cheapest first)'),
});

export function searchAnywhereTool(_server: Server, clientFactory: FlightsClientFactory) {
  return {
    name: 'search_anywhere',
    description: `Find the cheapest places to go from one origin: price a set of candidate destinations and rank them.

Give candidates either explicitly (destinations: ["NRT", "Bangkok", "LIS,OPO"]) or as regions that get expanded into their airports (regions: ["Japan", "Thailand", "Hawaii"]); a region that is a big multi-airport city resolves to its metro code ("London" -> LON). Each candidate is one one-way or round-trip search on the given dates (round trips need return_date), so the response is comparable: price, airline, stops, duration and times per destination, ordered cheapest first (or fastest first with sort_by: "duration").

The response carries cheapest (the single best destination), no_results, searched_destinations and truncated. Keep max_destinations small: every destination is one live lookup, so the default of 5 keeps a call quick and polite.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        origin: {
          type: 'string',
          description: 'Origin airport IATA code, city/airport name, or comma-separated list',
        },
        departure_date: { type: 'string', description: 'Departure date YYYY-MM-DD' },
        return_date: { type: 'string', description: 'Return date YYYY-MM-DD. Required when trip_type is round_trip' },
        trip_type: { type: 'string', enum: ['one_way', 'round_trip'], description: 'Trip type' },
        destinations: {
          type: 'array',
          items: { type: 'string' },
          description: 'Candidate destinations: IATA codes, city names or comma-separated lists',
        },
        regions: {
          type: 'array',
          items: { type: 'string' },
          description: 'Regions, countries or cities to expand into airports, e.g. ["Japan"]',
        },
        airports_per_region: {
          type: 'number',
          description: 'How many airports to take from each region (default 3)',
        },
        max_destinations: {
          type: 'number',
          description: 'Hard cap on destinations priced in one call (default 5, hard max 8)',
        },
        seat_class: {
          type: 'string',
          enum: ['economy', 'premium_economy', 'business', 'first'],
          description: 'Cabin class',
        },
        adults: { type: 'number', description: 'Number of adult passengers' },
        children: { type: 'number', description: 'Number of child passengers' },
        currency: { type: 'string', description: 'Currency code for prices, e.g. "USD"' },
        exclude_basic_economy: { type: 'boolean', description: 'Exclude basic economy fares' },
        max_stops: {
          type: 'string',
          enum: ['any', 'nonstop', '1', '2'],
          description: 'Maximum number of stops',
        },
        max_price: { type: 'number', description: 'Drop offers priced above this amount' },
        exclude_redeye: {
          type: 'boolean',
          description: 'Drop itineraries departing 22:00-06:00 local time',
        },
        require_checked_bag: {
          type: 'boolean',
          description: 'Keep only itineraries with a free checked bag',
        },
        max_layover_minutes: { type: 'number', description: 'Drop long connections' },
        max_duration_minutes: { type: 'number', description: 'Drop long itineraries' },
        sort_by: {
          type: 'string',
          enum: ['price', 'duration'],
          description: 'Order the priced destinations by price or by duration',
        },
      },
      required: ['origin', 'departure_date'],
    },
    handler: async (args: unknown) => {
      try {
        const parsed = SearchAnywhereSchema.parse(args);
        const client = clientFactory();
        const result = await client.searchAnywhere(parsed);
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: 'text', text: `Error searching destinations: ${message}` }],
          isError: true,
        };
      }
    },
  };
}

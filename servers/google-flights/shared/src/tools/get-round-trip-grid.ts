import { z } from 'zod';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { FlightsClientFactory } from '../server.js';

export const GetRoundTripGridSchema = z.object({
  origin: z
    .string()
    .min(3)
    .describe('Origin airport IATA code (e.g., "SFO"), a city name (e.g. "Tokyo"), or comma-separated ("SFO,OAK")'),
  destination: z
    .string()
    .min(3)
    .describe('Destination airport IATA code (e.g., "NRT"), a city name (e.g. "Tokyo"), or comma-separated ("NRT,HND")'),
  start_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .describe('First departure date to price (YYYY-MM-DD)'),
  end_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .describe('Last departure date to price (YYYY-MM-DD)'),
  min_nights: z
    .number()
    .int()
    .min(0)
    .max(60)
    .default(5)
    .describe('Shortest trip length to price, in nights (default 5)'),
  max_nights: z
    .number()
    .int()
    .min(0)
    .max(60)
    .default(10)
    .describe('Longest trip length to price, in nights (default 10)'),
  seat_class: z
    .enum(['economy', 'premium_economy', 'business', 'first'])
    .default('economy')
    .describe('Cabin class applied to every cell'),
  adults: z.number().int().min(1).max(9).default(1).describe('Number of adult passengers'),
  currency: z.string().min(3).max(3).default('USD').describe('Currency code for prices'),
  max_departure_dates: z
    .number()
    .int()
    .min(1)
    .max(7)
    .default(4)
    .describe('How many departure dates to sample across the window (default 4)'),
  max_pairs: z
    .number()
    .int()
    .min(1)
    .max(18)
    .default(12)
    .describe(
      'Hard cap on live round-trip lookups for this call (default 12, hard max 18). Each cell is one polite request.'
    ),
  exclude_basic_economy: z
    .boolean()
    .default(true)
    .describe('Ignore basic-economy fares when picking the cheapest fare for a cell'),
  airlines: z.array(z.string()).optional().describe('Keep only these airlines, by IATA code or name'),
  exclude_airlines: z.array(z.string()).optional().describe('Drop these airlines'),
  alliances: z
    .array(z.string())
    .optional()
    .describe('Keep only itineraries whose carriers all belong to these alliances, e.g. ["Star Alliance"]'),
  exclude_alliances: z.array(z.string()).optional().describe('Drop itineraries from these alliances'),
  require_checked_bag: z
    .boolean()
    .optional()
    .describe('Keep only itineraries with at least one free checked bag'),
  max_layover_minutes: z.number().int().positive().optional().describe('Drop long connections'),
  max_duration_minutes: z.number().int().positive().optional().describe('Drop long itineraries'),
  max_price: z.number().positive().optional().describe('Drop offers priced above this amount'),
  exclude_redeye: z
    .boolean()
    .optional()
    .describe('Drop itineraries that depart between 22:00 and 06:00 local time'),
  aircraft_types: z
    .array(z.string())
    .optional()
    .describe('Keep only itineraries whose segments are all on one of these aircraft types (substring match)'),
  exclude_aircraft_types: z
    .array(z.string())
    .optional()
    .describe('Drop itineraries that use any of these aircraft types'),
});

export function getRoundTripGridTool(_server: Server, clientFactory: FlightsClientFactory) {
  return {
    name: 'get_round_trip_grid',
    description: `Price a grid of round trips: departure dates across a window crossed with a range of trip lengths.

Give a departure window (start_date / end_date) and a trip-length range (min_nights / max_nights), and this returns the cheapest round-trip fare for each (departure date, trip length) cell, plus the cheapest cell overall, the cheapest cell per departure date and the cheapest cell per trip length. It answers "when should I go, and for how long?" in one call.

Every cell is its own live Google Flights round-trip search, so the number of lookups is capped by max_pairs (default 12, hard max 18) and the departure dates are sampled evenly across the window (max_departure_dates, default 4). When the requested grid is larger than the cap, the response sets truncated: true and says so in notes.

The same result-side filters as search_flights are available here — airlines / exclude_airlines, alliances / exclude_alliances, require_checked_bag, max_layover_minutes, max_duration_minutes, max_price, exclude_redeye and aircraft_types / exclude_aircraft_types.

Use get_date_grid first when only the departure date is flexible; use this when the trip length matters too.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        origin: { type: 'string', description: 'Origin IATA code, a city name (e.g. "Tokyo"), or comma-separated ("SFO,OAK")' },
        destination: {
          type: 'string',
          description: 'Destination IATA code, a city name (e.g. "Tokyo"), or comma-separated ("NRT,HND")',
        },
        start_date: { type: 'string', description: 'First departure date YYYY-MM-DD' },
        end_date: { type: 'string', description: 'Last departure date YYYY-MM-DD' },
        min_nights: { type: 'number', description: 'Shortest trip length in nights (default 5)' },
        max_nights: { type: 'number', description: 'Longest trip length in nights (default 10)' },
        seat_class: {
          type: 'string',
          enum: ['economy', 'premium_economy', 'business', 'first'],
          description: 'Cabin class (default economy)',
        },
        adults: { type: 'number', description: 'Adult passengers (default 1)' },
        currency: { type: 'string', description: 'Currency code (default USD)' },
        max_departure_dates: {
          type: 'number',
          description: 'Departure dates to sample, 1-7 (default 4)',
        },
        max_pairs: { type: 'number', description: 'Cap on live lookups, 1-18 (default 12)' },
        exclude_basic_economy: {
          type: 'boolean',
          description: 'Ignore basic-economy fares (default true)',
        },
        airlines: {
          type: 'array',
          items: { type: 'string' },
          description: 'Keep only these airlines, e.g. ["UA"]',
        },
        exclude_airlines: {
          type: 'array',
          items: { type: 'string' },
          description: 'Drop these airlines',
        },
        alliances: {
          type: 'array',
          items: { type: 'string' },
          description: 'Keep only these alliances, e.g. ["Star Alliance"]',
        },
        exclude_alliances: {
          type: 'array',
          items: { type: 'string' },
          description: 'Drop these alliances',
        },
        require_checked_bag: {
          type: 'boolean',
          description: 'Keep only itineraries with a free checked bag',
        },
        max_layover_minutes: { type: 'number', description: 'Drop long connections' },
        max_duration_minutes: { type: 'number', description: 'Drop long itineraries' },
        max_price: { type: 'number', description: 'Drop offers priced above this amount' },
        exclude_redeye: {
          type: 'boolean',
          description: 'Drop itineraries departing 22:00-06:00 local time',
        },
        aircraft_types: {
          type: 'array',
          items: { type: 'string' },
          description: 'Keep only these aircraft types (substring match)',
        },
        exclude_aircraft_types: {
          type: 'array',
          items: { type: 'string' },
          description: 'Drop these aircraft types (substring match)',
        },
      },
      required: ['origin', 'destination', 'start_date', 'end_date'],
    },
    handler: async (args: unknown) => {
      try {
        const parsed = GetRoundTripGridSchema.parse(args);
        const client = clientFactory();
        const result = await client.getRoundTripGrid(parsed);
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: 'text', text: `Error pricing round-trip grid: ${message}` }],
          isError: true,
        };
      }
    },
  };
}

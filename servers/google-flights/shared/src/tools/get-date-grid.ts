import { z } from 'zod';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { FlightsClientFactory } from '../server.js';

export const GetDateGridSchema = z.object({
  origin: z
    .string()
    .min(3)
    .describe('Origin airport IATA code (e.g., "SFO"), or comma-separated ("SFO,OAK")'),
  destination: z
    .string()
    .min(3)
    .describe('Destination airport IATA code (e.g., "LAX"), or comma-separated ("NRT,HND")'),
  departure_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe(
      'Anchor date for the grid in YYYY-MM-DD. The grid shows prices around this date. Defaults to 7 days from now.'
    ),
  trip_type: z.enum(['one_way', 'round_trip']).default('one_way').describe('Trip type'),
  seat_class: z
    .enum(['economy', 'premium_economy', 'business', 'first'])
    .default('economy')
    .describe('Cabin class'),
  adults: z.number().int().min(1).max(9).default(1).describe('Number of adult passengers'),
  currency: z
    .string()
    .min(3)
    .max(3)
    .default('USD')
    .describe('Currency code for prices (e.g., "USD", "EUR")'),
  start_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe('First date to price (YYYY-MM-DD). Defaults to departure_date.'),
  end_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe('Last date to price (YYYY-MM-DD). Defaults to start_date.'),
  return_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe('Return date, when pricing round trips'),
  weekdays: z
    .array(z.enum(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']))
    .optional()
    .describe('Only price dates falling on these weekdays'),
  sort: z
    .enum(['date', 'price'])
    .default('date')
    .describe('Return the grid in chronological order or cheapest-first'),
  max_results: z
    .number()
    .int()
    .min(1)
    .max(60)
    .default(10)
    .describe('How many entries to include in cheapest_dates'),
  max_dates: z
    .number()
    .int()
    .min(1)
    .max(14)
    .default(7)
    .describe(
      'How many dates to price with live searches (default 7, hard max 14). Each date costs one polite request.'
    ),
  exclude_basic_economy: z
    .boolean()
    .default(true)
    .describe('Ignore basic-economy fares when picking the cheapest fare for a date'),
  airlines: z
    .array(z.string())
    .optional()
    .describe('Price only these airlines, by IATA code or name, e.g. ["UA"]'),
  exclude_airlines: z
    .array(z.string())
    .optional()
    .describe('Ignore these airlines, by IATA code or name'),
  departure_after: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .optional()
    .describe('Earliest local departure time, "HH:MM"'),
  departure_before: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .optional()
    .describe('Latest local departure time, "HH:MM"'),
  max_duration_minutes: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Ignore itineraries longer than this many minutes'),
  max_layover_minutes: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Ignore itineraries with any connection longer than this many minutes'),
  require_carry_on: z
    .boolean()
    .optional()
    .describe('Keep only itineraries that include a free carry-on bag. Note: Google often leaves this flag unset on international fares, so it can filter out valid itineraries there; prefer require_checked_bag for a reliable signal'),
  require_checked_bag: z
    .boolean()
    .optional()
    .describe('Keep only itineraries that include at least one free checked bag'),
  layover_airports: z
    .array(z.string())
    .optional()
    .describe('Keep only itineraries whose connections are all at these airports (IATA codes)'),
  exclude_layover_airports: z
    .array(z.string())
    .optional()
    .describe('Drop itineraries that connect at any of these airports (IATA codes)'),
  alliances: z
    .array(z.string())
    .optional()
    .describe('Keep only itineraries whose carriers all belong to these alliances, e.g. ["Star Alliance"]'),
  exclude_alliances: z
    .array(z.string())
    .optional()
    .describe('Drop itineraries that include a carrier from any of these alliances'),
});

export function getDateGridTool(_server: Server, clientFactory: FlightsClientFactory) {
  return {
    name: 'get_date_grid',
    description: `Get a date-price grid for a route showing the lowest flight price for each day.

Prices each date in a window with a live Google Flights lookup and returns the cheapest itinerary per date, the overall cheapest date, and a cheapest_dates shortlist.

Give it a window (start_date / end_date, optional weekdays filter) and it prices each date in turn — one polite request per date, capped by max_dates (default 7, hard max 14). Because every date is a real search, results are current rather than cached.

The response also includes price_history, Google's own low-price series for the route over the past ~60 days, and price_insights with Google's read on whether prices are currently low, typical or high. Great for deal-hunting when the user has flexibility on travel dates — call this first to find the cheapest day, then use search_flights on that date.

The same result-side filters as search_flights are available here — airlines / exclude_airlines, alliances / exclude_alliances, departure_after / departure_before, max_duration_minutes, max_layover_minutes, layover_airports / exclude_layover_airports and require_carry_on / require_checked_bag — so "cheapest day to fly United, arriving before noon" is one call.

The grid typically covers ~60 days around the anchor date.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        origin: {
          type: 'string',
          description: 'Origin airport IATA code (e.g., "SFO"), or comma-separated list',
        },
        destination: {
          type: 'string',
          description: 'Destination airport IATA code (e.g., "LAX"), or comma-separated list',
        },
        departure_date: {
          type: 'string',
          description:
            'Anchor date in YYYY-MM-DD. Grid shows prices around this date. Default: 7 days from now.',
        },
        trip_type: {
          type: 'string',
          enum: ['one_way', 'round_trip'],
          description: 'Trip type (default: one_way)',
        },
        seat_class: {
          type: 'string',
          enum: ['economy', 'premium_economy', 'business', 'first'],
          description: 'Cabin class (default: economy)',
        },
        adults: {
          type: 'number',
          description: 'Number of adult passengers (default: 1)',
        },
        currency: {
          type: 'string',
          description: 'Currency code for prices (default: USD)',
        },
        start_date: { type: 'string', description: 'First date to price (YYYY-MM-DD)' },
        end_date: { type: 'string', description: 'Last date to price (YYYY-MM-DD)' },
        return_date: { type: 'string', description: 'Return date for round-trip pricing' },
        weekdays: {
          type: 'array',
          items: { type: 'string' },
          description: 'Only price dates falling on these weekdays (e.g. ["friday"])',
        },
        sort: {
          type: 'string',
          enum: ['date', 'price'],
          description: 'Grid order: chronological (default) or cheapest first',
        },
        max_results: {
          type: 'number',
          description: 'How many entries to include in cheapest_dates (default 10)',
        },
        max_dates: {
          type: 'number',
          description: 'How many dates to price live (default 7, max 14)',
        },
        exclude_basic_economy: {
          type: 'boolean',
          description: 'Ignore basic-economy fares when picking a date\'s cheapest fare (default true)',
        },
        airlines: {
          type: 'array',
          items: { type: 'string' },
          description: 'Price only these airlines, by IATA code or name, e.g. ["UA"]',
        },
        exclude_airlines: {
          type: 'array',
          items: { type: 'string' },
          description: 'Ignore these airlines, by IATA code or name',
        },
        departure_after: {
          type: 'string',
          description: 'Earliest local departure time "HH:MM"',
        },
        departure_before: {
          type: 'string',
          description: 'Latest local departure time "HH:MM"',
        },
        max_duration_minutes: {
          type: 'number',
          description: 'Ignore itineraries longer than this many minutes',
        },
        max_layover_minutes: {
          type: 'number',
          description: 'Ignore itineraries with any connection longer than this many minutes',
        },
        require_carry_on: {
          type: 'boolean',
          description: 'Keep only itineraries that include a free carry-on bag. Note: Google often leaves this flag unset on international fares, so it can filter out valid itineraries there; prefer require_checked_bag for a reliable signal',
        },
        require_checked_bag: {
          type: 'boolean',
          description: 'Keep only itineraries that include at least one free checked bag',
        },
        layover_airports: {
          type: 'array',
          items: { type: 'string' },
          description: 'Keep only itineraries whose connections are all at these airports (IATA codes)',
        },
        exclude_layover_airports: {
          type: 'array',
          items: { type: 'string' },
          description: 'Drop itineraries that connect at any of these airports (IATA codes)',
        },
        alliances: {
          type: 'array',
          items: { type: 'string' },
          description: 'Keep only itineraries whose carriers all belong to these alliances, e.g. ["Star Alliance"]',
        },
        exclude_alliances: {
          type: 'array',
          items: { type: 'string' },
          description: 'Drop itineraries that include a carrier from any of these alliances',
        },
      },
      required: ['origin', 'destination'],
    },
    handler: async (args: unknown) => {
      try {
        const parsed = GetDateGridSchema.parse(args);

        const client = clientFactory();
        const result = await client.getDateGrid(parsed);

        if (result.date_grid.length === 0) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  query: { origin: parsed.origin, destination: parsed.destination },
                  date_grid: [],
                  cheapest: null,
                  currency: parsed.currency,
                  message:
                    'No date grid data available. This may happen for certain routes or date ranges.',
                }),
              },
            ],
          };
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                query: { origin: parsed.origin, destination: parsed.destination },
                ...result,
              }),
            },
          ],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: 'text', text: `Error getting date grid: ${message}` }],
          isError: true,
        };
      }
    },
  };
}

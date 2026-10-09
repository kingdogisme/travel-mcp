import { z } from 'zod';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { FlightsClientFactory } from '../server.js';

export const MultiCityLegSchema = z.object({
  origin: z.string().min(3).describe('Leg origin airport IATA code (e.g. "SFO") or a city name (e.g. "Tokyo")'),
  destination: z.string().min(3).describe('Leg destination airport IATA code (e.g. "NRT") or a city name (e.g. "Tokyo")'),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .describe('Leg departure date in YYYY-MM-DD format'),
});

export const SearchMultiCitySchema = z.object({
  legs: z
    .array(MultiCityLegSchema)
    .min(2)
    .max(6)
    .describe('Two to six legs, in travel order. Each leg is origin -> destination on a date.'),
  seat_class: z
    .enum(['economy', 'premium_economy', 'business', 'first'])
    .default('economy')
    .describe('Cabin class applied to every leg'),
  adults: z.number().int().min(1).max(9).default(1).describe('Number of adult passengers'),
  children: z.number().int().min(0).max(9).default(0).describe('Number of child passengers'),
  infants_in_seat: z.number().int().min(0).max(9).default(0).describe('Infants with their own seat'),
  infants_on_lap: z.number().int().min(0).max(9).default(0).describe('Infants on lap'),
  max_stops: z
    .enum(['any', 'nonstop', '1', '2'])
    .default('any')
    .describe('Maximum number of stops per leg'),
  sort_by: z
    .enum(['best', 'price', 'duration', 'departure', 'arrival', 'emissions'])
    .default('best')
    .describe('Sort order for each leg\'s options'),
  max_results: z
    .number()
    .int()
    .min(1)
    .max(20)
    .default(5)
    .describe('Maximum options to return per leg (default 5)'),
  currency: z.string().min(3).max(3).default('USD').describe('Currency code for prices'),
  exclude_basic_economy: z
    .boolean()
    .default(true)
    .describe('Exclude basic economy fares (default true)'),
  max_emissions_percent: z
    .number()
    .min(-100)
    .max(500)
    .optional()
    .describe('Keep only itineraries at most this percent above typical CO2e for the route'),
  airlines: z
    .array(z.string())
    .optional()
    .describe('Keep only these airlines, by IATA code or name, e.g. ["UA", "ANA"]'),
  exclude_airlines: z
    .array(z.string())
    .optional()
    .describe('Drop these airlines, by IATA code or name, e.g. ["NK"]'),
  departure_after: z.string().regex(/^\d{2}:\d{2}$/).optional().describe('Earliest local departure "HH:MM"'),
  departure_before: z.string().regex(/^\d{2}:\d{2}$/).optional().describe('Latest local departure "HH:MM"'),
  arrival_after: z.string().regex(/^\d{2}:\d{2}$/).optional().describe('Earliest local arrival "HH:MM"'),
  arrival_before: z.string().regex(/^\d{2}:\d{2}$/).optional().describe('Latest local arrival "HH:MM"'),
  max_duration_minutes: z.number().int().positive().optional().describe('Drop itineraries longer than this'),
  max_layover_minutes: z.number().int().positive().optional().describe('Drop long connections'),
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

export function searchMultiCityTool(_server: Server, clientFactory: FlightsClientFactory) {
  return {
    name: 'search_multi_city',
    description: `Search a multi-city trip (2-6 legs) on Google Flights.

Google does not return one combined multi-city itinerary; it prices each leg on its own. This tool therefore searches every leg as its own one-way trip and returns, per leg, the best matching options (price, airline, times, stops, layovers, emissions), plus the sum of each leg's cheapest fare in cheapest_total.

Pass the legs in travel order, for example:
  legs: [
    { origin: "SFO", destination: "NRT", date: "2026-11-15" },
    { origin: "NRT", destination: "ICN", date: "2026-11-20" },
    { origin: "ICN", destination: "SFO", date: "2026-11-25" }
  ]

All the usual filters apply to every leg: cabin, passengers, max_stops, airlines / exclude_airlines, alliances / exclude_alliances, time-of-day windows, max_duration_minutes, max_layover_minutes, layover_airports / exclude_layover_airports, require_carry_on / require_checked_bag, max_price, exclude_redeye, aircraft_types / exclude_aircraft_types and emissions.

Each leg's origin and destination accept an IATA code, a comma-separated list, or a city name (e.g. "Tokyo"). Note: each leg is a separate Google query, so expect roughly one fetch per leg.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        legs: {
          type: 'array',
          minItems: 2,
          maxItems: 6,
          items: {
            type: 'object',
            properties: {
              origin: { type: 'string', description: 'Leg origin IATA code or city name' },
              destination: { type: 'string', description: 'Leg destination IATA code or city name' },
              date: { type: 'string', description: 'Leg date YYYY-MM-DD' },
            },
            required: ['origin', 'destination', 'date'],
          },
          description: 'Two to six legs, in travel order',
        },
        seat_class: {
          type: 'string',
          enum: ['economy', 'premium_economy', 'business', 'first'],
          description: 'Cabin class (default economy)',
        },
        adults: { type: 'number', description: 'Adult passengers (default 1)' },
        children: { type: 'number', description: 'Child passengers (default 0)' },
        infants_in_seat: { type: 'number', description: 'Infants in a seat (default 0)' },
        infants_on_lap: { type: 'number', description: 'Infants on lap (default 0)' },
        max_stops: {
          type: 'string',
          enum: ['any', 'nonstop', '1', '2'],
          description: 'Max stops per leg (default any)',
        },
        sort_by: {
          type: 'string',
          enum: ['best', 'price', 'duration', 'departure', 'arrival', 'emissions'],
          description: 'Sort order per leg (default best)',
        },
        max_results: { type: 'number', description: 'Max options per leg, 1-20 (default 5)' },
        currency: { type: 'string', description: 'Currency code (default USD)' },
        exclude_basic_economy: {
          type: 'boolean',
          description: 'Exclude basic economy fares (default true)',
        },
        max_emissions_percent: {
          type: 'number',
          description: 'Keep only itineraries at most this percent above typical CO2e',
        },
        airlines: {
          type: 'array',
          items: { type: 'string' },
          description: 'Keep only these airlines, e.g. ["UA", "ANA"]',
        },
        exclude_airlines: {
          type: 'array',
          items: { type: 'string' },
          description: 'Drop these airlines, e.g. ["NK"]',
        },
        departure_after: { type: 'string', description: 'Earliest local departure "HH:MM"' },
        departure_before: { type: 'string', description: 'Latest local departure "HH:MM"' },
        arrival_after: { type: 'string', description: 'Earliest local arrival "HH:MM"' },
        arrival_before: { type: 'string', description: 'Latest local arrival "HH:MM"' },
        max_duration_minutes: { type: 'number', description: 'Drop itineraries longer than this' },
        max_layover_minutes: { type: 'number', description: 'Drop long connections' },
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
      required: ['legs'],
    },
    handler: async (args: unknown) => {
      try {
        const parsed = SearchMultiCitySchema.parse(args);
        const client = clientFactory();
        const result = await client.searchMultiCity(parsed);
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: 'text', text: `Error searching multi-city flights: ${message}` }],
          isError: true,
        };
      }
    },
  };
}

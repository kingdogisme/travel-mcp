import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { ClientFactory } from '../server.js';
import type { IPointsYeahClient } from '../server.js';
import { ExploreAwardRoutesParamsSchema } from '../pointsyeah-api/schemas.js';

const DESCRIPTION = `Explore award availability across whole regions and a date range, using PointsYeah's developer API.

Instead of naming one route, you describe where the trip starts and ends as places — airports, countries, continents, regions or states — and a window of dates. PointsYeah then returns every award it knows about in that space, cheapest-first, with miles, taxes, cabin, seats and transfer partners.

Examples:
- "award seats to Tokyo from California in November" → arrival { airports: ["NRT", "HND"] } or { countries: ["JP"] }, departure { states: ["CA"] }
- "business class awards from the US to Europe this winter" → departure { countries: ["US"] }, arrival { continents: ["EU"] }, cabins ["Business"]
- "anywhere in Asia from SFO/OAK/SJC" → departure { airports: ["SFO", "OAK", "SJC"] }, arrival { continents: ["AS"] }

Filters take codes, not names: airports are IATA ("NRT"), countries ISO-2 ("JP"), states two-letter ("CA"), continents two-letter ("AS", "EU", "NA", "SA", "AF", "OC"). Full names like "Japan" or "California" match nothing and come back empty. Give at least one filter, otherwise the search has nothing to work with.

Uses the same PointsYeah login as the other tools (no separate API key), and a plain HTTP endpoint, so it answers in a second or two — unlike search_flights, which drives a real browser for live availability. Use this to find where the deals are, then search_flights to confirm live space.`;

export function exploreAwardRoutesTool(_server: Server, clientFactory: ClientFactory) {
  return {
    name: 'explore_award_routes',
    description: DESCRIPTION,
    inputSchema: {
      type: 'object' as const,
      properties: {
        departure: {
          type: 'object',
          description: 'Where the trip starts — codes only: airports ["SFO"], countries ["US"], continents ["AS"], states ["CA"]',
          properties: {
            airports: { type: 'array', items: { type: 'string' } },
            countries: { type: 'array', items: { type: 'string' } },
            continents: { type: 'array', items: { type: 'string' } },
            regions: { type: 'array', items: { type: 'string' } },
            states: { type: 'array', items: { type: 'string' } },
          },
        },
        arrival: {
          type: 'object',
          description: 'Where the trip ends — same shape as departure (codes only)',
          properties: {
            airports: { type: 'array', items: { type: 'string' } },
            countries: { type: 'array', items: { type: 'string' } },
            continents: { type: 'array', items: { type: 'string' } },
            regions: { type: 'array', items: { type: 'string' } },
            states: { type: 'array', items: { type: 'string' } },
          },
        },
        startDate: { type: 'string', description: 'First departure date YYYY-MM-DD' },
        endDate: { type: 'string', description: 'Last departure date YYYY-MM-DD' },
        cabins: {
          type: 'array',
          items: { type: 'string', enum: ['Economy', 'Premium Economy', 'Business', 'First'] },
          description: 'Cabins to include (default ["Economy"])',
        },
        seats: { type: 'number', description: 'Seats needed (default 1)' },
        weekendOnly: { type: 'boolean', description: 'Only weekend departures (default false)' },
        sort: {
          type: 'string',
          enum: ['miles', 'tax', 'duration', 'date'],
          description: 'Ordering (default miles)',
        },
        page: { type: 'number', description: 'Page number (default 1)' },
        pageSize: { type: 'number', description: 'Results per page, 1-100 (default 20)' },
      },
      required: ['startDate', 'endDate'],
    },
    handler: async (args: unknown) => {
      try {
        const params = ExploreAwardRoutesParamsSchema.parse(args);
        const departure = params.departure ?? {};
        const arrival = params.arrival ?? {};
        const hasFilter = [...Object.values(departure), ...Object.values(arrival)].some(
          (list) => Array.isArray(list) && list.length > 0
        );
        if (!hasFilter) {
          return {
            content: [
              {
                type: 'text',
                text: 'Error: give at least one airport, country, continent, region or state in departure or arrival.',
              },
            ],
            isError: true,
          };
        }

        const result = await clientFactory().exploreAwardRoutes({
          departure,
          arrival,
          start_date: params.startDate,
          end_date: params.endDate,
          cabins: params.cabins,
          seats: params.seats,
          weekend_only: params.weekendOnly,
          sort: params.sort,
          collection: false,
          pagination: { page: params.page, page_size: params.pageSize },
        });

        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: 'text', text: `Error exploring award routes: ${message}` }],
          isError: true,
        };
      }
    },
  };
}

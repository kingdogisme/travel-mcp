import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { ClientFactory } from '../server.js';
import { PointsYeahApiClient } from '../pointsyeah-api/client.js';
import { ExploreAwardRoutesParamsSchema } from '../pointsyeah-api/schemas.js';

const DESCRIPTION = `Explore award availability across whole regions and a date range, using PointsYeah's developer API.

Instead of naming one route, you describe where the trip starts and ends as places — airports, countries, continents, regions or states — and a window of dates. PointsYeah then returns every award it knows about in that space, cheapest-first, with miles, taxes, cabin, seats and transfer partners.

Examples:
- "award seats to Tokyo from any California airport in November" → arrival { airports: ["NRT", "HND"] } or { countries: ["Japan"] }, departure { states: ["California"] }
- "business class awards from the US to Europe this winter" → departure { countries: ["United States"] }, arrival { continents: ["Europe"] }, cabins ["Business"]

Requires a PointsYeah developer API key (premium tier). Set POINTSYEAH_API_KEY, or call set_api_key first.

This is a plain HTTP API, so it answers in a second or two — unlike search_flights, which drives a real browser for live availability. Use this to find where the deals are, then search_flights to confirm live space.`;

export function exploreAwardRoutesTool(_server: Server, _clientFactory: ClientFactory) {
  return {
    name: 'explore_award_routes',
    description: DESCRIPTION,
    inputSchema: {
      type: 'object' as const,
      properties: {
        departure: {
          type: 'object',
          description: 'Where the trip starts (airports / countries / continents / regions / states)',
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
          description: 'Where the trip ends (same shape as departure)',
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

        const result = await new PointsYeahApiClient().explorerSearch({
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

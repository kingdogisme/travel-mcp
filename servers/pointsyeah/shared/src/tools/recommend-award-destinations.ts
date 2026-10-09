import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { ClientFactory } from '../server.js';
import { PointsYeahApiClient } from '../pointsyeah-api/client.js';
import { RecommendAwardDestinationsParamsSchema } from '../pointsyeah-api/schemas.js';

const DESCRIPTION = `Recommend where to go on points from a given city.

Answers "where can I fly on points from SFO?" by asking PointsYeah for curated routes out of an origin, optionally narrowed to a region. Returns the routes with their redemption value rather than a single date's availability.

Requires a PointsYeah developer API key (premium tier): set POINTSYEAH_API_KEY or call set_api_key first. Fast — plain HTTP, no browser.`;

export function recommendAwardDestinationsTool(_server: Server, _clientFactory: ClientFactory) {
  return {
    name: 'recommend_award_destinations',
    description: DESCRIPTION,
    inputSchema: {
      type: 'object' as const,
      properties: {
        departure: {
          type: 'string',
          description: 'Origin airport code (e.g. "SFO")',
        },
        cabins: {
          type: 'array',
          items: { type: 'string', enum: ['Economy', 'Premium Economy', 'Business', 'First'] },
          description: 'Cabins to include (default ["Economy"])',
        },
        today: { type: 'string', description: 'Reference date YYYY-MM-DD (defaults to today)' },
        arrivalAnywhere: { type: 'boolean', description: 'Look anywhere (default true)' },
        arrival: {
          type: 'object',
          description: 'Optional place filter to narrow the recommendations',
          properties: {
            airports: { type: 'array', items: { type: 'string' } },
            countries: { type: 'array', items: { type: 'string' } },
            continents: { type: 'array', items: { type: 'string' } },
            regions: { type: 'array', items: { type: 'string' } },
            states: { type: 'array', items: { type: 'string' } },
          },
        },
      },
      required: ['departure'],
    },
    handler: async (args: unknown) => {
      try {
        const params = RecommendAwardDestinationsParamsSchema.parse(args);
        const departure = Array.isArray(params.departure)
          ? { airports: params.departure }
          : { airport: params.departure };

        const arrival = params.arrivalAnywhere
          ? { anywhere: true }
          : (params.arrival ?? {});

        const result = await new PointsYeahApiClient().explorerRecommend({
          departure,
          arrival,
          today: params.today ?? new Date().toISOString().split('T')[0],
          cabins: params.cabins,
        });

        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: 'text', text: `Error recommending destinations: ${message}` }],
          isError: true,
        };
      }
    },
  };
}

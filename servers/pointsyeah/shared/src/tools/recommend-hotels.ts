import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { ClientFactory } from '../server.js';
import { HotelRecommendParamsSchema } from '../pointsyeah-api/schemas.js';

const DESCRIPTION = `Recommend hotels worth redeeming points at, near a place.

PointsYeah curates these for redemption value rather than plain availability, so this is a quick answer to "where should I stay on points?". Each result carries the points price, the cash price, the room type and the property (with the id used by hotel_availability_calendar and get_hotel_detail). Note that this is PointsYeah's recommendation feed for the dates, so it can include properties beyond the searched city — use search_hotels when the location has to be exact.

Give a place name ("Tokyo") or a full location object with coordinates for the most accurate results. Uses the same PointsYeah login as the other tools, and answers in about a second.`;

export function recommendHotelsTool(_server: Server, clientFactory: ClientFactory) {
  return {
    name: 'recommend_hotels',
    description: DESCRIPTION,
    inputSchema: {
      type: 'object' as const,
      properties: {
        location: {
          description: 'Place name ("Tokyo") or a location object with coordinates',
          oneOf: [
            { type: 'string' },
            {
              type: 'object',
              properties: {
                label: { type: 'string' },
                value: { type: 'string' },
                longitude: { type: 'number' },
                latitude: { type: 'number' },
                distance: { type: 'number' },
                dest_type: { type: 'string' },
                country_code: { type: 'string' },
              },
              required: ['label'],
            },
          ],
        },
        startDate: { type: 'string', description: 'Check-in date YYYY-MM-DD' },
        endDate: { type: 'string', description: 'Check-out date YYYY-MM-DD' },
        sort: {
          type: 'string',
          enum: ['points', 'cash', 'value'],
          description: 'Ordering (default points)',
        },
        page: { type: 'number', description: 'Page number (default 1)' },
        pageSize: { type: 'number', description: 'Results per page, 1-50 (default 10)' },
      },
      required: ['location', 'startDate', 'endDate'],
    },
    handler: async (args: unknown) => {
      try {
        const params = HotelRecommendParamsSchema.parse(args);
        const location =
          typeof params.location === 'string'
            ? { label: params.location, value: params.location }
            : params.location;

        const result = await clientFactory().recommendHotels({
          location,
          start_date: params.startDate,
          end_date: params.endDate,
          sort: params.sort,
          pagination: { page: params.page, page_size: params.pageSize },
        });

        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: 'text', text: `Error recommending hotels: ${message}` }],
          isError: true,
        };
      }
    },
  };
}

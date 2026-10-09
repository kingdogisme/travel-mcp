import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { ClientFactory } from '../server.js';
import { HotelCalendarParamsSchema, HotelDetailParamsSchema } from '../pointsyeah-api/schemas.js';

const CALENDAR_DESCRIPTION = `Show a hotel's daily award availability for a whole month.

Give a property id (from search_hotels) and a month, and get each check-in date's points price, cash price and room type — the fastest way to see which nights are cheap on points.

Uses the same PointsYeah login as the other tools.`;

const DETAIL_DESCRIPTION = `Get a hotel property's details — images, address, phone and description — from its PointsYeah property id (found in search_hotels results).

Uses the same PointsYeah login as the other tools.`;

export function hotelCalendarTool(_server: Server, clientFactory: ClientFactory) {
  return {
    name: 'hotel_availability_calendar',
    description: CALENDAR_DESCRIPTION,
    inputSchema: {
      type: 'object' as const,
      properties: {
        propertyId: { type: 'number', description: 'PointsYeah property id from search_hotels' },
        month: { type: 'string', description: 'Month to inspect, e.g. "2026-11"' },
      },
      required: ['propertyId', 'month'],
    },
    handler: async (args: unknown) => {
      try {
        const params = HotelCalendarParamsSchema.parse(args);
        const result = await clientFactory().hotelCalendar({
          property_id: params.propertyId,
          month: params.month,
        });
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: 'text', text: `Error loading hotel calendar: ${message}` }],
          isError: true,
        };
      }
    },
  };
}

export function hotelDetailTool(_server: Server, clientFactory: ClientFactory) {
  return {
    name: 'get_hotel_detail',
    description: DETAIL_DESCRIPTION,
    inputSchema: {
      type: 'object' as const,
      properties: {
        propertyId: { type: 'number', description: 'PointsYeah property id from search_hotels' },
      },
      required: ['propertyId'],
    },
    handler: async (args: unknown) => {
      try {
        const params = HotelDetailParamsSchema.parse(args);
        const result = await clientFactory().hotelDetail({
          property_id: params.propertyId,
        });
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: 'text', text: `Error loading hotel detail: ${message}` }],
          isError: true,
        };
      }
    },
  };
}

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { ClientFactory } from '../server.js';
import { SearchHotelsParamsSchema } from '../pointsyeah-api/schemas.js';

const DESCRIPTION = `Search hotel award availability (points and cash) with PointsYeah.

Returns hotels with the points price, the cash price, room type, the hotel's loyalty program and brand, and the bank transfer options that can fund the stay. Filter by points ceiling, cash ceiling, loyalty program (hyatt, hilton, marriott, ihg, …), brand, amenities, or free-night certificates.

Give a place name ("Tokyo") or, for the most accurate results, a full location object with latitude/longitude and dest_type. Each result carries the property id you can feed to hotel_availability_calendar or get_hotel_detail.

Uses the same PointsYeah login as the other tools. Fast — plain HTTP, no browser.`;

export function searchHotelsTool(_server: Server, clientFactory: ClientFactory) {
  return {
    name: 'search_hotels',
    description: DESCRIPTION,
    inputSchema: {
      type: 'object' as const,
      properties: {
        location: {
          description:
            'Place name ("Tokyo") or a full location object { label, longitude, latitude, dest_type, country_code, distance }',
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
        maxPoints: { type: 'number', description: 'Only hotels under this many points' },
        maxCash: { type: 'number', description: 'Only hotels under this cash price' },
        programs: {
          type: 'array',
          items: { type: 'string' },
          description: 'Loyalty programs, e.g. ["hyatt", "hilton"]',
        },
        brands: { type: 'array', items: { type: 'string' }, description: 'Hotel brands' },
        amenities: {
          type: 'array',
          items: { type: 'string' },
          description: 'Required amenities, e.g. ["pet_friendly"]',
        },
        freeNightCertificates: {
          type: 'array',
          items: { type: 'string' },
          description: 'Free-night certificates to price against',
        },
        weekendOnly: { type: 'boolean', description: 'Only weekend stays (default false)' },
        holidayOnly: { type: 'boolean', description: 'Only holiday stays (default false)' },
        suiteOnly: { type: 'boolean', description: 'Only suites (default false)' },
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
        const params = SearchHotelsParamsSchema.parse(args);
        const location =
          typeof params.location === 'string'
            ? { label: params.location, value: params.location }
            : params.location;

        const result = await clientFactory().searchHotels({
          location,
          start_date: params.startDate,
          end_date: params.endDate,
          max_points: params.maxPoints,
          max_prices: params.maxCash,
          programs: params.programs ?? [],
          brands: params.brands ?? [],
          amenities: params.amenities ?? [],
          free_night_certificate: params.freeNightCertificates ?? [],
          fhr_label: [],
          tag: [],
          weekend_only: params.weekendOnly,
          holiday_only: params.holidayOnly,
          suit_only: params.suiteOnly,
          sort: params.sort,
          pagination: { page: params.page, page_size: params.pageSize },
        });

        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: 'text', text: `Error searching hotels: ${message}` }],
          isError: true,
        };
      }
    },
  };
}

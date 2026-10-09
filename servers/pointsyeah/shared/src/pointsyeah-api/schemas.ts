import { z } from 'zod';

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const CABINS = z.array(z.enum(['Economy', 'Premium Economy', 'Business', 'First']));

/** Place filter for the award explorer — every list is OR-ed together. */
export const PlaceFilterSchema = z.object({
  airports: z.array(z.string()).optional().describe('IATA airport codes, e.g. ["SFO", "OAK"]'),
  countries: z.array(z.string()).optional().describe('Country names, e.g. ["Japan"]'),
  continents: z.array(z.string()).optional().describe('Continent names, e.g. ["Asia"]'),
  regions: z.array(z.string()).optional().describe('Region names, e.g. ["Southeast Asia"]'),
  states: z.array(z.string()).optional().describe('State/province names, e.g. ["California"]'),
});

export const ExploreAwardRoutesParamsSchema = z.object({
  departure: PlaceFilterSchema.optional().describe('Where the trip starts'),
  arrival: PlaceFilterSchema.optional().describe('Where it ends'),
  startDate: DATE.describe('First departure date of the window'),
  endDate: DATE.describe('Last departure date of the window'),
  cabins: CABINS.default(['Economy']).describe('Cabin classes to include'),
  seats: z.number().int().min(1).max(9).default(1).describe('Seats needed (default 1)'),
  weekendOnly: z.boolean().default(false).describe('Only weekend departures'),
  sort: z
    .enum(['miles', 'tax', 'duration', 'date'])
    .default('miles')
    .describe('Ordering of the results'),
  page: z.number().int().min(1).default(1).describe('Page number (default 1)'),
  pageSize: z.number().int().min(1).max(100).default(20).describe('Results per page (default 20)'),
});

export type ExploreAwardRoutesParams = z.infer<typeof ExploreAwardRoutesParamsSchema>;

export const RecommendAwardDestinationsParamsSchema = z.object({
  departure: z
    .union([z.string(), z.array(z.string())])
    .describe('Origin airport code(s), e.g. "SFO" or ["SFO", "OAK"]'),
  cabins: CABINS.default(['Economy']).describe('Cabin classes to include'),
  today: DATE.optional().describe('Reference date (defaults to today)'),
  arrivalAnywhere: z.boolean().default(true).describe('Look for destinations anywhere'),
  arrival: PlaceFilterSchema.optional().describe('Narrow the recommended destinations'),
});

export type RecommendAwardDestinationsParams = z.infer<
  typeof RecommendAwardDestinationsParamsSchema
>;

export const HotelLocationSchema = z.object({
  label: z.string().describe('Human-readable place, e.g. "Tokyo" or "New York, NY"'),
  value: z.string().optional().describe('Machine value for the place (defaults to label)'),
  longitude: z.number().optional(),
  latitude: z.number().optional(),
  distance: z.number().optional().describe('Search radius in metres'),
  dest_type: z
    .enum(['city', 'region', 'country', 'district', 'landmark', 'airport', 'hotel'])
    .optional(),
  country_code: z.string().optional(),
});

export const SearchHotelsParamsSchema = z.object({
  location: z
    .union([z.string(), HotelLocationSchema])
    .describe(
      'Where to stay: a place name ("Tokyo") or a full location object with coordinates, which gives the most accurate results'
    ),
  startDate: DATE.describe('Check-in date'),
  endDate: DATE.describe('Check-out date'),
  maxPoints: z.number().int().positive().optional().describe('Only hotels under this many points'),
  maxCash: z.number().positive().optional().describe('Only hotels under this cash price'),
  programs: z
    .array(z.string())
    .optional()
    .describe('Hotel loyalty programs, e.g. ["hyatt", "hilton", "marriott", "ihg"]'),
  brands: z.array(z.string()).optional().describe('Hotel brands'),
  amenities: z.array(z.string()).optional().describe('Required amenities, e.g. ["pet_friendly"]'),
  freeNightCertificates: z
    .array(z.string())
    .optional()
    .describe('Free-night certificates to price against'),
  weekendOnly: z.boolean().default(false).describe('Only weekend stays'),
  holidayOnly: z.boolean().default(false).describe('Only holiday stays'),
  suiteOnly: z.boolean().default(false).describe('Only suites'),
  sort: z
    .enum(['points', 'cash', 'value'])
    .default('points')
    .describe('Ordering of the results (default points)'),
  page: z.number().int().min(1).default(1).describe('Page number (default 1)'),
  pageSize: z.number().int().min(1).max(50).default(10).describe('Results per page (default 10)'),
});

export type SearchHotelsParams = z.infer<typeof SearchHotelsParamsSchema>;

export const HotelCalendarParamsSchema = z.object({
  propertyId: z.number().int().positive().describe('PointsYeah property id from a hotel search'),
  month: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .describe('Month to inspect, e.g. "2026-11"'),
});

export type HotelCalendarParams = z.infer<typeof HotelCalendarParamsSchema>;

export const HotelDetailParamsSchema = z.object({
  propertyId: z.number().int().positive().describe('PointsYeah property id from a hotel search'),
});

export type HotelDetailParams = z.infer<typeof HotelDetailParamsSchema>;

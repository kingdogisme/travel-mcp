import { z } from 'zod';

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const CABINS = z.array(z.enum(['Economy', 'Premium Economy', 'Business', 'First']));

/** Place filter for the award explorer — every list is OR-ed together. */
export const PlaceFilterSchema = z.object({
  airports: z
    .array(z.string())
    .optional()
    .describe('IATA airport codes, e.g. ["SFO", "OAK"]. Up to three per side.'),
  countries: z
    .array(z.string())
    .optional()
    .describe('ISO-2 country codes, e.g. ["JP", "KR"]. Full names do not match.'),
  continents: z
    .array(z.string())
    .optional()
    .describe('Two-letter continent codes: AS (Asia), EU (Europe), NA, SA, AF, OC'),
  regions: z.array(z.string()).optional().describe('Region codes, where PointsYeah has them'),
  states: z
    .array(z.string())
    .optional()
    .describe('Two-letter state/province codes, e.g. ["CA"]. Full names do not match.'),
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
    .describe('Origin IATA code(s) or a city name, e.g. "SFO", ["SFO", "OAK"] or "Tokyo"'),
  cabins: CABINS.default(['Economy']).describe('Cabin classes to include'),
  today: DATE.optional().describe('Reference date (defaults to today)'),
  arrivalAnywhere: z.boolean().default(true).describe('Look for destinations anywhere'),
  arrival: PlaceFilterSchema.optional().describe('Narrow the recommended destinations'),
});

export type RecommendAwardDestinationsParams = z.infer<
  typeof RecommendAwardDestinationsParamsSchema
>;


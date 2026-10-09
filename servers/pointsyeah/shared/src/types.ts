import { z } from 'zod';

// =============================================================================
// AUTH TYPES
// =============================================================================

export interface CognitoTokens {
  accessToken: string;
  idToken: string;
  expiresAt: number; // Unix timestamp in seconds
}

export interface CognitoAuthResult {
  AuthenticationResult: {
    AccessToken: string;
    IdToken: string;
    ExpiresIn: number;
    TokenType: string;
  };
}

// =============================================================================
// FLIGHT SEARCH TYPES
// =============================================================================

export const FlightSearchParamsSchema = z.object({
  departure: z.string().min(1).describe('Origin airport or city code (e.g., "SFO", "NYC")'),
  arrival: z.string().min(1).describe('Destination airport or city code (e.g., "NYC", "LAX")'),
  departDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .describe('Outbound departure date in YYYY-MM-DD format'),
  returnDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe('Return date in YYYY-MM-DD format (required for round-trip)'),
  tripType: z
    .enum(['1', '2'])
    .default('2')
    .describe('Trip type: "1" for one-way, "2" for round-trip. Default: "2"'),
  adults: z.number().min(1).max(9).default(1).describe('Number of adult passengers. Default: 1'),
  children: z.number().min(0).max(9).default(0).describe('Number of child passengers. Default: 0'),
  cabins: z
    .array(z.enum(['Economy', 'Premium Economy', 'Business', 'First']))
    .default(['Economy', 'Business'])
    .describe('Cabin classes to search. Default: ["Economy", "Business"]'),

  // --- Search scope (sent to PointsYeah) ---

  banks: z
    .array(z.string())
    .optional()
    .describe(
      'Transferable bank currencies to search, e.g. ["Chase", "Amex"]. Defaults to all of them (Amex, Bilt, Capital One, Chase, Citi, WF).'
    ),
  airlineProgram: z
    .array(z.string())
    .optional()
    .describe(
      'Airline loyalty programs to search, e.g. ["UA", "AC", "VS"]. Defaults to all 20 programs.'
    ),
  multiday: z
    .boolean()
    .default(false)
    .describe(
      'Search a range of departure dates instead of a single day. Set departDateTo (and optionally returnDateTo) to bound the range.'
    ),
  departDateTo: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe('Last departure date of a flexible-date window (requires multiday: true)'),
  returnDateTo: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe('Last return date of a flexible-date window (requires multiday: true)'),
  transferBonusOnly: z
    .boolean()
    .default(false)
    .describe('Only return options where a bank transfer bonus is currently active'),
  buyPointsPromotionOnly: z
    .boolean()
    .default(false)
    .describe('Only return options where buying points is currently on promotion'),

  // --- Result filters (applied locally after the search) ---

  maxMiles: z.number().int().positive().optional().describe('Drop routes costing more than this many miles'),
  maxTax: z.number().nonnegative().optional().describe('Drop routes with taxes above this amount'),
  maxStops: z
    .number()
    .int()
    .min(0)
    .max(4)
    .optional()
    .describe('Maximum connections per route (0 = nonstop only)'),
  minSeats: z.number().int().min(1).optional().describe('Require at least this many award seats'),
  maxLayoverMinutes: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Drop routes with any connection longer than this many minutes'),
  excludeRedeye: z
    .boolean()
    .default(false)
    .describe('Drop routes that depart between 21:00 and 05:00'),
  sortBy: z
    .enum(['program', 'miles', 'tax', 'duration'])
    .default('program')
    .describe('Ordering for the returned results'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(200)
    .optional()
    .describe('Cap how many results are returned'),
});

export type FlightSearchParams = z.infer<typeof FlightSearchParamsSchema>;

// =============================================================================
// NORMALIZED TYPES (used by tool output formatting)
// =============================================================================

export interface FlightSegment {
  duration: number;
  flight_number: string;
  dt: string;
  da: string;
  at: string;
  aa: string;
  cabin: string;
}

export interface TransferOption {
  bank: string;
  actual_points: number;
  points: number;
}

export interface FlightPayment {
  currency: string;
  tax: number;
  miles: number;
  cabin: string;
  unit: string;
  seats: number;
  cash_price: number;
}

export interface FlightRoute {
  payment: FlightPayment | null;
  segments: FlightSegment[] | null;
  transfer: TransferOption[] | null;
}

export interface FlightResult {
  program: string;
  code: string;
  date: string;
  departure: string;
  arrival: string;
  routes: FlightRoute[] | null;
}

export interface FlightSearchResults {
  /** Results after local filters were applied. */
  total: number;
  /** How many results PointsYeah returned before filtering. */
  unfiltered_total: number;
  results: FlightResult[];
}

// =============================================================================
// LIVE SEARCH API TYPES (api2.pointsyeah.com task-based search)
// =============================================================================

export interface FlightSearchTask {
  task_id: string;
  total_sub_tasks: number;
  status: string;
}

export interface FlightSearchResponse {
  code: number;
  success: boolean;
  data: {
    result: FlightResult[] | null;
    status: string; // "processing" | "done"
  } | null;
}

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
    .enum(['1', '2', '3'])
    .default('2')
    .describe(
      'Trip type: "1" one-way, "2" round-trip, "3" multi-city (requires departure2 / arrival2 / departDate2). Default: "2"'
    ),
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
  departure2: z
    .string()
    .optional()
    .describe('Second leg origin (multi-city / tripType "3")'),
  arrival2: z
    .string()
    .optional()
    .describe('Second leg destination (multi-city / tripType "3")'),
  departDate2: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe('Second leg departure date (multi-city / tripType "3")'),
  departDateTo2: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe('Second leg end date for a flexible-date window'),
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
  /** Live transfer bonus for this bank -> program pairing, in percent. */
  bonus_percentage?: number;
  /** Unix timestamp (seconds) the bonus ends, when PointsYeah publishes one. */
  bonus_end_date?: number | null;
  /** PointsYeah's marketing line for the bonus, e.g. "25% Bonus, Exp Oct 31st". */
  bonus_slogn?: string;
  /** Short bank code PointsYeah uses, e.g. "Amex", "Chase", "Citi". */
  code?: string;
  /** Bank's transfer-partner page. */
  url?: string;
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
  /** Caveats about the result set, e.g. options hidden because of cabin. */
  notes: string[];
}

// =============================================================================
// TRANSFER BONUS SEARCH
// =============================================================================

export const FindTransferBonusesParamsSchema = z.object({
  origin: z.string().min(3).describe('Origin airport or city code used to probe for bonuses'),
  destination: z.string().min(3).describe('Destination airport or city code'),
  departDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .describe('Departure date in YYYY-MM-DD format'),
  returnDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe('Return date in YYYY-MM-DD for a round-trip probe'),
  cabins: z
    .array(z.enum(['Economy', 'Premium Economy', 'Business', 'First']))
    .default(['Business', 'Economy'])
    .describe('Cabins to probe. Default: ["Business", "Economy"]'),
  adults: z.number().int().min(1).max(9).default(1).describe('Number of adult passengers'),
  children: z.number().int().min(0).max(9).default(0).describe('Number of child passengers'),
  banks: z.array(z.string()).optional().describe('Restrict the search to these transferable banks'),
  minBonusPercent: z
    .number()
    .min(0)
    .max(100)
    .default(1)
    .describe('Only report bonuses at least this large (default 1, i.e. skip 0% entries)'),
  limit: z.number().int().min(1).max(100).default(25).describe('Max bonuses to return'),
});

export type FindTransferBonusesParams = z.infer<typeof FindTransferBonusesParamsSchema>;

export interface TransferBonus {
  bank: string;
  bank_code: string;
  program: string;
  program_code: string;
  bonus_percentage: number;
  /** Award cost in miles on the sample route, before any transfer bonus. */
  award_miles: number;
  /** Points to transfer after the bonus, i.e. ceil(award_miles / (1 + bonus/100)). */
  effective_transfer_points: number;
  /** The two point counts PointsYeah prints beside the transfer option. */
  points_reported: { actual: number; nominal: number };
  bonus_end_date: string | null;
  slogan: string;
  url: string;
  /** The award this bonus was spotted on, so the caller can sanity-check it. */
  sample: {
    departure: string;
    arrival: string;
    date: string;
    miles: number;
    cabin: string;
  } | null;
}

export interface TransferBonusSearchResult {
  bonuses: TransferBonus[];
  searched: {
    origin: string;
    destination: string;
    depart_date: string;
    return_date?: string;
    cabins: string[];
  };
  total_results: number;
  unfiltered_total: number;
  notes: string[];
}

// =============================================================================
// FLEXIBLE-DATE AWARD SEARCH
// =============================================================================

export const FindCheapestAwardDatesParamsSchema = z.object({
  departure: z.string().min(1).describe('Origin airport or city code'),
  arrival: z.string().min(1).describe('Destination airport or city code'),
  departDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .describe('First departure date of the window'),
  departDateTo: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .describe('Last departure date of the window'),
  returnDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Outbound return date'),
  returnDateTo: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe('Last return date of the window (for a flexible return)'),
  cabins: z
    .array(z.enum(['Economy', 'Premium Economy', 'Business', 'First']))
    .default(['Business'])
    .describe('Cabins to search. Default: ["Business"]'),
  adults: z.number().int().min(1).max(9).default(1).describe('Number of adult passengers'),
  children: z.number().int().min(0).max(9).default(0).describe('Number of child passengers'),
  maxStops: z.number().int().min(0).max(4).optional().describe('Maximum connections per route'),
  minSeats: z.number().int().min(1).optional().describe('Require at least this many award seats'),
  maxMiles: z.number().int().positive().optional().describe('Ignore awards above this many miles'),
  sortBy: z.enum(['miles', 'date']).default('miles').describe('Ordering of the returned dates'),
  limit: z.number().int().min(1).max(60).default(20).describe('Max date entries to return'),
});

export type FindCheapestAwardDatesParams = z.infer<typeof FindCheapestAwardDatesParamsSchema>;

export interface AwardDateOption {
  date: string;
  program: string;
  program_code: string;
  miles: number;
  tax: number;
  cabin: string;
  seats: number;
  stops: number;
  itinerary: string;
}

export interface CheapestAwardDatesResult {
  window: { from: string; to: string };
  /** Cheapest award found per calendar date. */
  dates: AwardDateOption[];
  /** Cheapest award per program across the whole window. */
  by_program: Array<{ program: string; program_code: string; cheapest: AwardDateOption }>;
  cheapest: AwardDateOption | null;
  searched_dates: string[];
  total_results: number;
  unfiltered_total: number;
  notes: string[];
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

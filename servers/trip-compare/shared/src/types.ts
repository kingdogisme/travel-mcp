import { z } from 'zod';
import type { CashQuoteStatus, CashPriceBasis } from 'google-flights-mcp-server-shared';

export const CompareOptionsSchema = z.object({
  origin: z.string().min(3).describe('Origin airport code, e.g. "SFO" (comma-separate for several)'),
  destination: z.string().min(3).describe('Destination airport code, e.g. "NRT"'),
  departDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .describe('Departure date in YYYY-MM-DD format'),
  returnDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe('Return date in YYYY-MM-DD (omit for one-way)'),
  departDateTo: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe(
      'Optional end of a flexible departure window. When set (and after departDate), the tool first finds the cheapest cash day and the cheapest award day in the window, then runs the full comparison on the cheapest cash day.'
    ),
  cabin: z
    .enum(['Economy', 'Premium Economy', 'Business', 'First'])
    .default('Business')
    .describe('Cabin to compare (default: Business)'),
  adults: z.number().int().min(1).max(9).default(1).describe('Number of adult passengers'),
  maxMiles: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Ignore award options costing more than this many miles'),
  minCentsPerPoint: z
    .number()
    .positive()
    .optional()
    .describe('Only consider award options worth at least this many cents per point'),
  transferBonusPercent: z
    .number()
    .min(0)
    .max(100)
    .optional()
    .describe(
      'Active transfer bonus to model, e.g. 30 for a 30% bonus. Reduces the effective points cost.'
    ),
  useTransferBonuses: z
    .boolean()
    .default(true)
    .describe(
      'When true (default) and no transferBonusPercent is given, value each award using the live transfer bonus PointsYeah reported on that route. Set false to ignore bonuses.'
    ),
  pointsLimit: z
    .number()
    .int()
    .min(1)
    .max(25)
    .default(8)
    .describe('How many award options to include (default 8)'),
  cashLimit: z
    .number()
    .int()
    .min(1)
    .max(20)
    .default(5)
    .describe('How many cash fares to include (default 5)'),
  useSecondSource: z
    .boolean()
    .default(true)
    .describe(
      'When true (default) and the live search leaves a coverage gap, consult the cached Seats.aero second source once. Set false to skip it.'
    ),
});

export type CompareOptions = z.infer<typeof CompareOptionsSchema>;

export interface CashOption {
  /** Display price remains visible even when it cannot be compared against points. */
  price: number;
  quote_status: CashQuoteStatus | 'unknown';
  currency: string;
  airline: string;
  stops: number;
  duration_minutes: number;
  departure: string;
  arrival: string;
  fare_brand: string | null;
  carry_on_included: boolean;
  checked_bags_included: number;
  emissions_delta_percent: number | null;
}

export interface AwardOption {
  program: string;
  program_name: string;
  miles: number;
  tax: number;
  tax_currency: string;
  cabin: string;
  /** Null when the source did not report a seat count. */
  seats: number | null;
  stops: number;
  duration_minutes: number;
  itinerary: string;
  transfer_from: Array<{ bank: string; points: number }>;
  /** Value of one mile/point in cents, net of the cash fare it replaces. */
  cents_per_point: number | null;
  /** Same, but assuming a transfer bonus inflates each transferred point. */
  cents_per_point_with_bonus: number | null;
  /** Miles after the applied transfer bonus (null when no bonus applies). */
  effective_miles: number | null;
  /** The live transfer bonus applied to this option, when one applies. */
  transfer_bonus: {
    bank: string;
    percentage: number;
    end_date: string | null;
    slogan: string;
  } | null;
  /** Which source produced this option. */
  source: AwardSource;
  /** Whether the price came from a live search or a cached observation. */
  verification: AwardVerification;
  /** Age of the underlying observation in minutes (cached sources only). */
  data_age_minutes: number | null;
  /** Airlines actually flying the itinerary, when the source reports them. */
  operating_carriers: string[];
}

export type AwardSearchStatus =
  | 'awards_found'
  | 'seats_insufficient'
  /** Award options came back but none reported a seat count. */
  | 'seats_unverified'
  | 'no_awards_returned'
  | 'search_failed';

export type CashSearchStatus = 'fares_found' | 'fares_unverified' | 'no_fares_returned' | 'search_failed';

export type AwardSource = 'pointsyeah' | 'seats.aero';

/** How an award price was verified: a live search, or a cached observation. */
export type AwardVerification = 'live-search' | 'cached';

export type SecondSourceStatus = 'skipped' | 'ok' | 'no_results' | 'error';

import type { CoverageGap, VerificationLink } from './coverage.js';

export type { CoverageGap, VerificationLink } from './coverage.js';

export interface CompareResult {
  route: {
    origin: string;
    destination: string;
    depart_date: string;
    return_date?: string;
    cabin: string;
    adults: number;
  };
  cash: {
    cheapest: CashOption | null;
    options: CashOption[];
    price_insights_level: string | null;
    price_history_low: number | null;
    search_url: string;
    /** How the cash lookup ended; "no_fares_returned" is not proof no fare exists. */
    search_status: CashSearchStatus;
    /** Underlying display stage. Unknown when source omits the required contract. */
    quote_status: CashQuoteStatus | 'unknown';
    price_basis: CashPriceBasis | 'unknown';
    party_total: null;
    checkout_verified: false;
    /** Only indicative single-adult one-way fares in the requested cabin may be used for research CPP. */
    usable_for_valuation: boolean;
    /** The cash value the CPP model actually used; null when the displayed fare is not comparable. */
    comparable_price: number | null;
    /** Error text when the cash lookup failed outright, else null. */
    search_error: string | null;
  };
  points: {
    options: AwardOption[];
    /** Programs PointsYeah actually returned (it searches all of them). */
    programs_seen: string[];
    unfiltered_total: number;
    /**
     * How the live award search ended. "no_awards_returned" means the sources
     * searched returned nothing — it is not evidence that no award is bookable.
     */
    search_status: AwardSearchStatus;
    /** Error text when the award search failed outright, else null. */
    search_error: string | null;
    /** Program codes the live search actually queried. */
    programs_searched: string[];
    /** Booking programs known to sit outside the searched sources. */
    coverage_gaps: CoverageGap[];
    /** Manual verification entry points for those gaps. */
    verification_links: VerificationLink[];
    /** Date the coverage list was last verified against the live sources. */
    coverage_last_verified: string;
  };
  verdict: {
    /**
     * "insufficient_data" is the honest answer when the award side could not be
     * verified (search failed, or the searched sources returned nothing while
     * known booking programs were never queried).
     */
    recommendation: 'points' | 'cash' | 'either' | 'insufficient_data';
    best_award_program: string | null;
    cents_per_point: number | null;
    reason: string;
    /** The award-search state this verdict was based on. */
    award_search_status: AwardSearchStatus;
  };
  /**
   * The cached second source (Seats.aero), consulted only when the primary
   * search leaves a gap worth filling. Null when it was never queried.
   */
  second_source: {
    name: string;
    status: SecondSourceStatus;
    error: string | null;
    options_found: number;
    note: string;
  } | null;
  transfer_bonus_percent: number | null;
  /** True when bonuses came from the live search rather than a manual override. */
  auto_transfer_bonuses: boolean;
  /** Present only when a departure window (departDateTo) was given. */
  window: {
    depart_date_to: string;
    /** Cheapest cash day found in the window. */
    cash: { date: string | null; price: number | null; airline: string | null } | null;
    /** Cheapest award day found in the window. */
    points: { date: string | null; miles: number | null; program: string | null; tax: number | null } | null;
    /** The date the points-vs-cash comparison actually ran on. */
    compared_date: string;
    note: string;
  } | null;
}

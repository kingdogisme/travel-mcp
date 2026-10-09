export interface FlightSegment {
  flight_number: string;
  airline: string;
  airline_code: string;
  operated_by: string | null;
  aircraft: string | null;
  origin: string;
  origin_name: string;
  destination: string;
  destination_name: string;
  departure: string;
  arrival: string;
  departure_date: string;
  arrival_date: string;
  duration_minutes: number;
  legroom: string | null;
}

export interface FlightLayover {
  airport: string;
  airport_name: string | null;
  /** Minutes on the ground at this connection. */
  minutes: number;
}

export interface FlightEmissions {
  /** Estimated CO2e for this itinerary, in grams. */
  grams: number;
  /** Google's reference emissions for the same route, in grams. */
  typical_grams: number;
  /** Percent difference vs the reference (negative = lower emissions). */
  delta_percent: number;
}

export interface PriceInsights {
  /** Google's verdict for the current price on this route. */
  level: 'low' | 'typical' | 'high' | null;
  current_price: number | null;
  baseline_price: number | null;
  difference_from_baseline: number | null;
  /** Low end of the price history Google tracks for this route. */
  range_low: number | null;
  /** High end of the price history Google tracks for this route. */
  range_high: number | null;
}

export interface FlightExtensions {
  carry_on_included: boolean;
  checked_bags_included: number;
}

export interface FlightOffer {
  price: number;
  currency: string;
  airline: string;
  airline_code: string;
  is_best: boolean;
  fare_brand: string | null;
  departure: string;
  arrival: string;
  departure_date: string;
  arrival_date: string;
  duration_minutes: number;
  stops: number;
  segments: FlightSegment[];
  layovers: FlightLayover[];
  emissions: FlightEmissions | null;
  extensions: FlightExtensions;
  booking_token: string;
}

export interface PricePoint {
  date: string;
  price: number;
}

export interface DateGridEntry extends PricePoint {
  airline: string | null;
  stops: number | null;
  duration_minutes: number | null;
  emissions_delta_percent: number | null;
}

export interface DateGridResult {
  /** One live sample per requested date, cheapest itinerary found that day. */
  date_grid: DateGridEntry[];
  cheapest: DateGridEntry | null;
  /** The N cheapest dates in the window, cheapest first. */
  cheapest_dates: DateGridEntry[];
  date_range: { from: string; to: string } | null;
  /** The dates actually looked up (capped for politeness). */
  searched_dates: string[];
  /** True when the requested window had more dates than the lookup cap. */
  truncated: boolean;
  /** Dates inside the window where the search returned no itineraries. */
  no_results_dates: string[];
  /** Historical low-price series Google publishes for the route (past ~60 days). */
  price_history: PricePoint[];
  price_insights: PriceInsights | null;
  search_url: string;
  currency: string;
  /** False when Google returned fares from a different cabin than requested. */
  cabin_honored: boolean;
  notes: string[];
}

export interface AirportResult {
  code: string;
  name: string;
  city: string;
  country: string;
}

export interface SearchFlightsOptions {
  /** Single code ("SFO") or several ("SFO,OAK" / ["SFO", "OAK"]). */
  origin: string | string[];
  destination: string | string[];
  departure_date: string;
  return_date?: string;
  trip_type: 'one_way' | 'round_trip';
  seat_class: 'economy' | 'premium_economy' | 'business' | 'first';
  adults: number;
  children: number;
  infants_in_seat: number;
  infants_on_lap: number;
  max_stops: 'any' | 'nonstop' | '1' | '2';
  sort_by: 'best' | 'price' | 'duration' | 'departure' | 'arrival' | 'emissions';
  max_results: number;
  offset: number;
  currency: string;
  exclude_basic_economy: boolean;
  /** Keep only itineraries whose emissions are at most this percent above typical. */
  max_emissions_percent?: number;
  /** Keep only these airlines (IATA codes or names, case-insensitive). */
  airlines?: string[];
  /** Drop these airlines (IATA codes or names, case-insensitive). */
  exclude_airlines?: string[];
  /** Earliest acceptable local departure time, "HH:MM". */
  departure_after?: string;
  /** Latest acceptable local departure time, "HH:MM". */
  departure_before?: string;
  /** Earliest acceptable local arrival time, "HH:MM". */
  arrival_after?: string;
  /** Latest acceptable local arrival time, "HH:MM". */
  arrival_before?: string;
  /** Drop itineraries longer than this many minutes, door to door. */
  max_duration_minutes?: number;
  /** Drop itineraries with any single connection longer than this many minutes. */
  max_layover_minutes?: number;
}

export interface SearchFlightsResult {
  query: {
    origin: string | string[];
    destination: string | string[];
    origins: string[];
    destinations: string[];
    departure_date: string;
    return_date?: string;
    trip_type: string;
    seat_class: string;
    /** False when Google returned fares from a different cabin than requested. */
    cabin_honored: boolean;
    passengers: {
      adults: number;
      children: number;
      infants_in_seat: number;
      infants_on_lap: number;
    };
  };
  total_results: number;
  /** The exact Google Flights URL this result was parsed from. */
  search_url: string;
  price_insights: PriceInsights | null;
  /** Google's tracked low-price series for this route over the past ~60 days. */
  price_history: PricePoint[];
  showing: { offset: number; count: number };
  has_more: boolean;
  next_offset: number | null;
  /** Human-readable caveats about this result set (e.g. cabin not honoured). */
  notes: string[];
  flights: FlightOffer[];
}

export interface GetDateGridOptions {
  origin: string | string[];
  destination: string | string[];
  departure_date?: string;
  trip_type: 'one_way' | 'round_trip';
  seat_class: 'economy' | 'premium_economy' | 'business' | 'first';
  adults: number;
  currency: string;
  /** First date to price (YYYY-MM-DD). */
  start_date?: string;
  /** Last date to price (YYYY-MM-DD). Defaults to start_date. */
  end_date?: string;
  /** Return date for round-trip pricing. */
  return_date?: string;
  /** Restrict to specific weekdays, e.g. ["friday", "saturday"]. */
  weekdays?: string[];
  /** 'date' keeps chronological order, 'price' sorts cheapest first. */
  sort?: 'date' | 'price';
  /** How many entries to include in cheapest_dates (default 10). */
  max_results?: number;
  /** How many dates to look up live (default 7, hard max 14). */
  max_dates?: number;
  /** Drop dates whose cheapest fare is basic economy. */
  exclude_basic_economy?: boolean;
  /** Keep only these airlines (IATA codes or names, case-insensitive). */
  airlines?: string[];
  /** Drop these airlines (IATA codes or names, case-insensitive). */
  exclude_airlines?: string[];
  /** Earliest acceptable local departure time, "HH:MM". */
  departure_after?: string;
  /** Latest acceptable local departure time, "HH:MM". */
  departure_before?: string;
  /** Drop itineraries longer than this many minutes. */
  max_duration_minutes?: number;
  /** Drop itineraries with any connection longer than this many minutes. */
  max_layover_minutes?: number;
}

export type SeatClass = 'economy' | 'premium_economy' | 'business' | 'first';
export type TripType = 'one_way' | 'round_trip';

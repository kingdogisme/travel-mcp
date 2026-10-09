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
  /** Keep only itineraries with a free carry-on bag. */
  require_carry_on?: boolean;
  /** Keep only itineraries with at least one free checked bag. */
  require_checked_bag?: boolean;
  /** Keep only itineraries whose connections are all at these airports (IATA codes). */
  layover_airports?: string[];
  /** Drop itineraries that connect at any of these airports (IATA codes). */
  exclude_layover_airports?: string[];
  /** Keep only itineraries whose carriers all belong to these alliances (e.g. ["Star Alliance"]). */
  alliances?: string[];
  /** Drop itineraries that include a carrier from any of these alliances. */
  exclude_alliances?: string[];
  /** Drop offers priced above this amount (in the search currency). */
  max_price?: number;
  /** Drop itineraries that depart between 22:00 and 06:00 local time. */
  exclude_redeye?: boolean;
  /** Keep only itineraries whose segments are all on one of these aircraft types (substring match). */
  aircraft_types?: string[];
  /** Drop itineraries that use any of these aircraft types (substring match). */
  exclude_aircraft_types?: string[];
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
  /** Keep only itineraries with a free carry-on bag. */
  require_carry_on?: boolean;
  /** Keep only itineraries with at least one free checked bag. */
  require_checked_bag?: boolean;
  /** Keep only itineraries whose connections are all at these airports (IATA codes). */
  layover_airports?: string[];
  /** Drop itineraries that connect at any of these airports (IATA codes). */
  exclude_layover_airports?: string[];
  /** Keep only itineraries whose carriers all belong to these alliances (e.g. ["Star Alliance"]). */
  alliances?: string[];
  /** Drop itineraries that include a carrier from any of these alliances. */
  exclude_alliances?: string[];
  /** Drop offers priced above this amount (in the search currency). */
  max_price?: number;
  /** Drop itineraries that depart between 22:00 and 06:00 local time. */
  exclude_redeye?: boolean;
  /** Keep only itineraries whose segments are all on one of these aircraft types (substring match). */
  aircraft_types?: string[];
  /** Drop itineraries that use any of these aircraft types (substring match). */
  exclude_aircraft_types?: string[];
}

export type SeatClass = 'economy' | 'premium_economy' | 'business' | 'first';
export type TripType = 'one_way' | 'round_trip';

// =============================================================================
// MULTI-CITY SEARCH
//
// Google Flights prices a multi-city trip leg by leg rather than returning a
// single combined itinerary, so we search each leg as its own one-way trip and
// report the options per leg plus the sum of the cheapest fares.
// =============================================================================

export interface MultiCityLeg {
  origin: string;
  destination: string;
  /** Leg departure date, YYYY-MM-DD. */
  date: string;
}

export interface MultiCityLegResult {
  leg: MultiCityLeg;
  total_results: number;
  search_url: string;
  cabin_honored: boolean;
  options: FlightOffer[];
  notes: string[];
}

export interface MultiCityResult {
  legs: MultiCityLegResult[];
  /** Sum of the cheapest fare on each leg, when every leg returned a fare. */
  cheapest_total: {
    currency: string;
    total: number;
    /** Cheapest fare for each leg, in leg order. */
    per_leg: number[];
    airlines: string[];
  } | null;
  notes: string[];
}

export interface SearchMultiCityOptions {
  legs: MultiCityLeg[];
  seat_class: 'economy' | 'premium_economy' | 'business' | 'first';
  adults: number;
  children: number;
  infants_in_seat: number;
  infants_on_lap: number;
  max_stops: 'any' | 'nonstop' | '1' | '2';
  sort_by: 'best' | 'price' | 'duration' | 'departure' | 'arrival' | 'emissions';
  /** Maximum number of options to return per leg. */
  max_results: number;
  currency: string;
  exclude_basic_economy: boolean;
  max_emissions_percent?: number;
  airlines?: string[];
  exclude_airlines?: string[];
  departure_after?: string;
  departure_before?: string;
  arrival_after?: string;
  arrival_before?: string;
  max_duration_minutes?: number;
  max_layover_minutes?: number;
  /** Keep only itineraries with a free carry-on bag. */
  require_carry_on?: boolean;
  /** Keep only itineraries with at least one free checked bag. */
  require_checked_bag?: boolean;
  /** Keep only itineraries whose connections are all at these airports (IATA codes). */
  layover_airports?: string[];
  /** Drop itineraries that connect at any of these airports (IATA codes). */
  exclude_layover_airports?: string[];
  /** Keep only itineraries whose carriers all belong to these alliances (e.g. ["Star Alliance"]). */
  alliances?: string[];
  /** Drop itineraries that include a carrier from any of these alliances. */
  exclude_alliances?: string[];
  /** Drop offers priced above this amount (in the search currency). */
  max_price?: number;
  /** Drop itineraries that depart between 22:00 and 06:00 local time. */
  exclude_redeye?: boolean;
  /** Keep only itineraries whose segments are all on one of these aircraft types (substring match). */
  aircraft_types?: string[];
  /** Drop itineraries that use any of these aircraft types (substring match). */
  exclude_aircraft_types?: string[];
}

// =============================================================================
// ROUND-TRIP DATE GRID
//
// Prices a grid of round trips: each departure date in a window crossed with a
// range of trip lengths (nights). Every cell is a real round-trip search, so the
// number of live lookups is capped for politeness.
// =============================================================================

export interface RoundTripGridOptions {
  origin: string | string[];
  destination: string | string[];
  /** First departure date to consider (YYYY-MM-DD). */
  start_date: string;
  /** Last departure date to consider (YYYY-MM-DD). */
  end_date: string;
  /** Shortest trip length to price, in nights. */
  min_nights: number;
  /** Longest trip length to price, in nights. */
  max_nights: number;
  seat_class: SeatClass;
  adults: number;
  currency: string;
  /** How many departure dates to sample across the window (default 4). */
  max_departure_dates: number;
  /** Hard cap on live round-trip lookups for this call (default 12, hard max 18). */
  max_pairs: number;
  exclude_basic_economy: boolean;
  airlines?: string[];
  exclude_airlines?: string[];
  alliances?: string[];
  exclude_alliances?: string[];
  require_checked_bag?: boolean;
  max_layover_minutes?: number;
  max_duration_minutes?: number;
  /** Drop offers priced above this amount (in the search currency). */
  max_price?: number;
  /** Drop itineraries that depart between 22:00 and 06:00 local time. */
  exclude_redeye?: boolean;
  /** Keep only itineraries whose segments are all on one of these aircraft types (substring match). */
  aircraft_types?: string[];
  /** Drop itineraries that use any of these aircraft types (substring match). */
  exclude_aircraft_types?: string[];
}

export interface RoundTripGridEntry {
  departure_date: string;
  return_date: string;
  /** Trip length in nights. */
  nights: number;
  /** Cheapest fare for this cell, or null when nothing matched. */
  price: number | null;
  airline: string | null;
  stops: number | null;
  duration_minutes: number | null;
}

export interface RoundTripGridResult {
  /** One entry per (departure date, trip length) cell that was priced. */
  grid: RoundTripGridEntry[];
  /** The cheapest priced cell overall. */
  cheapest: RoundTripGridEntry | null;
  /** The cheapest priced cell for each departure date, cheapest first. */
  cheapest_by_departure: RoundTripGridEntry[];
  /** The cheapest priced cell for each trip length, cheapest first. */
  cheapest_by_nights: Array<{ nights: number; entry: RoundTripGridEntry }>;
  /** Number of live round-trip lookups actually made. */
  searched_pairs: number;
  /** True when the requested grid had more cells than the lookup cap allowed. */
  truncated: boolean;
  date_range: { from: string; to: string } | null;
  currency: string;
  /** False when Google returned fares from a different cabin than requested. */
  cabin_honored: boolean;
  search_url: string;
  notes: string[];
}

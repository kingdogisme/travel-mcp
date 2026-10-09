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

export interface DateGridEntry {
  date: string;
  price: number;
}

export interface DateGridResult {
  date_grid: DateGridEntry[];
  cheapest: DateGridEntry | null;
  currency: string;
}

export interface AirportResult {
  code: string;
  name: string;
  city: string;
  country: string;
}

export interface SearchFlightsOptions {
  origin: string;
  destination: string;
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
}

export interface SearchFlightsResult {
  query: {
    origin: string;
    destination: string;
    departure_date: string;
    return_date?: string;
    trip_type: string;
    seat_class: string;
    passengers: {
      adults: number;
      children: number;
      infants_in_seat: number;
      infants_on_lap: number;
    };
  };
  total_results: number;
  price_insights: PriceInsights | null;
  showing: { offset: number; count: number };
  has_more: boolean;
  next_offset: number | null;
  flights: FlightOffer[];
}

export interface GetDateGridOptions {
  origin: string;
  destination: string;
  departure_date?: string;
  trip_type: 'one_way' | 'round_trip';
  seat_class: 'economy' | 'premium_economy' | 'business' | 'first';
  adults: number;
  currency: string;
}

export type SeatClass = 'economy' | 'premium_economy' | 'business' | 'first';
export type TripType = 'one_way' | 'round_trip';

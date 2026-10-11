/**
 * Second source: Seats.aero's public MCP server.
 *
 * Seats.aero exposes cached award availability over a public MCP endpoint that
 * needs no login for public flights departing today through 60 days out. It is
 * used here for one purpose: when the primary search has a coverage gap, check
 * whether another program can book the same flights. It is cached data, so
 * every option carries its age instead of being presented as live.
 *
 * Requests are deliberately sparse — one call per comparison, and only when
 * the comparison has a gap to fill.
 */
import { logDebug, logWarning } from './logging.js';

export const DEFAULT_SEATS_AERO_MCP_URL = 'https://seats.aero/mcp';

export interface SeatsAeroSearchParams {
  origins: string[];
  destinations: string[];
  startDate: string;
  endDate: string;
  cabin: 'economy' | 'premium_economy' | 'business' | 'first';
  minSeats?: number;
  maxResults?: number;
}

export interface SeatsAeroOption {
  flight_ref: string;
  origin: string;
  destination: string;
  cabin: string;
  departs_at: string;
  arrives_at: string;
  stops: number;
  flight_numbers: string;
  miles: number;
  /** Seats.aero's own program id, e.g. "american". */
  program_id: string;
  /** Our program code when we know the mapping, else the uppercased id. */
  program_code: string;
  program_name: string;
  operating_carriers: string[];
  tax: number | null;
  tax_currency: string;
  duration_minutes: number | null;
  /** Null when Seats.aero did not report a seat count. */
  seats: number | null;
  /** How stale the cached observation is, in minutes. */
  data_age_minutes: number | null;
}

export interface ISeatsAeroClient {
  searchFlights(params: SeatsAeroSearchParams): Promise<SeatsAeroOption[]>;
}

/** Seats.aero program ids -> our program code + display name. */
const PROGRAM_MAP: Record<string, { code: string; name: string }> = {
  american: { code: 'AA', name: 'American Airlines AAdvantage' },
  alaska: { code: 'AS', name: 'Alaska Atmos Rewards' },
  finnair: { code: 'AY', name: 'Finnair Plus' },
  qantas: { code: 'QF', name: 'Qantas Frequent Flyer' },
  delta: { code: 'DL', name: 'Delta SkyMiles' },
  united: { code: 'UA', name: 'United MileagePlus' },
  air_canada: { code: 'AC', name: 'Air Canada Aeroplan' },
  aeroplan: { code: 'AC', name: 'Air Canada Aeroplan' },
  avianca: { code: 'AV', name: 'Avianca LifeMiles' },
  lifemiles: { code: 'AV', name: 'Avianca LifeMiles' },
  emirates: { code: 'EK', name: 'Emirates Skywards' },
  etihad: { code: 'EY', name: 'Etihad Guest' },
  turkish: { code: 'TK', name: 'Turkish Airlines Miles&Smiles' },
  singapore: { code: 'SQ', name: 'Singapore Airlines KrisFlyer' },
  krisflyer: { code: 'SQ', name: 'Singapore Airlines KrisFlyer' },
  virgin_atlantic: { code: 'VS', name: 'Virgin Atlantic Flying Club' },
  flying_blue: { code: 'KL', name: 'Flying Blue' },
  air_france: { code: 'KL', name: 'Flying Blue' },
  klm: { code: 'KL', name: 'Flying Blue' },
  jetblue: { code: 'B6', name: 'JetBlue TrueBlue' },
  lufthansa: { code: 'LH', name: 'Lufthansa Miles & More' },
  miles_and_more: { code: 'LH', name: 'Lufthansa Miles & More' },
  sas: { code: 'SK', name: 'SAS EuroBonus' },
  spirit: { code: 'NK', name: 'Spirit Free Spirit' },
  aeromexico: { code: 'AM', name: 'Aeromexico Rewards' },
  aerolineas_argentinas: { code: 'AR', name: 'Aerolineas Argentinas Plus' },
  qatar: { code: 'QR', name: 'Qatar Airways Privilege Club' },
  british_airways: { code: 'BA', name: 'British Airways Club' },
  iberia: { code: 'IB', name: 'Iberia Club' },
  cathay: { code: 'CX', name: 'Cathay Pacific Asia Miles' },
  cathay_pacific: { code: 'CX', name: 'Cathay Pacific Asia Miles' },
  ana: { code: 'NH', name: 'ANA Mileage Club' },
  jal: { code: 'JL', name: 'Japan Airlines Mileage Bank' },
  korean: { code: 'KE', name: 'Korean Air SKYPASS' },
  korean_air: { code: 'KE', name: 'Korean Air SKYPASS' },
  ethiopian: { code: 'ET', name: 'Ethiopian ShebaMiles' },
  singapore_airlines: { code: 'SQ', name: 'Singapore Airlines KrisFlyer' },
  virgin_australia: { code: 'VA', name: 'Virgin Australia Velocity' },
};

function programFor(id: string): { code: string; name: string } {
  const mapped = PROGRAM_MAP[id];
  if (mapped) return mapped;
  const words = id.split(/[_\s]+/).filter(Boolean);
  const name = words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
  return { code: id.toUpperCase(), name: name || id };
}

/** "$100.70 USD" -> { amount: 100.7, currency: "USD" } */
export function parseMoney(raw: unknown): { amount: number | null; currency: string } {
  if (typeof raw === 'number' && Number.isFinite(raw)) return { amount: raw, currency: 'USD' };
  if (typeof raw !== 'string') return { amount: null, currency: 'USD' };
  const match = raw.match(/([\d.,]+)\s*([A-Za-z]{3})?/);
  if (!match) return { amount: null, currency: 'USD' };
  const amount = Number.parseFloat(match[1].replace(/,/g, ''));
  return {
    amount: Number.isFinite(amount) ? amount : null,
    currency: (match[2] ?? 'USD').toUpperCase(),
  };
}

interface RawFlight {
  flight_ref?: unknown;
  origin?: unknown;
  destination?: unknown;
  cabin?: unknown;
  departs_at?: unknown;
  arrives_at?: unknown;
  stops?: unknown;
  flights?: unknown;
  miles_price?: unknown;
  mileage_program?: unknown;
  operating_carriers?: unknown;
  taxes?: unknown;
  duration_minutes?: unknown;
  remaining_seats?: unknown;
  minutes_old?: unknown;
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Normalise one Seats.aero flight record into our shape. */
export function toSeatsAeroOption(raw: RawFlight): SeatsAeroOption | null {
  const ref = str(raw.flight_ref);
  const miles = num(raw.miles_price);
  const programId = str(raw.mileage_program);
  if (!ref || miles === null || !programId) return null;

  const program = programFor(programId);
  const money = parseMoney(raw.taxes);
  const carriers = Array.isArray(raw.operating_carriers)
    ? raw.operating_carriers.filter((code): code is string => typeof code === 'string')
    : [];

  return {
    flight_ref: ref,
    origin: str(raw.origin),
    destination: str(raw.destination),
    cabin: str(raw.cabin),
    departs_at: str(raw.departs_at),
    arrives_at: str(raw.arrives_at),
    stops: num(raw.stops) ?? 0,
    flight_numbers: str(raw.flights),
    miles,
    program_id: programId,
    program_code: program.code,
    program_name: program.name,
    operating_carriers: carriers,
    tax: money.amount,
    tax_currency: money.currency,
    duration_minutes: num(raw.duration_minutes),
    seats: num(raw.remaining_seats),
    data_age_minutes: num(raw.minutes_old),
  };
}

/** Pull flight records out of an MCP tool result, whichever envelope it used. */
export function extractFlights(result: unknown): RawFlight[] {
  if (!result || typeof result !== 'object') return [];
  const payload = result as { structuredContent?: unknown; content?: unknown };
  const structured = payload.structuredContent as { flights?: unknown } | undefined;
  if (structured && Array.isArray(structured.flights)) return structured.flights as RawFlight[];

  if (Array.isArray(payload.content)) {
    const flights: RawFlight[] = [];
    for (const item of payload.content) {
      const text = (item as { text?: unknown })?.text;
      if (typeof text !== 'string') continue;
      // Seats.aero may prefix a note and then stream JSON objects.
      const matches = text.match(/\{[^{}]*"flight_ref"[^{}]*\}/g);
      for (const match of matches ?? []) {
        try {
          flights.push(JSON.parse(match) as RawFlight);
        } catch {
          // Ignore fragments we cannot parse; the structured payload is preferred.
        }
      }
    }
    return flights;
  }

  return [];
}

export class SeatsAeroClient implements ISeatsAeroClient {
  constructor(
    private readonly url: string = process.env.SEATS_AERO_MCP_URL || DEFAULT_SEATS_AERO_MCP_URL
  ) {}

  async searchFlights(params: SeatsAeroSearchParams): Promise<SeatsAeroOption[]> {
    const body = {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'get_flights',
        arguments: {
          origins: params.origins,
          destinations: params.destinations,
          start_date: params.startDate,
          end_date: params.endDate,
          cabin: params.cabin,
          ...(params.minSeats !== undefined ? { min_seats: params.minSeats } : {}),
          ...(params.maxResults !== undefined ? { max_results: params.maxResults } : {}),
        },
      },
    };

    logDebug('seats-aero', `get_flights ${params.origins.join(',')} -> ${params.destinations.join(',')}`);

    const response = await fetch(this.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      throw new Error(`Seats.aero MCP ${response.status} ${response.statusText}`);
    }

    const text = await response.text();
    const jsonText = text.startsWith('data: ') ? text.split('data: ', 2)[1] : text;
    let payload: { result?: unknown; error?: { message?: string } };
    try {
      payload = JSON.parse(jsonText) as typeof payload;
    } catch {
      throw new Error('Seats.aero MCP returned a non-JSON response');
    }

    if (payload.error) {
      throw new Error(`Seats.aero MCP error: ${payload.error.message ?? 'unknown'}`);
    }

    const result = payload.result as { isError?: boolean; content?: Array<{ text?: string }> } | undefined;
    if (result?.isError) {
      const message = result.content?.[0]?.text ?? 'unknown error';
      logWarning('seats-aero', `get_flights failed: ${message}`);
      throw new Error(`Seats.aero get_flights failed: ${message.slice(0, 200)}`);
    }

    const options = extractFlights(result)
      .map(toSeatsAeroOption)
      .filter((option): option is SeatsAeroOption => option !== null);

    logDebug('seats-aero', `${options.length} cached option(s)`);
    return options;
  }
}

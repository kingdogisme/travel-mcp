import { describe, expect, it } from 'vitest';
import {
  buildQueryString,
  buildTfsParam,
  detectBlock,
  enumerateGridDates,
  filterByStops,
  filterOffersByPreferences,
  formatDate,
  formatTime,
  isBasicEconomy,
  minutesOfDay,
  parseAirportList,
  parsePriceHistory,
  rankAnywhereDestinations,
  resolveAirportInput,
  sampleDates,
  addDays,
  withinWindow,
} from '../shared/src/flights-client/flights-client.js';
import { getAllToolNames } from '../shared/src/tools.js';
import type { FlightOffer, FlightSegment } from '../shared/src/flights-client/types.js';

function segment(overrides: Partial<FlightSegment> = {}): FlightSegment {
  return {
    flight_number: 'UA1',
    airline: 'United',
    airline_code: 'UA',
    operated_by: null,
    aircraft: 'Boeing 777',
    origin: 'SFO',
    origin_name: 'San Francisco',
    destination: 'LHR',
    destination_name: 'London',
    departure: '08:00',
    arrival: '12:00',
    departure_date: '2026-11-18',
    arrival_date: '2026-11-18',
    duration_minutes: 600,
    legroom: null,
    ...overrides,
  };
}

function offer(overrides: Partial<FlightOffer> = {}): FlightOffer {
  return {
    price: 500,
    currency: 'USD',
    airline: 'United',
    airline_code: 'UA',
    is_best: false,
    fare_brand: 'Economy',
    departure: '08:00',
    arrival: '12:00',
    departure_date: '2026-11-18',
    arrival_date: '2026-11-18',
    duration_minutes: 600,
    stops: 0,
    segments: [segment()],
    layovers: [],
    emissions: null,
    extensions: { carry_on_included: true, checked_bags_included: 1 },
    booking_token: 'token',
    ...overrides,
  };
}

describe('parseAirportList', () => {
  it('splits comma lists and normalizes case and whitespace', () => {
    expect(parseAirportList('SFO,OAK,SJC')).toEqual(['SFO', 'OAK', 'SJC']);
    expect(parseAirportList(['sfo', ' oak '])).toEqual(['SFO', 'OAK']);
  });

  it('rejects empty and malformed input', () => {
    expect(() => parseAirportList('')).toThrow(/At least one airport code/);
    expect(() => parseAirportList('SF')).toThrow(/Invalid airport code/);
  });
});

describe('resolveAirportInput', () => {
  it('passes IATA codes and comma lists straight through', async () => {
    expect(await resolveAirportInput('SFO')).toBe('SFO');
    expect(await resolveAirportInput('SFO,OAK')).toBe('SFO,OAK');
    expect(await resolveAirportInput('  NRT , HND ')).toBe('NRT , HND');
    expect(await resolveAirportInput(['SFO', 'OAK'])).toEqual(['SFO', 'OAK']);
  });

  it('maps multi-airport cities to their metro code without a lookup', async () => {
    expect(await resolveAirportInput('London')).toBe('LON');
    expect(await resolveAirportInput('london')).toBe('LON');
    expect(await resolveAirportInput('  new   york ')).toBe('NYC');
    expect(await resolveAirportInput('Tokyo')).toBe('TYO');
    expect(await resolveAirportInput('Sao Paulo')).toBe('SAO');
  });
});

describe('buildTfsParam', () => {
  const base = {
    origin: 'SFO',
    destination: 'NRT',
    departureDate: '2026-11-18',
    tripType: 'one_way' as const,
  };

  it('is deterministic and encodes the airports', async () => {
    const tfs = await buildTfsParam(base);
    expect(tfs).toBe(await buildTfsParam(base));
    const decoded = Buffer.from(tfs.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('latin1');
    expect(decoded).toContain('SFO');
    expect(decoded).toContain('NRT');
    expect(tfs).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('changes with the dates and adds a return leg for round trips', async () => {
    const oneWay = await buildTfsParam(base);
    const otherDay = await buildTfsParam({ ...base, departureDate: '2026-11-19' });
    expect(otherDay).not.toBe(oneWay);

    const roundTrip = await buildTfsParam({
      ...base,
      tripType: 'round_trip',
      returnDate: '2026-11-25',
    });
    expect(roundTrip).not.toBe(oneWay);
    const decoded = Buffer.from(roundTrip.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('latin1');
    expect(decoded).toContain('2026-11-25');
  });
});

describe('buildQueryString', () => {
  it('builds the natural-language query Google expects', () => {
    const query = buildQueryString({
      origin: 'SFO',
      destination: 'NRT',
      departure_date: '2026-11-18',
      trip_type: 'one_way',
      seat_class: 'economy',
      adults: 1,
      children: 0,
    });
    expect(query).toBe('Flights from SFO to NRT on 2026-11-18 economy class');
  });

  it('describes round trips, extra airports and passengers', () => {
    const query = buildQueryString({
      origin: 'SFO,OAK',
      destination: 'NRT,HND',
      departure_date: '2026-11-18',
      return_date: '2026-11-25',
      trip_type: 'round_trip',
      seat_class: 'business',
      adults: 2,
      children: 1,
    });
    expect(query).toBe(
      'Flights from SFO or OAK to NRT or HND departing 2026-11-18 returning 2026-11-25 for 3 passengers business class'
    );
  });
});

describe('filterOffersByPreferences', () => {
  it('keeps only the requested airlines and drops excluded ones', () => {
    const offers = [
      offer({ airline_code: 'UA', segments: [segment({ airline_code: 'UA' })] }),
      offer({ airline_code: 'DL', segments: [segment({ airline_code: 'DL', airline: 'Delta' })] }),
    ];
    expect(filterOffersByPreferences(offers, { airlines: ['UA'] })).toHaveLength(1);
    expect(filterOffersByPreferences(offers, { exclude_airlines: ['DL'] })).toHaveLength(1);
  });

  it('filters by alliance, including codes carried on segments', () => {
    const star = offer({ airline_code: 'UA', segments: [segment({ airline_code: 'UA' })] });
    const oneWorld = offer({ airline_code: 'AA', segments: [segment({ airline_code: 'AA' })] });
    const mixed = offer({
      airline_code: 'UA',
      segments: [segment({ airline_code: 'UA' }), segment({ airline_code: 'AA', airline: 'American' })],
    });

    expect(filterOffersByPreferences([star, oneWorld], { alliances: ['Star Alliance'] })).toEqual([star]);
    expect(filterOffersByPreferences([star, oneWorld, mixed], { exclude_alliances: ['oneworld'] })).toEqual([star]);
  });

  it('drops long itineraries, long layovers and unwanted connections', () => {
    const short = offer({ duration_minutes: 600, layovers: [{ airport: 'ORD', airport_name: null, minutes: 60 }] });
    const long = offer({ duration_minutes: 1800, layovers: [{ airport: 'ORD', airport_name: null, minutes: 60 }] });
    const longLayover = offer({ duration_minutes: 700, layovers: [{ airport: 'ORD', airport_name: null, minutes: 900 }] });

    expect(filterOffersByPreferences([short, long], { max_duration_minutes: 900 })).toEqual([short]);
    expect(filterOffersByPreferences([short, longLayover], { max_layover_minutes: 300 })).toEqual([short]);
    expect(filterOffersByPreferences([short], { layover_airports: ['ORD'] })).toEqual([short]);
    expect(filterOffersByPreferences([short], { layover_airports: ['JFK'] })).toEqual([]);
    expect(filterOffersByPreferences([short], { exclude_layover_airports: ['ORD'] })).toEqual([]);
  });

  it('filters on price, departure window and red-eyes', () => {
    const day = offer({ price: 400, departure: '09:30' });
    const night = offer({ price: 300, departure: '23:15' });
    const pricey = offer({ price: 1200, departure: '14:00' });

    expect(filterOffersByPreferences([day, pricey], { max_price: 500 })).toEqual([day]);
    expect(filterOffersByPreferences([day, night], { exclude_redeye: true })).toEqual([day]);
    expect(filterOffersByPreferences([day, night], { departure_after: '08:00', departure_before: '18:00' })).toEqual([day]);
    expect(filterOffersByPreferences([day, night], { arrival_before: '11:00' })).toEqual([]);
  });

  it('filters on baggage and aircraft type', () => {
    const withBag = offer({ extensions: { carry_on_included: true, checked_bags_included: 1 } });
    const noBag = offer({ extensions: { carry_on_included: false, checked_bags_included: 0 } });

    expect(filterOffersByPreferences([withBag, noBag], { require_checked_bag: true })).toEqual([withBag]);
    expect(filterOffersByPreferences([withBag, noBag], { require_carry_on: true })).toEqual([withBag]);
    expect(filterOffersByPreferences([withBag], { aircraft_types: ['777'] })).toEqual([withBag]);
    expect(filterOffersByPreferences([withBag], { aircraft_types: ['A380'] })).toEqual([]);
    expect(filterOffersByPreferences([withBag], { exclude_aircraft_types: ['boeing'] })).toEqual([]);
  });

  it('leaves offers untouched when no preference is set', () => {
    const offers = [offer(), offer({ price: 900 })];
    expect(filterOffersByPreferences(offers, {})).toEqual(offers);
  });
});

describe('isBasicEconomy', () => {
  it('only treats the lowest tier without a checked bag as basic economy', () => {
    expect(isBasicEconomy(offer({ fare_brand: 'Economy', extensions: { carry_on_included: false, checked_bags_included: 0 } }))).toBe(true);
    expect(isBasicEconomy(offer({ fare_brand: 'Economy', extensions: { carry_on_included: true, checked_bags_included: 1 } }))).toBe(false);
    expect(isBasicEconomy(offer({ fare_brand: 'Main Cabin', extensions: { carry_on_included: false, checked_bags_included: 0 } }))).toBe(false);
  });
});

describe('time and date helpers', () => {
  it('formats Google time and date arrays', () => {
    expect(formatTime([9, 5])).toBe('09:05');
    expect(formatTime([23, 45])).toBe('23:45');
    expect(formatTime(null)).toBe('');
    expect(formatDate([2026, 11, 18])).toBe('2026-11-18');
    expect(formatDate(undefined)).toBe('');
  });

  it('maps a time to minutes of day and applies windows', () => {
    expect(minutesOfDay('00:00')).toBe(0);
    expect(minutesOfDay('23:59')).toBe(1439);
    expect(minutesOfDay('')).toBeNull();
    expect(withinWindow('12:00', '08:00', '18:00')).toBe(true);
    expect(withinWindow('19:00', '08:00', '18:00')).toBe(false);
    expect(withinWindow('12:00', undefined, undefined)).toBe(true);
  });

  it('shifts and samples dates', () => {
    expect(addDays('2026-11-18', 7)).toBe('2026-11-25');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(sampleDates(['a', 'b', 'c', 'd', 'e'], 3)).toEqual(['a', 'c', 'e']);
    expect(sampleDates(['a', 'b'], 5)).toEqual(['a', 'b']);
  });

  it('enumerates a grid window, honouring weekdays and the lookup cap', () => {
    const dates = enumerateGridDates({
      origin: 'SFO',
      destination: 'NRT',
      start_date: '2026-11-02',
      end_date: '2026-11-08',
      max_dates: 10,
    } as never);
    expect(dates.truncated).toBe(false);
    expect(dates.dates).toEqual([
      '2026-11-02',
      '2026-11-03',
      '2026-11-04',
      '2026-11-05',
      '2026-11-06',
      '2026-11-07',
      '2026-11-08',
    ]);

    const weekends = enumerateGridDates({
      origin: 'SFO',
      destination: 'NRT',
      start_date: '2026-11-02',
      end_date: '2026-11-08',
      weekdays: ['saturday', 'sunday'],
      max_dates: 10,
    } as never);
    expect(weekends.dates).toEqual(['2026-11-07', '2026-11-08']);

    const capped = enumerateGridDates({
      origin: 'SFO',
      destination: 'NRT',
      start_date: '2026-11-02',
      end_date: '2026-11-30',
      max_dates: 3,
    } as never);
    expect(capped.dates).toHaveLength(3);
    expect(capped.truncated).toBe(true);
  });
});

describe('parsePriceHistory', () => {
  it('reads Google date/price pairs and skips junk', () => {
    const ds1 = [null, null, null, null, null, [null, null, null, null, null, null, null, null, null, null, [[[Date.UTC(2026, 10, 18), 512], [Date.UTC(2026, 10, 19), 480], ['x', 1]]]]];
    expect(parsePriceHistory(ds1)).toEqual([
      { date: '2026-11-18', price: 512 },
      { date: '2026-11-19', price: 480 },
    ]);
    expect(parsePriceHistory(null)).toEqual([]);
  });
});

describe('filterByStops', () => {
  it('keeps nonstop and one-stop itineraries for the "1" setting', () => {
    const nonstop = offer({ stops: 0 });
    const oneStop = offer({ stops: 1 });
    const twoStops = offer({ stops: 2 });
    expect(filterByStops([nonstop, oneStop, twoStops], 'any')).toHaveLength(3);
    expect(filterByStops([nonstop, oneStop, twoStops], 'nonstop')).toEqual([nonstop]);
    expect(filterByStops([nonstop, oneStop, twoStops], '1')).toEqual([nonstop, oneStop]);
    expect(filterByStops([nonstop, oneStop, twoStops], '2')).toEqual([nonstop, oneStop, twoStops]);
  });
});

describe('detectBlock', () => {
  it('flags Google interstitials but not normal pages', () => {
    expect(detectBlock('<html>our systems have detected unusual traffic</html>')).toMatch(/unusual traffic/);
    expect(detectBlock("<html>Please show you&#39;re not a robot</html>")).toMatch(/captcha/);
    expect(detectBlock('x'.repeat(100_000) + '/sorry/index')).toMatch(/rate-limit/);
    expect(detectBlock('<html>' + 'x'.repeat(100_000) + '</html>')).toBeNull();
  });
});

describe('rankAnywhereDestinations', () => {
  const entries = [
    { destination: 'OGG', price: 252, duration_minutes: 700 } as never,
    { destination: 'HNL', price: 183, duration_minutes: 525 } as never,
    { destination: 'KOA', price: null, duration_minutes: 400 } as never,
  ];

  it('orders by price with unpriced destinations last', () => {
    expect(rankAnywhereDestinations(entries, 'price').map((entry) => entry.destination)).toEqual(['HNL', 'OGG', 'KOA']);
  });

  it('orders by duration when asked', () => {
    expect(rankAnywhereDestinations(entries, 'duration').map((entry) => entry.destination)).toEqual(['KOA', 'HNL', 'OGG']);
  });

  it('does not mutate its input', () => {
    const input = [...entries];
    rankAnywhereDestinations(input, 'price');
    expect(input.map((entry) => entry.destination)).toEqual(['OGG', 'HNL', 'KOA']);
  });
});

describe('tool registry', () => {
  it('exposes every google-flights tool', () => {
    expect(getAllToolNames()).toEqual([
      'search_flights',
      'search_multi_city',
      'get_date_grid',
      'get_round_trip_grid',
      'search_anywhere',
      'find_airport_code',
    ]);
  });
});

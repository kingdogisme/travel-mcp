import protobuf from 'protobufjs';
import { extractDs1, buildTfsParam } from './servers/google-flights/shared/build/flights-client/flights-client.js';

const H = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36', 'Accept-Language': 'en-US,en;q=0.5' };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let last = 0;
async function fetchPage(url) {
  const wait = Math.max(0, 2000 + Math.random() * 1200 - (Date.now() - last));
  if (wait > 0) await sleep(wait);
  last = Date.now();
  const res = await fetch(url, { headers: H });
  return { status: res.status, html: await res.text() };
}
const urlFor = (tfs, extra = '') => `https://www.google.com/travel/flights?tfs=${tfs}&hl=en&tfu=EgQIABABIgA&curr=USD${extra}`;

// ---------- 1. emissions + layovers across many offers ----------
{
  const tfs = await buildTfsParam({ origin: 'SFO', destination: 'NRT', departureDate: '2026-11-15', tripType: 'one_way', seatClass: 'economy', adults: 1, children: 0, infantsInSeat: 0, infantsOnLap: 0 });
  const { status, html } = await fetchPage(urlFor(tfs));
  const ds1 = extractDs1(html);
  console.log('=== EMISSIONS PROBE (one-way SFO-NRT) status', status, '===');
  const offers = [...(ds1?.[3]?.[0] ?? []), ...(ds1?.[2]?.[0] ?? [])];
  console.log('offers:', offers.length);
  for (const o of offers.slice(0, 10)) {
    const d = o[0];
    const stops = (d[2]?.length ?? 1) - 1;
    console.log(`  ${d[0]} price=${o[1]?.[0]?.[1]} stops=${stops} dur=${d[9]} d22=${JSON.stringify(d[22])} d13=${JSON.stringify(d[13]?.[0]?.[0])}`);
  }
  const idx = html.search(/typical|usual|Prices are|cheaper than|CO2|emissions/gi);
  console.log('html insight snippet:', idx >= 0 ? html.slice(idx - 120, idx + 260).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ') : 'none');
  console.log('ds1[5][1..5]:', JSON.stringify(ds1?.[5]?.slice(1, 6)));
}
await sleep(2500);

// ---------- 2. multi-airport encoding ----------
{
  const root = new protobuf.Root();
  const Airport = new protobuf.Type('Airport').add(new protobuf.Field('airport', 2, 'string'));
  const FlightData = new protobuf.Type('FlightData').add(new protobuf.Field('date', 2, 'string')).add(new protobuf.Field('maxStops', 9, 'int32', 'optional')).add(new protobuf.Field('fromFlight', 13, 'Airport', 'repeated')).add(new protobuf.Field('toFlight', 14, 'Airport', 'repeated'));
  const Seat = new protobuf.Enum('Seat', { UNKNOWN_SEAT: 0, ECONOMY: 1, PREMIUM_ECONOMY: 2, BUSINESS: 3, FIRST: 4 });
  const Trip = new protobuf.Enum('Trip', { UNKNOWN_TRIP: 0, ROUND_TRIP: 1, ONE_WAY: 2, MULTI_CITY: 3 });
  const Passenger = new protobuf.Enum('Passenger', { UNKNOWN_PASSENGER: 0, ADULT: 1, CHILD: 2, INFANT_IN_SEAT: 3, INFANT_ON_LAP: 4 });
  const Info = new protobuf.Type('Info').add(new protobuf.Field('seat', 1, 'Seat')).add(new protobuf.Field('data', 3, 'FlightData', 'repeated')).add(new protobuf.Field('passengers', 6, 'Passenger', 'repeated')).add(new protobuf.Field('trip', 19, 'Trip'));
  [Airport, FlightData, Seat, Trip, Passenger, Info].forEach(t => root.add(t));
  const enc = (obj) => Buffer.from(Info.encode(Info.create(obj)).finish()).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  const variants = {
    'multiAirport-repeated13': enc({ data: [{ date: '2026-11-15', fromFlight: [{ airport: 'SFO' }, { airport: 'OAK' }], toFlight: [{ airport: 'NRT' }] }], seat: 1, passengers: [1], trip: 2 }),
    'multiAirport-commaString': enc({ data: [{ date: '2026-11-15', fromFlight: [{ airport: 'SFO,OAK' }], toFlight: [{ airport: 'NRT' }] }], seat: 1, passengers: [1], trip: 2 }),
    'multiCity-2legs': enc({ data: [{ date: '2026-11-15', fromFlight: [{ airport: 'SFO' }], toFlight: [{ airport: 'NRT' }] }, { date: '2026-11-20', fromFlight: [{ airport: 'NRT' }], toFlight: [{ airport: 'ICN' }] }], seat: 1, passengers: [1], trip: 3 }),
  };
  for (const [name, tfs] of Object.entries(variants)) {
    const { status, html } = await fetchPage(urlFor(tfs));
    const ds1 = extractDs1(html);
    const offers = [...(ds1?.[3]?.[0] ?? []), ...(ds1?.[2]?.[0] ?? [])];
    const codes = new Set();
    for (const o of offers.slice(0, 30)) { const d = o[0]; codes.add(d[3]); for (const l of (d[2] ?? [])) codes.add(l?.[3]); }
    console.log(`=== ${name}: status=${status} offers=${offers.length} airportsSeen=${[...codes].filter(Boolean).slice(0, 12).join(',')} destName=${JSON.stringify(ds1?.[5]?.[12])}`);
    await sleep(2500);
  }
}

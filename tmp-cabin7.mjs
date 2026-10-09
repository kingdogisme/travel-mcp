import { extractDs1, parseFlightOffers, buildTfsParam } from './servers/google-flights/shared/build/flights-client/flights-client.js';
const H = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
  Cookie: 'CONSENT=PENDING+987; SOCS=CAESHAgBEhJnd3NfMjAyMzA4MTAtMF9SQzIaAmRlIAEaBgiAo_CmBg',
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let last = 0;
async function fetchUrl(url) {
  const wait = Math.max(0, 2200 + Math.random() * 800 - (Date.now() - last));
  if (wait > 0) await sleep(wait);
  last = Date.now();
  const res = await fetch(url, { headers: H });
  return { status: res.status, html: await res.text() };
}
const q = 'Flights from SFO to NRT on 2026-11-15 business class';
const { status, html } = await fetchUrl(`https://www.google.com/travel/flights?q=${encodeURIComponent(q)}&hl=en&curr=USD`);
const offers = parseFlightOffers(extractDs1(html), 'USD');
console.log('q-search status', status, 'offers', offers.length);
for (const o of offers.slice(0, 3)) {
  console.log(`  ${o.price} ${o.airline} ${o.departure}->${o.arrival} ${o.departure_date} stops=${o.stops} segs=${o.segments.map(s=>`${s.origin}->${s.destination} ${s.departure_date}`).join('|')} brand=${o.fare_brand}`);
}
// round trip NL
const q2 = 'Flights from SFO to NRT departing 2026-11-15 returning 2026-11-22 business class';
const r2 = await fetchUrl(`https://www.google.com/travel/flights?q=${encodeURIComponent(q2)}&hl=en&curr=USD`);
const o2 = parseFlightOffers(extractDs1(r2.html), 'USD');
console.log('q round-trip status', r2.status, 'offers', o2.length, 'cheapest', o2[0]?.price, 'brand', o2[0]?.fare_brand, 'dates', o2[0]?.segments.map(s=>s.departure_date).join(','));
// 2 passengers + nonstop
const q3 = 'Nonstop flights from SFO to NRT on 2026-11-15 for 2 passengers business class';
const r3 = await fetchUrl(`https://www.google.com/travel/flights?q=${encodeURIComponent(q3)}&hl=en&curr=USD`);
const o3 = parseFlightOffers(extractDs1(r3.html), 'USD');
console.log('q nonstop/2pax status', r3.status, 'offers', o3.length, 'cheapest', o3[0]?.price, 'stops', o3[0]?.stops);

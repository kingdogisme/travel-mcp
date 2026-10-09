import { extractDs1, parseFlightOffers } from './servers/google-flights/shared/build/flights-client/flights-client.js';
const H = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
  Cookie: 'CONSENT=PENDING+987; SOCS=CAESHAgBEhJnd3NfMjAyMzA4MTAtMF9SQzIaAmRlIAEaBgiAo_CmBg',
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let last = 0;
async function run(label, q) {
  const wait = Math.max(0, 2200 + Math.random() * 800 - (Date.now() - last));
  if (wait > 0) await sleep(wait);
  last = Date.now();
  const url = `https://www.google.com/travel/flights?q=${encodeURIComponent(q)}&hl=en&curr=USD`;
  const res = await fetch(url, { headers: H });
  const html = await res.text();
  const offers = parseFlightOffers(extractDs1(html), 'USD');
  console.log(`${label}: status=${res.status} len=${html.length} offers=${offers.length} cheapest=${offers[0]?.price}/${offers[0]?.fare_brand}`);
}
await run('q economy', 'Flights from SFO to NRT on 2026-11-15 economy');
await run('q business', 'Flights from SFO to NRT on 2026-11-15 business class');
await run('q first', 'Flights from SFO to NRT on 2026-11-15 first class');

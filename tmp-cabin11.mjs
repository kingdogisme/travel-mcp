import { readFileSync } from 'node:fs';
import { extractDs1, parseFlightOffers } from './servers/google-flights/shared/build/flights-client/flights-client.js';
const H = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
  Cookie: 'CONSENT=PENDING+987; SOCS=CAESHAgBEhJnd3NfMjAyMzA4MTAtMF9SQzIaAmRlIAEaBgiAo_CmBg',
};
const saved = readFileSync('/tmp/gf-q-biz.html', 'utf8');
const off = parseFlightOffers(extractDs1(saved), 'USD');
console.log('saved q-biz: offers', off.length, 'emissions', JSON.stringify(off[0]?.emissions), 'layovers', JSON.stringify(off[0]?.layovers), 'ext', JSON.stringify(off[0]?.extensions));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let last = 0;
async function run(label, q) {
  const wait = Math.max(0, 2200 + Math.random() * 800 - (Date.now() - last));
  if (wait > 0) await sleep(wait);
  last = Date.now();
  const res = await fetch(`https://www.google.com/travel/flights?q=${encodeURIComponent(q)}&hl=en&curr=USD`, { headers: H });
  const html = await res.text();
  const offers = parseFlightOffers(extractDs1(html), 'USD');
  console.log(`${label}: offers=${offers.length} cheapest=${offers[0]?.price}/${offers[0]?.fare_brand}`);
}
await run('premium economy class', 'Flights from SFO to NRT on 2026-11-15 premium economy class');
await run('premium class', 'Flights from SFO to NRT on 2026-11-15 premium class');

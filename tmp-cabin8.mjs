import { extractDs1, parseFlightOffers, buildTfsParam } from './servers/google-flights/shared/build/flights-client/flights-client.js';
const H = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
  Cookie: 'CONSENT=PENDING+987; SOCS=CAESHAgBEhJnd3NfMjAyMzA4MTAtMF9SQzIaAmRlIAEaBgiAo_CmBg',
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let last = 0;
async function run(label, url) {
  const wait = Math.max(0, 2200 + Math.random() * 800 - (Date.now() - last));
  if (wait > 0) await sleep(wait);
  last = Date.now();
  const res = await fetch(url, { headers: H });
  const html = await res.text();
  const offers = parseFlightOffers(extractDs1(html), 'USD');
  console.log(`${label}: status=${res.status} len=${html.length} offers=${offers.length} cheapest=${offers[0]?.price}/${offers[0]?.fare_brand} 2nd=${offers[1]?.price}`);
}
const tfsEco = await buildTfsParam({ origin: 'SFO', destination: 'NRT', departureDate: '2026-11-15', tripType: 'one_way', seatClass: 'economy', adults: 1, children: 0, infantsInSeat: 0, infantsOnLap: 0 });
const tfsBiz = await buildTfsParam({ origin: 'SFO', destination: 'NRT', departureDate: '2026-11-15', tripType: 'one_way', seatClass: 'business', adults: 1, children: 0, infantsInSeat: 0, infantsOnLap: 0 });
const base = 'https://www.google.com/travel/flights';
await run('tfsEco + q=business class', `${base}?tfs=${tfsEco}&q=${encodeURIComponent('business class')}&hl=en&curr=USD`);
await run('tfsEco + q=full biz', `${base}?tfs=${tfsEco}&q=${encodeURIComponent('Flights from SFO to NRT on 2026-11-15 business class')}&hl=en&curr=USD`);
await run('tfsBiz + q=business class', `${base}?tfs=${tfsBiz}&q=${encodeURIComponent('business class')}&hl=en&curr=USD`);

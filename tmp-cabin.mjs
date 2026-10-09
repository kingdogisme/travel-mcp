import { extractDs1, buildTfsParam, parseFlightOffers } from './servers/google-flights/shared/build/flights-client/flights-client.js';

const H = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
  Cookie: 'CONSENT=PENDING+987; SOCS=CAESHAgBEhJnd3NfMjAyMzA4MTAtMF9SQzIaAmRlIAEaBgiAo_CmBg',
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let last = 0;
async function get(url) {
  const wait = Math.max(0, 2200 + Math.random() * 800 - (Date.now() - last));
  if (wait > 0) await sleep(wait);
  last = Date.now();
  const res = await fetch(url, { headers: H });
  return { status: res.status, html: await res.text() };
}

async function probe(label, seatClass, tfu) {
  const tfs = await buildTfsParam({ origin: 'SFO', destination: 'NRT', departureDate: '2026-11-15', tripType: 'one_way', seatClass, adults: 1, children: 0, infantsInSeat: 0, infantsOnLap: 0 });
  const url = `https://www.google.com/travel/flights?tfs=${tfs}&hl=en${tfu ? `&tfu=${tfu}` : ''}&curr=USD`;
  const { status, html } = await get(url);
  const ds1 = extractDs1(html);
  const offers = parseFlightOffers(ds1, 'USD');
  const cheapest = offers[0];
  const cabinHits = (html.match(/Business|Premium economy|First class/g) || []).length;
  console.log(`${label}: status=${status} len=${html.length} offers=${offers.length} cheapest=${cheapest?.price} brand=${cheapest?.fare_brand} cabinWords=${cabinHits} tfs=${tfs.slice(0,12)}`);
  return html;
}

await probe('economy + tfu', 'economy', 'EgQIABABIgA');
await probe('business + tfu', 'business', 'EgQIABABIgA');
await probe('business no-tfu', 'business', '');

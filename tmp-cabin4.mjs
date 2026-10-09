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
const b64url = (bytes) => Buffer.from(bytes).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
// tfu = 0x12 0x04 [08 00 10 XX] 0x22 0x00
const tfuFor = (v) => b64url([0x12,0x04,0x08,0x00,0x10,v,0x22,0x00]);
async function run(label, seatClass, tfu) {
  const tfs = await buildTfsParam({ origin: 'SFO', destination: 'NRT', departureDate: '2026-11-15', tripType: 'one_way', seatClass, adults: 1, children: 0, infantsInSeat: 0, infantsOnLap: 0 });
  const { status, html } = await get(`https://www.google.com/travel/flights?tfs=${tfs}&hl=en&tfu=${tfu}&curr=USD`);
  const offers = parseFlightOffers(extractDs1(html), 'USD');
  console.log(`${label} status=${status} len=${html.length} offers=${offers.length} cheapest=${offers[0]?.price}/${offers[0]?.fare_brand} tfu=${tfu}`);
}
console.log('tfu values:', [1,2,3,4].map(v=>`${v}:${tfuFor(v)}`).join(' '));
await run('tfs=biz tfu=3', 'business', tfuFor(3));
await run('tfs=eco tfu=3', 'economy', tfuFor(3));
await run('tfs=biz tfu=1', 'business', tfuFor(1));

// Read-only Google review-link canary. Network success does NOT prove
// bookability, final party price or provider checkout. Never log URL tokens.
import {
  buildExactRoundTripReviewLink,
  buildMultiCityResearchLink,
} from '../servers/google-flights/shared/build/flights-client/review-links.js';

const mk = (origin, destination, date, number, arrivalDate=date) => ({
  origin, destination, departure_date:date, arrival_date:arrivalDate,
  flight_number:number, airline_code:number.slice(0,2),
});
const out = [
  mk('SAN','EWR','2026-11-20','UA327'),
  mk('EWR','CDG','2026-11-20','UA54','2026-11-21'),
];
const back = [
  mk('CDG','ORD','2026-11-29','UA986'),
  mk('ORD','SAN','2026-11-29','UA2472'),
];

const inputs = [
  {name:'exact_round_trip_review',url:buildExactRoundTripReviewLink({
    origin:'SAN',destination:'CDG',outbound:out,inbound:back,
    departure_date:'2026-11-20',return_date:'2026-11-29',
    adults:2,children:0,seat_class:'economy',currency:'USD',
  })},
  {name:'multicity_ui_research',url:buildMultiCityResearchLink({
    legs:[
      {origin:'SAN',destination:'CDG',date:'2026-11-20'},
      {origin:'FCO',destination:'SAN',date:'2026-11-29'},
    ],
    adults:2,children:0,infants_in_seat:0,infants_on_lap:0,
    seat_class:'economy',currency:'USD',
  })},
];

for (const input of inputs) {
  const u=new URL(input.url);
  if(u.hostname!=='www.google.com'||!u.searchParams.has('tfs'))
    throw new Error('Unexpected Google link destination');
  let status='not_fetched', finalPath=null, ds1=false, flightIdentityVisible=false;
  try {
    const r=await fetch(input.url,{redirect:'follow',signal:AbortSignal.timeout(12000),
      headers:{'user-agent':'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36','accept-language':'en-US,en;q=0.9'}});
    status=String(r.status);
    finalPath=new URL(r.url).pathname;
    const body=await r.text();
    ds1=body.includes('ds:1');
    flightIdentityVisible=body.includes('UA327')&&body.includes('UA54');
    if(!r.ok||!new URL(r.url).hostname.endsWith('.google.com'))
      process.exitCode=1;
  } catch(e){status='network_error:'+String(e?.message??e).slice(0,85);process.exitCode=1;}
  console.log('REVIEW_LINK_CANARY',JSON.stringify({
    name:input.name,encoded_page_kind:u.pathname,
    http_status:status,final_path:finalPath,
    inline_ds1_present:ds1,flight_identity_in_raw_html:flightIdentityVisible,
    conclusion:'UNVERIFIED_UI_AND_CHECKOUT: successful HTTP retrieval is not a joint-fare quote or a completed booking',
  }));
}

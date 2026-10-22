// Core server exports
export { registerResources } from './resources.js';
export { createRegisterTools, getAllToolNames } from './tools.js';
export {
  createMCPServer,
  GoogleFlightsClient,
  type CreateMCPServerOptions,
  type FlightsClientFactory,
  type IFlightsClient,
} from './server.js';

// Flights client exports
export {
  searchFlights,
  getDateGrid,
  findAirportCode,
  buildTfsParam,
  searchMultiCity,
  getRoundTripGrid,
  searchAnywhere,
} from './flights-client/flights-client.js';
export { searchRoundTripPairs, isMatchingReturn } from './flights-client/round-trip-pairs.js';
export { buildExactRoundTripReviewLink, buildMultiCityResearchLink } from './flights-client/review-links.js';
export { buildSelectionTfu, fetchSelectedReturnOffers } from './flights-client/flights-client.js';
export type {
  FlightOffer,
  FlightSegment,
  FlightExtensions,
  DateGridEntry,
  DateGridResult,
  AirportResult,
  SearchFlightsOptions,
  SearchFlightsResult,
  CashQuoteStatus,
  CashPriceBasis,
  CashPriceProvenance,
  GetDateGridOptions,
  SeatClass,
  TripType,
  MultiCityLeg,
  MultiCityLegResult,
  MultiCityResult,
  SearchMultiCityOptions,
  RoundTripPairsOptions,
  RoundTripPairsResult,
  SelectedRoundTripPair,
  RoundTripGridOptions,
  RoundTripGridResult,
  RoundTripGridEntry,
  SearchAnywhereOptions,
  SearchAnywhereResult,
  AnywhereDestination,
} from './flights-client/types.js';

// Logging exports
export { logServerStart, logError, logWarning, logInfo, logDebug } from './logging.js';

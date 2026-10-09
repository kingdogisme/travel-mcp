// Core server exports
export { registerResources } from './resources.js';
export { createRegisterTools, type ToolGroup, parseEnabledToolGroups } from './tools.js';
export {
  createMCPServer,
  PointsYeahClient,
  defaultClientFactory,
  type CreateMCPServerOptions,
  type ClientFactory,
  type IPointsYeahClient,
} from './server.js';

// Flight search types
export type {
  FlightSearchParams,
  FlightResult,
  FlightRoute,
  FlightPayment,
  FlightSegment,
  FlightSearchResults,
  TransferOption,
  TransferBonus,
  TransferBonusSearchResult,
  FindTransferBonusesParams,
  AwardDateOption,
  CheapestAwardDatesResult,
  FindCheapestAwardDatesParams,
} from './types.js';
export {
  FlightSearchParamsSchema,
  FindTransferBonusesParamsSchema,
  FindCheapestAwardDatesParamsSchema,
} from './types.js';
export { applyResultFilters } from './server.js';

// State management exports
export {
  getServerState,
  setAuthenticated,
  setRefreshToken,
  clearRefreshToken,
  resetState,
} from './state.js';

// Logging exports
export { logServerStart, logError, logWarning, logDebug } from './logging.js';

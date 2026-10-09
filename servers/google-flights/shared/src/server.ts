import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { registerResources } from './resources.js';
import { createRegisterTools } from './tools.js';
import {
  searchFlights,
  getDateGrid,
  findAirportCode,
  searchMultiCity,
  getRoundTripGrid,
  searchAnywhere,
} from './flights-client/flights-client.js';
import type {
  SearchFlightsOptions,
  SearchFlightsResult,
  GetDateGridOptions,
  DateGridResult,
  AirportResult,
  SearchMultiCityOptions,
  MultiCityResult,
  RoundTripGridOptions,
  RoundTripGridResult,
  SearchAnywhereOptions,
  SearchAnywhereResult,
} from './flights-client/types.js';

export interface IFlightsClient {
  searchFlights(options: SearchFlightsOptions): Promise<SearchFlightsResult>;
  getDateGrid(options: GetDateGridOptions): Promise<DateGridResult>;
  findAirportCode(query: string): Promise<AirportResult[]>;
  searchMultiCity(options: SearchMultiCityOptions): Promise<MultiCityResult>;
  getRoundTripGrid(options: RoundTripGridOptions): Promise<RoundTripGridResult>;
  searchAnywhere(options: SearchAnywhereOptions): Promise<SearchAnywhereResult>;
}

export type FlightsClientFactory = () => IFlightsClient;

export class GoogleFlightsClient implements IFlightsClient {
  async searchFlights(options: SearchFlightsOptions): Promise<SearchFlightsResult> {
    return searchFlights(options);
  }

  async getDateGrid(options: GetDateGridOptions): Promise<DateGridResult> {
    return getDateGrid(options);
  }

  async findAirportCode(query: string): Promise<AirportResult[]> {
    return findAirportCode(query);
  }

  async searchMultiCity(options: SearchMultiCityOptions): Promise<MultiCityResult> {
    return searchMultiCity(options);
  }

  async getRoundTripGrid(options: RoundTripGridOptions): Promise<RoundTripGridResult> {
    return getRoundTripGrid(options);
  }

  async searchAnywhere(options: SearchAnywhereOptions): Promise<SearchAnywhereResult> {
    return searchAnywhere(options);
  }
}

export interface CreateMCPServerOptions {
  version: string;
}

export function createMCPServer(options: CreateMCPServerOptions) {
  const server = new Server(
    {
      name: 'google-flights-mcp-server',
      version: options.version,
    },
    {
      capabilities: {
        resources: {},
        tools: {},
      },
    }
  );

  const registerHandlers = async (server: Server, clientFactory?: FlightsClientFactory) => {
    const factory = clientFactory || (() => new GoogleFlightsClient());

    registerResources(server);
    const registerTools = createRegisterTools(factory);
    registerTools(server);
  };

  return { server, registerHandlers };
}

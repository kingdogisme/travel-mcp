import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { GoogleFlightsClient } from 'google-flights-mcp-server-shared';
import type { IFlightsClient } from 'google-flights-mcp-server-shared';
import { defaultClientFactory as defaultPointsYeahClientFactory } from 'pointsyeah-mcp-server-shared';
import type { IPointsYeahClient } from 'pointsyeah-mcp-server-shared';
import { registerResources } from './resources.js';
import { createRegisterTools } from './tools.js';
import { TripCompareClient } from './compare.js';

export interface ITripCompareClient {
  comparePointsVsCash(options: import('./types.js').CompareOptions): Promise<import('./types.js').CompareResult>;
}

export type TripCompareClientFactory = () => TripCompareClient;

export interface CreateMCPServerOptions {
  version: string;
}

export function createMCPServer(options: CreateMCPServerOptions) {
  const server = new Server(
    {
      name: 'trip-compare-mcp-server',
      version: options.version,
    },
    {
      capabilities: {
        resources: {},
        tools: {},
      },
    }
  );

  const registerHandlers = async (
    server: Server,
    clientFactory?: TripCompareClientFactory
  ) => {
    const factory =
      clientFactory ??
      (() =>
        new TripCompareClient({
          flights: new GoogleFlightsClient() as IFlightsClient,
          pointsYeah: defaultPointsYeahClientFactory() as IPointsYeahClient,
        }));

    registerResources(server, options.version);
    const registerTools = createRegisterTools(factory);
    registerTools(server);
  };

  return { server, registerHandlers };
}

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { getAllToolNames } from './tools.js';

export function registerResources(server: Server, version: string) {
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [
      {
        uri: 'trip-compare://config',
        name: 'Server Configuration',
        description: 'Current server configuration and available tools.',
        mimeType: 'application/json',
      },
    ],
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;
    if (uri === 'trip-compare://config') {
      return {
        contents: [
          {
            uri,
            mimeType: 'application/json',
            text: JSON.stringify(
              {
                server: { name: 'trip-compare-mcp-server', version, transport: 'stdio' },
                availableTools: getAllToolNames(),
                notes: [
                  'Combines a live PointsYeah award search with a Google Flights cash search.',
                  'Award searches launch a real browser, so expect 30-90 seconds per comparison.',
                ],
              },
              null,
              2
            ),
          },
        ],
      };
    }
    throw new Error(`Resource not found: ${uri}`);
  });
}

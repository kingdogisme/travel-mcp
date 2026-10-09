import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { TripCompareClientFactory } from './server.js';
import { comparePointsVsCashTool } from './tools/compare-points-vs-cash.js';

interface Tool {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
  handler: (args: unknown) => Promise<{
    content: Array<{ type: string; text: string }>;
    isError?: boolean;
  }>;
}

type ToolFactory = (server: Server, clientFactory: TripCompareClientFactory) => Tool;

const ALL_TOOLS: ToolFactory[] = [comparePointsVsCashTool];

export function getAllToolNames(): string[] {
  const mockServer = { setRequestHandler: () => {} } as unknown as Server;
  const mockFactory = (() => {}) as unknown as TripCompareClientFactory;
  return ALL_TOOLS.map((factory) => factory(mockServer, mockFactory).name);
}

export function createRegisterTools(clientFactory: TripCompareClientFactory) {
  return (server: Server) => {
    const tools = ALL_TOOLS.map((factory) => factory(server, clientFactory));

    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      })),
    }));

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      const tool = tools.find((t) => t.name === name);
      if (!tool) throw new Error(`Unknown tool: ${name}`);
      return await tool.handler(args);
    });
  };
}

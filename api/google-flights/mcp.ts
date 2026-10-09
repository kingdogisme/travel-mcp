import type { IncomingMessage, ServerResponse } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMCPServer } from '../../servers/google-flights/shared/build/index.js';

const VERSION = '0.2.6';

type NodeReq = IncomingMessage & { body?: unknown };

export default async function handler(req: NodeReq, res: ServerResponse) {
  const { server, registerHandlers } = createMCPServer({ version: VERSION });
  await registerHandlers(server);

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);

  try {
    await transport.handleRequest(req as never, res as never, req.body);
  } finally {
    await server.close().catch(() => {});
  }
}

import type { IncomingMessage, ServerResponse } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMCPServer } from '../../servers/google-flights/shared/build/index.js';

const VERSION = '0.2.6';

type NodeReq = IncomingMessage & { body?: unknown };

export default async function handler(req: NodeReq, res: ServerResponse) {
  // Stateless deployment: there are no server-initiated messages, so the GET
  // SSE stream is not offered. The spec asks for 405 in that case.
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('allow', 'POST');
    res.setHeader('content-type', 'application/json');
    res.end(
      JSON.stringify({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Method Not Allowed. Use POST.' },
        id: null,
      })
    );
    return;
  }

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

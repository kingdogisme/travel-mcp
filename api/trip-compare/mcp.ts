import type { IncomingMessage, ServerResponse } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  createMCPServer,
  TripCompareClient,
  setRefreshToken,
  setAuthenticated,
} from '../../servers/trip-compare/shared/build/index.js';
import { GoogleFlightsClient } from '../../servers/google-flights/shared/build/index.js';
import { PointsYeahClient } from '../../servers/pointsyeah/shared/build/index.js';

const VERSION = '0.1.0';

type NodeReq = IncomingMessage & { body?: unknown };

// The award half of a comparison needs a real browser (PointsYeah encrypts its
// search payload client-side). We launch a serverless Chromium build lazily on
// the first search; the cash half is a plain polite HTTP fetch.
function serverlessPointsYeahClient() {
  return new PointsYeahClient({
    launchBrowser: async () => {
      const sparticuz = (await import('@sparticuz/chromium')).default;
      const { chromium } = await import('playwright-core');
      const executablePath = await sparticuz.executablePath();
      const browser = await chromium.launch({
        args: sparticuz.args,
        executablePath,
        headless: true,
      });
      const context = await browser.newContext();
      return {
        addCookies: (cookies: unknown) => context.addCookies(cookies as never),
        newPage: async () => {
          const page = await context.newPage();
          return {
            goto: (url: string, options?: unknown) =>
              page.goto(url, options as never).then(() => {}),
            waitForResponse: (
              predicate: (r: { url: () => string; json: () => Promise<unknown> }) => boolean,
              options?: unknown
            ) =>
              page
                .waitForResponse((r) => predicate(r as never), options as never)
                .then((r) => ({ url: () => r.url(), json: () => r.json() })),
            close: () => page.close(),
          };
        },
        close: async () => {
          await context.close();
          await browser.close();
        },
      };
    },
  });
}

export default async function handler(req: NodeReq, res: ServerResponse) {
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

  const envToken = process.env.POINTSYEAH_REFRESH_TOKEN;
  if (envToken) {
    setRefreshToken(envToken);
    setAuthenticated(true);
  }

  const { server, registerHandlers } = createMCPServer({ version: VERSION });
  await registerHandlers(server, () => {
    const flights = new GoogleFlightsClient();
    const pointsYeah = serverlessPointsYeahClient();
    return new TripCompareClient({ flights, pointsYeah });
  });

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

#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMCPServer } from '../shared/index.js';
import { setRefreshToken, setAuthenticated } from '../shared/index.js';
import { logServerStart, logError, logWarning } from '../shared/logging.js';

const VERSION = '0.1.0';

async function initializeAuth(): Promise<void> {
  const envToken = process.env.POINTSYEAH_REFRESH_TOKEN;
  if (!envToken) {
    logWarning(
      'config',
      'POINTSYEAH_REFRESH_TOKEN not set. The award half of the comparison will fail until it is provided.'
    );
    return;
  }
  setRefreshToken(envToken);
  setAuthenticated(true);
}

async function main() {
  await initializeAuth();

  const { server, registerHandlers } = createMCPServer({ version: VERSION });
  await registerHandlers(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  logServerStart('trip-compare-mcp-server');
}

main().catch((error) => {
  logError('main', error);
  process.exit(1);
});

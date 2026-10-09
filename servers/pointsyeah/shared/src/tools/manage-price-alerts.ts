import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { IPointsYeahClient } from '../server.js';
import { ManagePriceAlertsParamsSchema } from '../types.js';

const DESCRIPTION = `Manage the signed-in user's PointsYeah flight price alerts.

PointsYeah watches a one-way route (or a flexible date window) and emails the
user when an award matching the filters shows up. The account is limited to a
handful of active alerts, so this tool also reports the current usage.

**Actions:**
- \`list\` (default): show the saved alerts, plus how many of the allowance are used.
- \`create\`: add an alert. Requires origin, destination, departDate and maxMiles.
- \`delete\`: remove an alert by its alert_id (ids come from \`list\`).

**Filters available when creating:** cabins, transferable banks, airline
programs, max miles, max cash taxes, max connections, max duration, specific
flight numbers, and airlines to exclude.

Note: PointsYeah caps how many alerts can be created in a short window. If a
create fails with "Exceed Alert Limit", wait a little before trying again.`;

export function managePriceAlertsTool(_server: Server, clientFactory: () => IPointsYeahClient) {
  return {
    name: 'manage_price_alerts',
    description: DESCRIPTION,
    inputSchema: {
      type: 'object' as const,
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'create', 'delete'],
          description: 'Operation to perform (default: "list")',
        },
        alert_id: {
          type: 'string',
          description: 'Alert id to remove (required when action="delete")',
        },
        origin: { type: 'string', description: 'Origin IATA code or city name, e.g. "SFO" or "Tokyo" (create)' },
        destination: { type: 'string', description: 'Destination IATA code or city name, e.g. "NRT" or "Tokyo" (create)' },
        departDate: { type: 'string', description: 'Departure date YYYY-MM-DD (create)' },
        departDateTo: {
          type: 'string',
          description: 'Optional last date of a flexible window (defaults to departDate)',
        },
        cabins: {
          type: 'array',
          items: { type: 'string', enum: ['Economy', 'Premium Economy', 'Business', 'First'] },
          description: 'Cabins to watch (default: all four)',
        },
        banks: {
          type: 'array',
          items: { type: 'string' },
          description: 'Transferable banks to watch, e.g. ["Chase", "Amex"] (default: all)',
        },
        airlines: {
          type: 'array',
          items: { type: 'string' },
          description: 'Restrict to these airline program codes, e.g. ["NH", "JL"]',
        },
        maxMiles: {
          type: 'number',
          description: 'Max award miles per passenger (required to create)',
        },
        maxTax: { type: 'number', description: 'Max cash taxes in USD' },
        maxStops: { type: 'number', description: 'Maximum connections per route' },
        maxDurationHours: { type: 'number', description: 'Max total flight duration in hours' },
        flightNumbers: {
          type: 'array',
          items: { type: 'string' },
          description: 'Only alert on these flight numbers, e.g. ["NH7"]',
        },
        excludeAirlines: {
          type: 'array',
          items: { type: 'string' },
          description: 'Airline codes to exclude',
        },
        adults: { type: 'number', description: 'Number of adult passengers (default 1)' },
        children: { type: 'number', description: 'Number of child passengers (default 0)' },
      },
      required: [],
    },
    handler: async (args: unknown) => {
      try {
        const params = ManagePriceAlertsParamsSchema.parse(args);
        const client = clientFactory();

        if (params.action === 'list') {
          const result = await client.listPriceAlerts();
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }

        if (params.action === 'delete') {
          if (!params.alert_id) {
            return errorResult('action="delete" requires an alert_id.');
          }
          await client.deletePriceAlert(params.alert_id);
          const after = await client.listPriceAlerts();
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  { deleted: params.alert_id, remaining: after.items.length, ...after },
                  null,
                  2
                ),
              },
            ],
          };
        }

        // create
        const missing = (['origin', 'destination', 'departDate', 'maxMiles'] as const).filter(
          (key) => params[key] === undefined
        );
        if (missing.length > 0) {
          return errorResult(`action="create" requires: ${missing.join(', ')}.`);
        }
        const created = await client.createPriceAlert(params);
        return { content: [{ type: 'text', text: JSON.stringify(created, null, 2) }] };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return errorResult(`Error managing price alerts: ${message}`);
      }
    },
  };
}

function errorResult(text: string) {
  return { content: [{ type: 'text', text }], isError: true };
}

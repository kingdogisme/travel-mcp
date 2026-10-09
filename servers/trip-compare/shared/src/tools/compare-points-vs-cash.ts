import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { TripCompareClientFactory } from '../server.js';
import { CompareOptionsSchema } from '../types.js';

const DESCRIPTION = `Compare what the same trip costs in points versus cash, and say which is the better deal.

This runs two live searches in one call:
- Google Flights for the cheapest cash fares in the requested cabin
- PointsYeah for live award availability across 20+ loyalty programs

It then values each award option in cents per point — (cash fare - award taxes) / miles — and recommends points or cash. Transfer bonuses are detected automatically: each award option is valued with the live bonus PointsYeah reports for that bank-to-program pairing, and the applied bonus is shown on the option (transfer_bonus) and in the verdict. Pass transferBonusPercent to override with a specific bonus, or useTransferBonuses: false to ignore bonuses entirely.

Use this when the user asks "should I use points or pay cash?", "is this redemption worth it?", or wants to compare a specific route and date. Expect 30-90 seconds, because the award side drives a real browser.`;

export function comparePointsVsCashTool(_server: Server, clientFactory: TripCompareClientFactory) {
  return {
    name: 'compare_points_vs_cash',
    description: DESCRIPTION,
    inputSchema: {
      type: 'object' as const,
      properties: {
        origin: {
          type: 'string',
          description: 'Origin airport code (e.g. "SFO"), or several comma-separated ("SFO,OAK")',
        },
        destination: {
          type: 'string',
          description: 'Destination airport code (e.g. "NRT"), or several comma-separated',
        },
        departDate: { type: 'string', description: 'Departure date YYYY-MM-DD' },
        returnDate: { type: 'string', description: 'Return date YYYY-MM-DD (omit for one-way)' },
        departDateTo: {
          type: 'string',
          description:
            'Optional end of a flexible departure window (YYYY-MM-DD). When set, the tool first finds the cheapest cash day and the cheapest award day in the window, then compares on the cheapest cash day. Slower, since it adds a cash date grid and an award date-window search.',
        },
        cabin: {
          type: 'string',
          enum: ['Economy', 'Premium Economy', 'Business', 'First'],
          description: 'Cabin to compare (default: Business)',
        },
        adults: { type: 'number', description: 'Number of adult passengers (default: 1)' },
        maxMiles: { type: 'number', description: 'Ignore award options costing more miles than this' },
        minCentsPerPoint: {
          type: 'number',
          description: 'Minimum cents-per-point value to recommend points (default 1.5)',
        },
        transferBonusPercent: {
          type: 'number',
          description: 'Active transfer bonus percent to model, e.g. 30',
        },
        useTransferBonuses: {
          type: 'boolean',
          description:
            'Auto-detect live transfer bonuses from the award search (default true). Set false to ignore bonuses.',
        },
        pointsLimit: { type: 'number', description: 'How many award options to include (default 8)' },
        cashLimit: { type: 'number', description: 'How many cash fares to include (default 5)' },
      },
      required: ['origin', 'destination', 'departDate'],
    },
    handler: async (args: unknown) => {
      try {
        const options = CompareOptionsSchema.parse(args);
        const client = clientFactory();
        const result = await client.comparePointsVsCash(options);

        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: 'text', text: `Error comparing points vs cash: ${message}` }],
          isError: true,
        };
      }
    },
  };
}

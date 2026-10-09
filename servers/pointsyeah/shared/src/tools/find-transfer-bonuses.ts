import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { IPointsYeahClient } from '../server.js';
import { FindTransferBonusesParamsSchema } from '../types.js';

const DESCRIPTION = `Find live credit-card transfer bonuses (e.g. "Amex -> Flying Blue, 25% bonus, ends Oct 31").

PointsYeah publishes the bonus percentage, the expiry date and its marketing line next to each bank transfer option, so this tool runs one live award search and harvests them. Bonuses are bank-wide rather than route-specific, so any route with award space will reveal them — pick a busy route and a date a few months out for the widest coverage.

Returns, for each bonus: the bank, the airline program, the bonus percentage, the points needed with and without the bonus, the end date, PointsYeah's slogan, the bank's transfer page, and a sample award it was seen on.

Expect 30-90 seconds, because the award search drives a real browser.`;

export function findTransferBonusesTool(_server: Server, clientFactory: () => IPointsYeahClient) {
  return {
    name: 'find_transfer_bonuses',
    description: DESCRIPTION,
    inputSchema: {
      type: 'object' as const,
      properties: {
        origin: { type: 'string', description: 'Origin airport/city code to probe (e.g. "SFO")' },
        destination: { type: 'string', description: 'Destination airport/city code (e.g. "NRT")' },
        departDate: { type: 'string', description: 'Departure date YYYY-MM-DD' },
        returnDate: { type: 'string', description: 'Optional return date YYYY-MM-DD' },
        cabins: {
          type: 'array',
          items: { type: 'string', enum: ['Economy', 'Premium Economy', 'Business', 'First'] },
          description: 'Cabins to probe (default: all cabins)',
        },
        adults: { type: 'number', description: 'Adult passengers (default 1)' },
        children: { type: 'number', description: 'Child passengers (default 0)' },
        banks: {
          type: 'array',
          items: { type: 'string' },
          description: 'Restrict to these banks, e.g. ["Chase", "Amex"]',
        },
        minBonusPercent: {
          type: 'number',
          description: 'Only report bonuses at least this large (default 1)',
        },
        limit: { type: 'number', description: 'Max bonuses to return (default 25)' },
      },
      required: ['origin', 'destination', 'departDate'],
    },
    handler: async (args: unknown) => {
      try {
        const params = FindTransferBonusesParamsSchema.parse(args);
        const result = await clientFactory().findTransferBonuses(params);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: 'text', text: `Error finding transfer bonuses: ${message}` }],
          isError: true,
        };
      }
    },
  };
}

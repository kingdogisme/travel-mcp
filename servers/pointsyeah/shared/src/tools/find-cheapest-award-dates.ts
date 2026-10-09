import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { IPointsYeahClient } from '../server.js';
import { FindCheapestAwardDatesParamsSchema } from '../types.js';

const DESCRIPTION = `Find the cheapest award dates across a flexible window of departure dates.

PointsYeah prices a whole date range in a single flexible-date search, so this returns the cheapest award per calendar day (program, miles, taxes, cabin, seats and the itinerary), plus the cheapest option per airline program across the window.

Use it when the user is flexible about when to fly — "cheapest day to fly SFO to Tokyo on points in November", "when is business class available to London this spring" — then follow up with search_flights for the exact date.

Expect 30-90 seconds, because the search drives a real browser. Keep the window to a few weeks so PointsYeah can price it in one pass.`;

export function findCheapestAwardDatesTool(
  _server: Server,
  clientFactory: () => IPointsYeahClient
) {
  return {
    name: 'find_cheapest_award_dates',
    description: DESCRIPTION,
    inputSchema: {
      type: 'object' as const,
      properties: {
        departure: { type: 'string', description: 'Origin airport/city code (e.g. "SFO")' },
        arrival: { type: 'string', description: 'Destination airport/city code (e.g. "NRT")' },
        departDate: { type: 'string', description: 'First departure date YYYY-MM-DD' },
        departDateTo: { type: 'string', description: 'Last departure date YYYY-MM-DD' },
        returnDate: { type: 'string', description: 'Optional return date YYYY-MM-DD' },
        returnDateTo: { type: 'string', description: 'Optional last return date YYYY-MM-DD' },
        cabins: {
          type: 'array',
          items: { type: 'string', enum: ['Economy', 'Premium Economy', 'Business', 'First'] },
          description: 'Cabins to search (default: ["Business"])',
        },
        adults: { type: 'number', description: 'Adult passengers (default 1)' },
        children: { type: 'number', description: 'Child passengers (default 0)' },
        maxStops: { type: 'number', description: 'Maximum connections per route' },
        minSeats: { type: 'number', description: 'Require at least this many award seats' },
        maxMiles: { type: 'number', description: 'Ignore awards above this many miles' },
        sortBy: {
          type: 'string',
          enum: ['miles', 'date'],
          description: 'Order the returned dates by price or chronologically (default: miles)',
        },
        limit: { type: 'number', description: 'Max date entries to return (default 20)' },
      },
      required: ['departure', 'arrival', 'departDate', 'departDateTo'],
    },
    handler: async (args: unknown) => {
      try {
        const params = FindCheapestAwardDatesParamsSchema.parse(args);
        const result = await clientFactory().findCheapestAwardDates(params);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: 'text', text: `Error finding cheapest award dates: ${message}` }],
          isError: true,
        };
      }
    },
  };
}

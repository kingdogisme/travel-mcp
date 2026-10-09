import { setApiKey, getApiKey } from '../state.js';

const DESCRIPTION = `Store a PointsYeah developer API key for this session.

The key powers the award-explorer, destination-recommendation and hotel tools (explore_award_routes, recommend_award_destinations, search_hotels, hotel_availability_calendar, get_hotel_detail). Create one at pointsyeah.com/account/api-key — it needs a premium membership — or set POINTSYEAH_API_KEY in the environment, which is the better option for a deployment.

Call this only when the environment variable is not set.`;

export function setApiKeyTool() {
  return {
    name: 'set_api_key',
    description: DESCRIPTION,
    inputSchema: {
      type: 'object' as const,
      properties: {
        apiKey: {
          type: 'string',
          description: 'The X-API-Key value from your PointsYeah account profile',
        },
      },
      required: ['apiKey'],
    },
    handler: async (args: unknown) => {
      const { apiKey } = (args ?? {}) as { apiKey?: string };
      if (!apiKey || apiKey.trim().length === 0) {
        return {
          content: [{ type: 'text', text: 'Error: apiKey is required.' }],
          isError: true,
        };
      }
      setApiKey(apiKey.trim());
      const stored = getApiKey() ?? '';
      const masked = stored.length > 8 ? `${stored.slice(0, 4)}...${stored.slice(-4)}` : '****';
      return {
        content: [
          {
            type: 'text',
            text: `PointsYeah API key stored for this session (${masked}). Award explorer, destination recommendations and hotel tools are now available.`,
          },
        ],
      };
    },
  };
}

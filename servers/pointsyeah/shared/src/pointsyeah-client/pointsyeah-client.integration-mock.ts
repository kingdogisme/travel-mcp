import type { IPointsYeahClient } from '../server.js';
import type {
  FlightSearchParams,
  FlightResult,
  FlightSearchResults,
  FindTransferBonusesParams,
  TransferBonus,
  TransferBonusSearchResult,
  FindCheapestAwardDatesParams,
  AwardDateOption,
  CheapestAwardDatesResult,
} from '../types.js';

interface MockData {
  searchResults?: FlightResult[];
  searchHistory?: unknown[];
  [key: string]: unknown;
}

/**
 * Creates a mock implementation of IPointsYeahClient for integration tests.
 * This mocks the EXTERNAL API client, NOT the MCP client.
 */
export function createIntegrationMockPointsYeahClient(
  mockData: MockData = {}
): IPointsYeahClient & { mockData: MockData } {
  return {
    mockData,

    async searchFlights(_params: FlightSearchParams): Promise<FlightSearchResults> {
      const results: FlightResult[] = mockData.searchResults || [
        {
          program: 'United MileagePlus',
          code: 'UA',
          date: '2026-04-01',
          departure: 'SFO',
          arrival: 'NYC',
          routes: [
            {
              payment: {
                currency: 'USD',
                tax: 5.6,
                miles: 25000,
                cabin: 'Economy',
                unit: 'points',
                seats: 3,
                cash_price: 0,
              },
              segments: [
                {
                  duration: 320,
                  flight_number: 'UA123',
                  dt: '2026-04-01T08:00:00',
                  da: 'SFO',
                  at: '2026-04-01T16:20:00',
                  aa: 'EWR',
                  cabin: 'Economy',
                },
              ],
              transfer: [{ bank: 'Chase Ultimate Rewards', actual_points: 25000, points: 25000 }],
            },
          ],
        },
      ];

      return { total: results.length, unfiltered_total: results.length, results, notes: [] };
    },

    async getSearchHistory(): Promise<unknown> {
      return mockData.searchHistory || [];
    },

    async findTransferBonuses(
      params: FindTransferBonusesParams
    ): Promise<TransferBonusSearchResult> {
      const results = mockData.searchResults || [];
      const bonuses: TransferBonus[] = [];
      for (const result of results) {
        for (const route of result.routes ?? []) {
          for (const transfer of route.transfer ?? []) {
            const percent = transfer.bonus_percentage ?? 0;
            if (percent < params.minBonusPercent) continue;
            bonuses.push({
              bank: transfer.bank,
              bank_code: transfer.code ?? '',
              program: result.program,
              program_code: result.code,
              bonus_percentage: percent,
              award_miles: route.payment?.miles ?? transfer.actual_points,
              effective_transfer_points: Math.ceil(
                (route.payment?.miles ?? transfer.actual_points) / (1 + percent / 100)
              ),
              points_reported: { actual: transfer.actual_points, nominal: transfer.points },
              bonus_end_date: transfer.bonus_end_date
                ? new Date(transfer.bonus_end_date * 1000).toISOString().split('T')[0]
                : null,
              slogan: transfer.bonus_slogn ?? '',
              url: transfer.url ?? '',
              sample: route.payment
                ? {
                    departure: result.departure,
                    arrival: result.arrival,
                    date: result.date,
                    miles: route.payment.miles,
                    cabin: route.payment.cabin,
                  }
                : null,
            });
          }
        }
      }
      return {
        bonuses,
        searched: {
          origin: params.origin,
          destination: params.destination,
          depart_date: params.departDate,
          return_date: params.returnDate,
          cabins: params.cabins,
        },
        total_results: results.length,
        unfiltered_total: results.length,
        notes: [],
      };
    },

    async findCheapestAwardDates(
      params: FindCheapestAwardDatesParams
    ): Promise<CheapestAwardDatesResult> {
      const results = mockData.searchResults || [];
      const byDate = new Map<string, AwardDateOption>();
      const byProgram = new Map<string, AwardDateOption>();

      for (const result of results) {
        for (const route of result.routes ?? []) {
          if (!route.payment) continue;
          const option: AwardDateOption = {
            date: result.date,
            program: result.program,
            program_code: result.code,
            miles: route.payment.miles,
            tax: route.payment.tax,
            cabin: route.payment.cabin,
            seats: route.payment.seats,
            stops: (route.segments?.length ?? 1) - 1,
            itinerary: (route.segments ?? [])
              .map((segment) => `${segment.da} -> ${segment.aa}`)
              .join(', '),
          };
          const existingDate = byDate.get(option.date);
          if (!existingDate || option.miles < existingDate.miles) byDate.set(option.date, option);
          const existingProgram = byProgram.get(option.program_code);
          if (!existingProgram || option.miles < existingProgram.miles) {
            byProgram.set(option.program_code, option);
          }
        }
      }

      const allDates = Array.from(byDate.values());
      return {
        window: { from: params.departDate, to: params.departDateTo },
        dates: allDates.slice(0, params.limit),
        by_program: Array.from(byProgram.values()).map((option) => ({
          program: option.program,
          program_code: option.program_code,
          cheapest: option,
        })),
        cheapest: allDates[0] ?? null,
        searched_dates: allDates.map((option) => option.date).sort(),
        total_results: results.length,
        unfiltered_total: results.length,
        notes: [],
      };
    },
  };
}

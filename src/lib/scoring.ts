import type { LineupPositionInput } from "@/lib/lineup";

export type WeeklyPrice = {
  ticker: string;
  mondayOpen: number;
  fridayClose: number;
};

export type WeeklyReturnResult = {
  weeklyReturn: number;
  assetReturns: Record<string, number>;
};

export type MatchupResult = {
  homeScore: number;
  awayScore: number;
  winnerUserId: string | null;
};

export function calculateAssetReturn(mondayOpen: number, fridayClose: number) {
  if (!Number.isFinite(mondayOpen) || !Number.isFinite(fridayClose)) {
    throw new Error("Invalid price data.");
  }
  if (mondayOpen <= 0) {
    throw new Error("Monday open must be greater than zero.");
  }
  return fridayClose / mondayOpen - 1;
}

export function calculateWeeklyReturn(
  positions: LineupPositionInput[],
  prices: Map<string, WeeklyPrice>
): WeeklyReturnResult {
  let weeklyReturn = 0;
  const assetReturns: Record<string, number> = {};

  for (const position of positions) {
    const price = prices.get(position.ticker.toUpperCase());
    if (!price) {
      throw new Error(`Missing weekly prices for ${position.ticker}.`);
    }
    const assetReturn = calculateAssetReturn(price.mondayOpen, price.fridayClose);
    assetReturns[position.ticker.toUpperCase()] = assetReturn;
    weeklyReturn += position.weight * assetReturn;
  }

  return { weeklyReturn, assetReturns };
}

export function scoreMatchup(
  homeUserId: string,
  awayUserId: string,
  homeReturn: number,
  awayReturn: number
): MatchupResult {
  if (homeReturn > awayReturn) {
    return { homeScore: homeReturn, awayScore: awayReturn, winnerUserId: homeUserId };
  }
  if (awayReturn > homeReturn) {
    return { homeScore: homeReturn, awayScore: awayReturn, winnerUserId: awayUserId };
  }
  return { homeScore: homeReturn, awayScore: awayReturn, winnerUserId: null };
}

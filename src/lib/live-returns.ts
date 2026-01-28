import { getDelayedQuotes, getWeekOpenPrices } from "@/lib/market-data";

export type LiveReturnResult = {
  value: number | null;
  updatedAt: string | null;
  missing: string[];
};

type Position = {
  ticker: string;
  weight: number;
};

export async function calculateLiveReturn(
  positions: Position[],
  weekStart: string
): Promise<LiveReturnResult> {
  const tickers = Array.from(
    new Set(positions.map((position) => position.ticker.toUpperCase()))
  );

  const [quotes, opens] = await Promise.all([
    getDelayedQuotes(tickers),
    getWeekOpenPrices(tickers, weekStart)
  ]);

  const missing: string[] = [];
  const fetchedAt = new Date().toISOString();
  let updatedAt: string | null = fetchedAt;
  let totalReturn = 0;

  for (const position of positions) {
    const ticker = position.ticker.toUpperCase();
    const quote = quotes.get(ticker);
    const openEntry = opens.get(ticker);
    const open = openEntry?.open;
    const price = quote?.price ?? openEntry?.latestClose ?? null;
    if (!openEntry || open === undefined || price === null) {
      missing.push(ticker);
      continue;
    }

    updatedAt = quote?.updatedAt ?? openEntry?.latestDate ?? fetchedAt;
    totalReturn += position.weight * (price / open - 1);
  }

  if (missing.length > 0) {
    return { value: null, updatedAt, missing };
  }

  return { value: totalReturn, updatedAt, missing: [] };
}

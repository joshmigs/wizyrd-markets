import { NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { DEFAULT_BENCHMARK_TICKER } from "@/lib/benchmark";
import { scoreWeekIfReady } from "@/lib/scoring-runner";

type DailySeries = Record<string, Record<string, string>>;

type WeekPrice = {
  ticker: string;
  monday_open: number;
  friday_close: number;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const getApiKey = () =>
  process.env.MARKET_DATA_API_KEY ||
  process.env.ALPHA_VANTAGE_API_KEY ||
  "";

const SPLIT_CANDIDATES = [2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15, 20, 25];

type SplitEvent = { date: string; factor: number };

const fetchDailySeries = async (ticker: string, apiKey: string) => {
  const url = new URL("https://www.alphavantage.co/query");
  url.searchParams.set("function", "TIME_SERIES_DAILY");
  url.searchParams.set("symbol", ticker);
  url.searchParams.set("outputsize", "compact");
  url.searchParams.set("apikey", apiKey);
  const response = await fetch(url.toString(), { cache: "no-store" });
  const data = (await response.json()) as Record<string, unknown>;
  if (data.Note || data["Error Message"] || data.Information) {
    return null;
  }
  return (data["Time Series (Daily)"] as DailySeries | undefined) ?? null;
};

const inferSplitsFromSeries = (series: DailySeries) => {
  const points = Object.entries(series)
    .map(([date, fields]) => ({
      date,
      close: Number(fields["4. close"])
    }))
    .filter((point) => Number.isFinite(point.close))
    .sort((a, b) => a.date.localeCompare(b.date));

  const splits: SplitEvent[] = [];
  for (let index = 1; index < points.length; index += 1) {
    const prev = points[index - 1];
    const next = points[index];
    if (!prev.close || !next.close) {
      continue;
    }
    const ratio = prev.close / next.close;
    if (!Number.isFinite(ratio) || ratio < 1.4) {
      continue;
    }
    let bestCandidate: number | null = null;
    let bestError = Number.POSITIVE_INFINITY;
    SPLIT_CANDIDATES.forEach((factor) => {
      const error = Math.abs(ratio - factor) / factor;
      if (error < bestError) {
        bestError = error;
        bestCandidate = factor;
      }
    });
    if (bestCandidate && bestError < 0.25) {
      splits.push({ date: next.date, factor: bestCandidate });
    }
  }
  return splits.sort((a, b) => a.date.localeCompare(b.date));
};

const getWeekPricesFromSeries = (
  series: DailySeries,
  weekStart: string,
  weekEnd: string
) => {
  const dates = Object.keys(series).sort();
  const openDate = dates.find((date) => date >= weekStart) ?? null;
  const closeDate =
    [...dates].reverse().find((date) => date <= weekEnd) ?? null;

  if (!openDate || !closeDate) {
    return null;
  }

  const openRaw = Number(series[openDate]?.["1. open"]);
  const closeRaw = Number(series[closeDate]?.["4. close"]);
  if (!Number.isFinite(openRaw) || !Number.isFinite(closeRaw)) {
    return null;
  }

  const splits = inferSplitsFromSeries(series);
  let splitFactor = 1;
  for (const split of splits) {
    if (split.date > openDate && split.date <= closeDate) {
      splitFactor *= split.factor;
    }
  }

  const adjustedOpen = openRaw * splitFactor;
  return {
    monday_open: adjustedOpen,
    friday_close: closeRaw
  };
};

export async function POST(request: Request) {
  const secret = process.env.SCORING_CRON_SECRET;
  if (secret) {
    const authHeader = request.headers.get("authorization") ?? "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token || token !== secret) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }
  }

  const body = await request.json().catch(() => null);
  const leagueId = body?.leagueId as string | undefined;
  const weekId = body?.weekId as string | undefined;

  if (!leagueId || !weekId) {
    return NextResponse.json(
      { error: "League and week are required." },
      { status: 400 }
    );
  }

  const apiKey = getApiKey();
  if (!apiKey) {
    return NextResponse.json(
      { error: "Missing market data API key." },
      { status: 500 }
    );
  }

  const supabase = createSupabaseServiceClient();

  const { data: week, error: weekError } = await supabase
    .from("weeks")
    .select("id, week_start, week_end, league_id")
    .eq("id", weekId)
    .eq("league_id", leagueId)
    .maybeSingle();

  if (weekError || !week) {
    return NextResponse.json(
      { error: weekError?.message ?? "Week not found." },
      { status: 404 }
    );
  }

  const { data: lineups, error: lineupsError } = await supabase
    .from("lineups")
    .select("id")
    .eq("league_id", leagueId)
    .eq("week_id", weekId);

  if (lineupsError) {
    return NextResponse.json({ error: lineupsError.message }, { status: 500 });
  }

  const lineupIds = (lineups ?? []).map((lineup) => lineup.id);
  if (!lineupIds.length) {
    return NextResponse.json(
      { error: "No lineups found for this week." },
      { status: 400 }
    );
  }

  const { data: positions, error: positionsError } = await supabase
    .from("lineup_positions")
    .select("ticker")
    .in("lineup_id", lineupIds);

  if (positionsError) {
    return NextResponse.json({ error: positionsError.message }, { status: 500 });
  }

  const tickers = new Set(
    (positions ?? []).map((position) => position.ticker.toUpperCase())
  );
  tickers.add(DEFAULT_BENCHMARK_TICKER);

  const prices: WeekPrice[] = [];
  const missing: string[] = [];

  for (const ticker of tickers) {
    const series = await fetchDailySeries(ticker, apiKey);
    if (!series) {
      missing.push(ticker);
      await sleep(12000);
      continue;
    }
    const pricesForWeek = getWeekPricesFromSeries(
      series,
      week.week_start,
      week.week_end
    );
    if (!pricesForWeek) {
      missing.push(ticker);
      await sleep(12000);
      continue;
    }
    prices.push({
      ticker,
      monday_open: pricesForWeek.monday_open,
      friday_close: pricesForWeek.friday_close
    });
    await sleep(12000);
  }

  if (!prices.length) {
    return NextResponse.json(
      { error: "No weekly prices resolved.", missing },
      { status: 500 }
    );
  }

  const { error: upsertError } = await supabase
    .from("weekly_prices")
    .upsert(
      prices.map((price) => ({
        week_id: weekId,
        ticker: price.ticker,
        monday_open: price.monday_open,
        friday_close: price.friday_close
      })),
      { onConflict: "week_id,ticker" }
    );

  if (upsertError) {
    return NextResponse.json({ error: upsertError.message }, { status: 500 });
  }

  const scoredResult = await scoreWeekIfReady({
    supabase,
    leagueId,
    weekId,
    weekEnd: week.week_end
  });

  return NextResponse.json({
    ok: true,
    resolved: prices.length,
    missing,
    scored: scoredResult.scored,
    scoreReason: scoredResult.reason ?? null
  });
}

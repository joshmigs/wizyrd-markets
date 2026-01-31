import { NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { loadAllowedTickers } from "@/lib/universe";
import { fetchEdgarFundamentals } from "@/lib/edgar";

type MonthlyYear = {
  year: number;
  months: (number | null)[];
};

type YearlyReturn = { year: number; value: number };
type MonthlyReturn = { dateKey: string; value: number };

type StockMetrics = {
  version: number;
  ticker: string;
  name: string | null;
  description: string | null;
  website?: string | null;
  marketCap: string | null;
  pe: string | null;
  beta: number | null;
  annualReturn: number | null;
  oneYearReturn: number | null;
  lastPrice: number | null;
  asOf: string | null;
  revenue: number | null;
  netIncome: number | null;
  eps: number | null;
  sharesOutstanding: number | null;
  assets: number | null;
  liabilities: number | null;
  equity: number | null;
  yearlyReturns: YearlyReturn[];
  monthlyByYear: MonthlyYear[];
};

type CacheEntry = {
  value: StockMetrics;
  updatedAt: number;
};

type WarmStatePayload = {
  cursor?: number;
  snapshotId?: string | null;
};

const CACHE_TTL_MS = 1000 * 60 * 30;
const SUPABASE_CACHE_TTL_MS = 1000 * 60 * 60 * 24;
const DATA_VERSION = 11;
const CACHE_WARM_STATE_TICKER = "__CACHE_STATE__";
const readNumberEnv = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};
const CACHE_WARM_INTERVAL_MS = readNumberEnv(
  process.env.MARKET_DATA_WARM_INTERVAL_MS,
  1000 * 60
);
const CACHE_WARM_BATCH_SIZE = readNumberEnv(
  process.env.MARKET_DATA_WARM_BATCH_SIZE,
  20
);
const CACHE_WARM_UNIVERSE_TTL_MS = 1000 * 60 * 60 * 6;
const MARKET_DATA_TICKERS_PER_MINUTE = readNumberEnv(
  process.env.MARKET_DATA_TICKERS_PER_MINUTE,
  5
);
const MARKET_DATA_TICKERS_PER_DAY = readNumberEnv(
  process.env.MARKET_DATA_TICKERS_PER_DAY,
  500
);
const globalCache = globalThis as typeof globalThis & {
  playgroundStockCache?: Map<string, CacheEntry>;
  playgroundBenchmarkCache?: { returns: MonthlyReturn[]; updatedAt: number };
  playgroundWarmState?: {
    inFlight: boolean;
    universeTickers: string[];
    universeSnapshotId: string | null;
    universeFetchedAt: number;
    cooldownUntil: number;
  };
  playgroundRateLimiter?: {
    minuteStart: number;
    minuteCount: number;
    dayStart: number;
    dayCount: number;
    minuteLimit?: number;
    dayLimit?: number;
  };
};
const cache = globalCache.playgroundStockCache ?? new Map<string, CacheEntry>();
globalCache.playgroundStockCache = cache;
const benchmarkCache =
  globalCache.playgroundBenchmarkCache ?? { returns: [], updatedAt: 0 };
globalCache.playgroundBenchmarkCache = benchmarkCache;
const warmState =
  globalCache.playgroundWarmState ?? {
    inFlight: false,
    universeTickers: [],
    universeSnapshotId: null,
    universeFetchedAt: 0,
    cooldownUntil: 0
  };
warmState.cooldownUntil = warmState.cooldownUntil ?? 0;
globalCache.playgroundWarmState = warmState;
const rateLimiter =
  globalCache.playgroundRateLimiter ?? {
    minuteStart: 0,
    minuteCount: 0,
    dayStart: 0,
    dayCount: 0,
    minuteLimit: undefined,
    dayLimit: undefined
  };
globalCache.playgroundRateLimiter = rateLimiter;

const normalizeTicker = (ticker: string) => ticker.trim().toUpperCase();

const isRateLimitError = (error: unknown) => {
  if (!(error instanceof Error)) {
    return false;
  }
  const message = error.message.toLowerCase();
  return (
    message.includes("limit") ||
    message.includes("rate limit") ||
    message.includes("frequency") ||
    message.includes("per day") ||
    message.includes("per minute") ||
    message.includes("requests per day") ||
    message.includes("requests per minute")
  );
};

const parseRateLimitMessage = (message: string) => {
  const minuteMatch =
    message.match(/(\d+)\s+requests?\s+per\s+minute/i) ??
    message.match(/(\d+)\s+per\s+minute/i);
  const dayMatch =
    message.match(/(\d+)\s+requests?\s+per\s+day/i) ??
    message.match(/(\d+)\s+per\s+day/i);
  const minuteLimit = minuteMatch ? Number(minuteMatch[1]) : undefined;
  const dayLimit = dayMatch ? Number(dayMatch[1]) : undefined;
  return {
    minuteLimit: Number.isFinite(minuteLimit) ? minuteLimit : undefined,
    dayLimit: Number.isFinite(dayLimit) ? dayLimit : undefined
  };
};

const noteRateLimit = (message?: string) => {
  const parsed = message ? parseRateLimitMessage(message) : null;
  if (parsed?.minuteLimit) {
    rateLimiter.minuteLimit = parsed.minuteLimit;
  }
  if (parsed?.dayLimit) {
    rateLimiter.dayLimit = parsed.dayLimit;
  }
  const minuteLimit = rateLimiter.minuteLimit ?? MARKET_DATA_TICKERS_PER_MINUTE;
  rateLimiter.minuteCount = minuteLimit;
  warmState.cooldownUntil = Math.max(warmState.cooldownUntil, Date.now() + 60_000);
  if (parsed?.dayLimit) {
    if (!rateLimiter.dayStart) {
      rateLimiter.dayStart = Date.now();
    }
    rateLimiter.dayCount = parsed.dayLimit;
  }
};

const canFetchMarketData = () => {
  const now = Date.now();
  if (warmState.cooldownUntil && now < warmState.cooldownUntil) {
    return false;
  }
  if (!rateLimiter.minuteStart || now - rateLimiter.minuteStart >= 60_000) {
    rateLimiter.minuteStart = now;
    rateLimiter.minuteCount = 0;
  }
  if (!rateLimiter.dayStart || now - rateLimiter.dayStart >= 86_400_000) {
    rateLimiter.dayStart = now;
    rateLimiter.dayCount = 0;
  }
  const minuteLimit = rateLimiter.minuteLimit ?? MARKET_DATA_TICKERS_PER_MINUTE;
  const dayLimit = rateLimiter.dayLimit ?? MARKET_DATA_TICKERS_PER_DAY;
  if (rateLimiter.minuteCount >= minuteLimit) {
    return false;
  }
  if (rateLimiter.dayCount >= dayLimit) {
    return false;
  }
  rateLimiter.minuteCount += 1;
  rateLimiter.dayCount += 1;
  return true;
};

const hashTicker = (value: string) => {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33) ^ value.charCodeAt(index);
  }
  return hash >>> 0;
};

const sortTickersForWarm = (tickers: string[]) => {
  const ordered = [...tickers];
  ordered.sort((left, right) => {
    const leftHash = hashTicker(left);
    const rightHash = hashTicker(right);
    if (leftHash !== rightHash) {
      return leftHash - rightHash;
    }
    return left.localeCompare(right);
  });
  return ordered;
};

const spreadTickers = (tickers: string[]) => {
  if (tickers.length < 2) {
    return tickers;
  }
  const orderedTickers = sortTickersForWarm(tickers);
  const stride = Math.max(2, Math.round(Math.sqrt(orderedTickers.length)));
  const ordered: string[] = [];
  for (let offset = 0; offset < stride; offset += 1) {
    for (let index = offset; index < orderedTickers.length; index += stride) {
      ordered.push(orderedTickers[index]);
    }
  }
  return ordered.length ? ordered : orderedTickers;
};

const getUniverseTickers = async (
  supabase: ReturnType<typeof createSupabaseServiceClient>
) => {
  const now = Date.now();
  if (
    warmState.universeTickers.length &&
    now - warmState.universeFetchedAt < CACHE_WARM_UNIVERSE_TTL_MS
  ) {
    return {
      tickers: warmState.universeTickers,
      snapshotId: warmState.universeSnapshotId
    };
  }

  const { allowed, snapshotId } = await loadAllowedTickers(supabase);
  const tickers = Array.from(allowed)
    .map(normalizeTicker)
    .filter(Boolean)
    .filter((ticker) => ticker !== CACHE_WARM_STATE_TICKER);

  if (!tickers.includes("SPY")) {
    tickers.push("SPY");
  }
  tickers.sort();

  warmState.universeTickers = tickers;
  warmState.universeSnapshotId = snapshotId ?? null;
  warmState.universeFetchedAt = now;

  return { tickers, snapshotId: warmState.universeSnapshotId };
};

const formatMarketCap = (value: string | number | null) => {
  if (value === null || value === undefined) {
    return null;
  }
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return typeof value === "string" ? value : null;
  }
  if (numeric >= 1_000_000_000_000) {
    return `${(numeric / 1_000_000_000_000).toFixed(2)}T`;
  }
  if (numeric >= 1_000_000_000) {
    return `${(numeric / 1_000_000_000).toFixed(1)}B`;
  }
  return `${(numeric / 1_000_000).toFixed(1)}M`;
};

const fetchJson = async (url: string) => {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Request failed (${response.status})`);
  }
  return response.json() as Promise<Record<string, unknown>>;
};

type SplitEvent = { date: Date; factor: number };
type AdjustedPoint = { date: Date; close: number; adjClose: number };
const SPLIT_CANDIDATES = [2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15, 20, 25];

const fetchAlphaVantageDaily = async (ticker: string, apiKey: string) => {
  const url = new URL("https://www.alphavantage.co/query");
  url.searchParams.set("function", "TIME_SERIES_DAILY");
  url.searchParams.set("symbol", ticker);
  url.searchParams.set("outputsize", "full");
  url.searchParams.set("apikey", apiKey);
  const data = await fetchJson(url.toString());
  const errorMessage =
    (data.Note as string | undefined) ??
    (data.Information as string | undefined) ??
    (data["Error Message"] as string | undefined);
  if (errorMessage) {
    throw new Error(
      errorMessage ?? "Market data limit reached."
    );
  }
  return (
    (data["Time Series (Daily)"] as Record<string, Record<string, string>> | undefined) ??
    null
  );
};

const fetchAlphaVantageMonthly = async (ticker: string, apiKey: string) => {
  const url = new URL("https://www.alphavantage.co/query");
  url.searchParams.set("function", "TIME_SERIES_MONTHLY_ADJUSTED");
  url.searchParams.set("symbol", ticker);
  url.searchParams.set("apikey", apiKey);
  const data = await fetchJson(url.toString());
  const errorMessage =
    (data.Note as string | undefined) ??
    (data.Information as string | undefined) ??
    (data["Error Message"] as string | undefined);
  if (errorMessage) {
    throw new Error(
      errorMessage ?? "Market data limit reached."
    );
  }
  return (
    (data["Monthly Adjusted Time Series"] as Record<
      string,
      Record<string, string>
    > | undefined) ?? null
  );
};

const applySplitsToPoints = (points: AdjustedPoint[], splits: SplitEvent[]) => {
  const sortedPoints = [...points].sort((a, b) => b.date.getTime() - a.date.getTime());
  const sortedSplits = [...splits].sort((a, b) => b.date.getTime() - a.date.getTime());
  let cumulativeFactor = 1;
  let splitIndex = 0;
  for (const point of sortedPoints) {
    while (
      splitIndex < sortedSplits.length &&
      point.date.getTime() < sortedSplits[splitIndex].date.getTime()
    ) {
      cumulativeFactor *= sortedSplits[splitIndex].factor || 1;
      splitIndex += 1;
    }
    point.adjClose = point.close / cumulativeFactor;
  }
  return sortedPoints.sort((a, b) => a.date.getTime() - b.date.getTime());
};

const inferSplitsFromSeries = (
  series: Record<string, Record<string, string>> | null
): SplitEvent[] => {
  if (!series) {
    return [];
  }
  const points = Object.entries(series)
    .map(([date, fields]) => ({
      date: new Date(date),
      close: Number(fields["4. close"])
    }))
    .filter((point) => Number.isFinite(point.close))
    .sort((a, b) => a.date.getTime() - b.date.getTime());
  const inferred: SplitEvent[] = [];
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
      inferred.push({ date: next.date, factor: bestCandidate });
    }
  }
  return inferred.sort((a, b) => b.date.getTime() - a.date.getTime());
};

const extractSplitEventsFromSeries = (
  series: Record<string, Record<string, string>> | null
) => {
  if (!series) {
    return [];
  }
  const events: SplitEvent[] = [];
  Object.entries(series).forEach(([date, fields]) => {
    const coefficient = Number(fields["8. split coefficient"]);
    if (!Number.isFinite(coefficient) || coefficient === 1) {
      return;
    }
    const factor = coefficient ? 1 / coefficient : 0;
    if (!Number.isFinite(factor) || factor <= 0) {
      return;
    }
    events.push({ date: new Date(date), factor });
  });
  return events.sort((a, b) => b.date.getTime() - a.date.getTime());
};

const mergeSplitEvents = (primary: SplitEvent[], secondary: SplitEvent[]) => {
  const map = new Map<string, SplitEvent>();
  primary.forEach((event) => {
    map.set(event.date.toISOString().slice(0, 10), event);
  });
  secondary.forEach((event) => {
    const key = event.date.toISOString().slice(0, 10);
    if (!map.has(key)) {
      map.set(key, event);
    }
  });
  return Array.from(map.values()).sort((a, b) => b.date.getTime() - a.date.getTime());
};

const parseMonthlySeries = (
  series: Record<string, Record<string, string>>,
  splits: SplitEvent[]
) => {
  const points = Object.entries(series)
    .map(([date, fields]) => ({
      date: new Date(date),
      close: Number(fields["4. close"]),
      adjClose: 0
    }))
    .filter((point) => Number.isFinite(point.close))
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  if (points.length < 2) {
    return {
      monthlyByYear: [],
      yearlyReturns: [],
      annualReturn: null,
      lastPrice: null,
      asOf: null,
      monthlyReturns: []
    };
  }

  const adjustedPoints = applySplitsToPoints(points, splits);

  const monthlyReturns = adjustedPoints.slice(1).map((point, index) => {
    const prev = adjustedPoints[index].adjClose;
    return {
      dateKey: point.date.toISOString().slice(0, 7),
      value: prev ? point.adjClose / prev - 1 : 0
    };
  });

  const monthlyByYearMap = new Map<number, (number | null)[]>();
  monthlyReturns.forEach((entry) => {
    const year = Number(entry.dateKey.slice(0, 4));
    const month = Number(entry.dateKey.slice(5, 7)) - 1;
    if (!monthlyByYearMap.has(year)) {
      monthlyByYearMap.set(year, Array.from({ length: 12 }, () => null));
    }
    monthlyByYearMap.get(year)![month] = entry.value;
  });

  const yearlyReturnsMap = new Map<number, { first: number; last: number }>();
  adjustedPoints.forEach((point) => {
    const year = point.date.getFullYear();
    const existing = yearlyReturnsMap.get(year);
    if (!existing) {
      yearlyReturnsMap.set(year, { first: point.adjClose, last: point.adjClose });
    } else {
      existing.last = point.adjClose;
    }
  });

  const yearlyReturns = Array.from(yearlyReturnsMap.entries())
    .map(([year, values]) => ({
      year,
      value: values.first ? values.last / values.first - 1 : 0
    }))
    .sort((a, b) => a.year - b.year);

  const yearsSorted = Array.from(monthlyByYearMap.keys()).sort((a, b) => a - b);
  const monthlyByYear = yearsSorted.map((year) => ({
    year,
    months: monthlyByYearMap.get(year) ?? Array.from({ length: 12 }, () => null)
  }));

  let annualReturn: number | null = null;
  if (adjustedPoints.length >= 13) {
    const last = adjustedPoints[adjustedPoints.length - 1].adjClose;
    const prior = adjustedPoints[adjustedPoints.length - 13].adjClose;
    annualReturn = prior ? last / prior - 1 : null;
  }

  const lastPoint = adjustedPoints[adjustedPoints.length - 1] ?? null;
  const asOf = lastPoint?.date.toISOString() ?? null;
  const lastPrice = lastPoint?.adjClose ?? null;
  return {
    monthlyByYear,
    yearlyReturns,
    annualReturn,
    lastPrice,
    asOf,
    monthlyReturns
  };
};

const calculateTrailingOneYear = (
  series: Record<string, Record<string, string>>,
  splits: SplitEvent[]
) => {
  const points = Object.entries(series)
    .map(([date, fields]) => ({
      date: new Date(date),
      close: Number(fields["4. close"]),
      adjClose: 0
    }))
    .filter((point) => Number.isFinite(point.close))
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  if (points.length < 2) {
    return { oneYearReturn: null, asOf: null, lastPrice: null };
  }

  const adjustedPoints = applySplitsToPoints(points, splits);
  const latest = adjustedPoints[adjustedPoints.length - 1];
  const target = new Date(latest.date);
  target.setFullYear(target.getFullYear() - 1);

  let base = adjustedPoints[0];
  for (let index = adjustedPoints.length - 1; index >= 0; index -= 1) {
    if (adjustedPoints[index].date.getTime() <= target.getTime()) {
      base = adjustedPoints[index];
      break;
    }
  }

  const oneYearReturn = base.adjClose
    ? latest.adjClose / base.adjClose - 1
    : null;

  return {
    oneYearReturn,
    asOf: latest.date.toISOString(),
    lastPrice: latest.adjClose
  };
};

const calculateBeta = (stockReturns: MonthlyReturn[], benchmarkReturns: MonthlyReturn[]) => {
  if (stockReturns.length < 2 || benchmarkReturns.length < 2) {
    return null;
  }
  const benchmarkMap = new Map(
    benchmarkReturns.map((entry) => [entry.dateKey, entry.value])
  );
  const paired = stockReturns
    .map((entry) => ({
      stock: entry.value,
      benchmark: benchmarkMap.get(entry.dateKey)
    }))
    .filter((entry): entry is { stock: number; benchmark: number } =>
      Number.isFinite(entry.benchmark)
    );
  if (paired.length < 6) {
    return null;
  }
  const stockMean =
    paired.reduce((sum, entry) => sum + entry.stock, 0) / paired.length;
  const benchMean =
    paired.reduce((sum, entry) => sum + entry.benchmark, 0) / paired.length;
  const covariance =
    paired.reduce(
      (sum, entry) => sum + (entry.stock - stockMean) * (entry.benchmark - benchMean),
      0
    ) / paired.length;
  const variance =
    paired.reduce((sum, entry) => sum + (entry.benchmark - benchMean) ** 2, 0) /
    paired.length;
  if (!Number.isFinite(covariance) || !Number.isFinite(variance) || variance === 0) {
    return null;
  }
  const beta = covariance / variance;
  return Number.isFinite(beta) ? beta : null;
};

const getBenchmarkReturns = async (apiKey: string) => {
  const now = Date.now();
  if (
    benchmarkCache.returns.length &&
    now - benchmarkCache.updatedAt < CACHE_TTL_MS
  ) {
    return benchmarkCache.returns;
  }
  try {
    const series = await fetchAlphaVantageMonthly("SPY", apiKey);
    if (!series) {
      return benchmarkCache.returns;
    }
    const splits = extractSplitEventsFromSeries(series);
    const parsed = parseMonthlySeries(series, splits);
    benchmarkCache.returns = parsed.monthlyReturns;
    benchmarkCache.updatedAt = Date.now();
    return benchmarkCache.returns;
  } catch {
    return benchmarkCache.returns;
  }
};

const mergeOverviewFields = (metrics: StockMetrics, fallback?: StockMetrics | null) => {
  if (!fallback) {
    return metrics;
  }
  return {
    ...metrics,
    version: metrics.version ?? DATA_VERSION,
    name: metrics.name ?? fallback.name ?? null,
    description: metrics.description ?? fallback.description ?? null,
    website: metrics.website ?? null,
    marketCap: metrics.marketCap ?? fallback.marketCap ?? null,
    pe: metrics.pe ?? fallback.pe ?? null,
    beta: metrics.beta ?? fallback.beta ?? null,
    lastPrice: metrics.lastPrice ?? fallback.lastPrice ?? null,
    revenue: metrics.revenue ?? fallback.revenue ?? null,
    netIncome: metrics.netIncome ?? fallback.netIncome ?? null,
    eps: metrics.eps ?? fallback.eps ?? null,
    sharesOutstanding: metrics.sharesOutstanding ?? fallback.sharesOutstanding ?? null,
    assets: metrics.assets ?? fallback.assets ?? null,
    liabilities: metrics.liabilities ?? fallback.liabilities ?? null,
    equity: metrics.equity ?? fallback.equity ?? null
  };
};

const getStockMetrics = async (
  ticker: string,
  includeOverview: boolean,
  useDaily: boolean
) => {
  const cacheKey = `${ticker}:${includeOverview ? "full" : "returns"}:v${DATA_VERSION}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.updatedAt < CACHE_TTL_MS) {
    return cached.value;
  }

  const apiKey = process.env.MARKET_DATA_API_KEY;
  if (!apiKey) {
    throw new Error("Missing market data API key.");
  }

  const monthlySeries = await fetchAlphaVantageMonthly(ticker, apiKey);
  let splits: SplitEvent[] = extractSplitEventsFromSeries(monthlySeries);
  let dailySeries: Record<string, Record<string, string>> | null = null;
  if (useDaily) {
    try {
      dailySeries = await fetchAlphaVantageDaily(ticker, apiKey);
    } catch {
      dailySeries = null;
    }
  }
  const inferred = dailySeries ? inferSplitsFromSeries(dailySeries) : [];
  if (inferred.length) {
    splits = splits.length ? mergeSplitEvents(splits, inferred) : inferred;
  }

  if (!monthlySeries) {
    throw new Error("Monthly series unavailable.");
  }

  const {
    monthlyByYear,
    yearlyReturns,
    annualReturn,
    lastPrice: monthlyLastPrice,
    asOf,
    monthlyReturns
  } = parseMonthlySeries(monthlySeries, splits);
  const trailing = dailySeries
    ? calculateTrailingOneYear(dailySeries, splits)
    : { oneYearReturn: null, asOf: null, lastPrice: null };

  let derivedBeta: number | null = null;
  const benchmarkReturns = await getBenchmarkReturns(apiKey);
  if (benchmarkReturns.length && monthlyReturns.length) {
    derivedBeta = calculateBeta(monthlyReturns, benchmarkReturns);
  }

  let overview: Record<string, string> | null = null;
  if (includeOverview) {
    const overviewUrl = new URL("https://www.alphavantage.co/query");
    overviewUrl.searchParams.set("function", "OVERVIEW");
    overviewUrl.searchParams.set("symbol", ticker);
    overviewUrl.searchParams.set("apikey", apiKey);
    const overviewData = await fetchJson(overviewUrl.toString());
    if (!overviewData.Note && !overviewData["Error Message"]) {
      overview = overviewData as Record<string, string>;
    }
  }

  const oneYearReturn = trailing.oneYearReturn ?? annualReturn;
  const asOfValue = trailing.asOf ?? asOf;
  const lastPrice = trailing.lastPrice ?? monthlyLastPrice ?? null;
  const edgarFundamentals = includeOverview
    ? await fetchEdgarFundamentals(ticker)
    : null;
  const derivedMarketCap =
    edgarFundamentals?.sharesOutstanding && lastPrice
      ? formatMarketCap(edgarFundamentals.sharesOutstanding * lastPrice)
      : null;
  const derivedPe =
    edgarFundamentals?.eps && lastPrice && edgarFundamentals.eps !== 0
      ? (lastPrice / edgarFundamentals.eps).toFixed(2)
      : null;

  const metrics: StockMetrics = {
    version: DATA_VERSION,
    ticker,
    name: overview?.Name ?? null,
    description: overview?.Description ?? null,
    website: null,
    marketCap: formatMarketCap(overview?.MarketCapitalization ?? null) ?? derivedMarketCap,
    pe: overview?.PERatio ?? derivedPe ?? null,
    beta: overview?.Beta ? Number(overview.Beta) : derivedBeta,
    annualReturn,
    oneYearReturn,
    lastPrice,
    asOf: asOfValue,
    revenue: edgarFundamentals?.revenue ?? null,
    netIncome: edgarFundamentals?.netIncome ?? null,
    eps: edgarFundamentals?.eps ?? null,
    sharesOutstanding: edgarFundamentals?.sharesOutstanding ?? null,
    assets: edgarFundamentals?.assets ?? null,
    liabilities: edgarFundamentals?.liabilities ?? null,
    equity: edgarFundamentals?.equity ?? null,
    yearlyReturns,
    monthlyByYear
  };

  cache.set(cacheKey, { value: metrics, updatedAt: Date.now() });
  return metrics;
};

const warmTickers = async (
  supabase: ReturnType<typeof createSupabaseServiceClient>,
  tickers: string[]
) => {
  const uniqueTickers = Array.from(
    new Set(
      tickers
        .map(normalizeTicker)
        .filter(Boolean)
        .filter((ticker) => ticker !== CACHE_WARM_STATE_TICKER)
    )
  );
  if (!uniqueTickers.length) {
    return 0;
  }
  const orderedTickers = spreadTickers(uniqueTickers);

  const now = Date.now();
  const { data: cachedRows } = await supabase
    .from("market_data_snapshots")
    .select("ticker, payload, updated_at, has_overview")
    .in("ticker", orderedTickers);

  const cachedMap = new Map<
    string,
    { payload: StockMetrics; updatedAt: string; hasOverview: boolean }
  >();

  if (cachedRows) {
    cachedRows.forEach((row) => {
      if (row?.payload && row?.updated_at) {
        cachedMap.set(row.ticker, {
          payload: row.payload as StockMetrics,
          updatedAt: row.updated_at,
          hasOverview: Boolean(row.has_overview)
        });
      }
    });
  }

  let processed = 0;
  for (const ticker of orderedTickers) {
    const cached = cachedMap.get(ticker);
    if (cached?.payload) {
      const cachedUpdatedAt = new Date(cached.updatedAt).getTime();
      const isFresh = now - cachedUpdatedAt < SUPABASE_CACHE_TTL_MS;
      const versionOk = cached.payload?.version === DATA_VERSION;
      if (isFresh && versionOk) {
        processed += 1;
        continue;
      }
    }

    if (!canFetchMarketData()) {
      break;
    }

    try {
      const metrics = await getStockMetrics(ticker, false, false);
      const merged = mergeOverviewFields(metrics, cached?.payload ?? null);
      const updatedAt = new Date().toISOString();
      await supabase
        .from("market_data_snapshots")
        .upsert(
          {
            ticker,
            payload: merged,
            updated_at: updatedAt,
            has_overview: cached?.hasOverview || false
          },
          { onConflict: "ticker" }
        );
      cache.set(`${ticker}:returns:v${DATA_VERSION}`, {
        value: merged,
        updatedAt: Date.now()
      });
    } catch (error) {
      if (isRateLimitError(error)) {
        noteRateLimit(error instanceof Error ? error.message : undefined);
        break;
      }
    }
    processed += 1;
  }

  return processed;
};

const maybeWarmCache = async (
  supabase: ReturnType<typeof createSupabaseServiceClient>
) => {
  if (warmState.inFlight) {
    return;
  }
  warmState.inFlight = true;
  try {
    const now = Date.now();
    const { data: stateRow } = await supabase
      .from("market_data_snapshots")
      .select("payload, updated_at")
      .eq("ticker", CACHE_WARM_STATE_TICKER)
      .maybeSingle();

    const lastUpdatedAt = stateRow?.updated_at
      ? new Date(stateRow.updated_at).getTime()
      : 0;

    if (lastUpdatedAt && now - lastUpdatedAt < CACHE_WARM_INTERVAL_MS) {
      return;
    }

    const { tickers, snapshotId } = await getUniverseTickers(supabase);
    if (!tickers.length) {
      return;
    }
    const warmOrder = spreadTickers(tickers);

    const payload = (stateRow?.payload as WarmStatePayload | null) ?? null;
    let cursor =
      payload && Number.isFinite(payload.cursor)
        ? Number(payload.cursor)
        : 0;
    const previousSnapshotId = payload?.snapshotId ?? null;
    if (previousSnapshotId && snapshotId && previousSnapshotId !== snapshotId) {
      cursor = 0;
    }
    if (
      !Number.isFinite(cursor) ||
      cursor < 0 ||
      cursor >= warmOrder.length
    ) {
      cursor = 0;
    }

    const batchSize = Math.min(CACHE_WARM_BATCH_SIZE, warmOrder.length);
    const batch = Array.from({ length: batchSize }, (_value, index) => {
      const position = (cursor + index) % warmOrder.length;
      return warmOrder[position];
    });

    const cursorAdvance = await warmTickers(supabase, batch);
    const nextCursor =
      warmOrder.length && cursorAdvance > 0
        ? (cursor + cursorAdvance) % warmOrder.length
        : cursor;

    await supabase
      .from("market_data_snapshots")
      .upsert(
        {
          ticker: CACHE_WARM_STATE_TICKER,
          payload: { cursor: nextCursor, snapshotId: snapshotId ?? null },
          updated_at: new Date().toISOString(),
          has_overview: false
        },
        { onConflict: "ticker" }
      );
  } finally {
    warmState.inFlight = false;
  }
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const tickerParam = searchParams.get("ticker");
  const tickersParam = searchParams.get("tickers");
  const includeOverview = searchParams.get("includeOverview") !== "0";
  const useDaily = includeOverview && searchParams.get("useDaily") !== "0";
  const cacheOnly = searchParams.get("cacheOnly") === "1";

  const tickers = (tickersParam ?? tickerParam ?? "")
    .split(",")
    .map(normalizeTicker)
    .filter(Boolean);

  if (!tickers.length) {
    return NextResponse.json({ error: "Missing ticker." }, { status: 400 });
  }

  const data: Record<string, StockMetrics> = {};
  const errors: Record<string, string> = {};
  const supabase = createSupabaseServiceClient();
  void maybeWarmCache(supabase).catch(() => {});
  const cacheRows = await supabase
    .from("market_data_snapshots")
    .select("ticker, payload, updated_at, has_overview")
    .in("ticker", tickers);
  const cacheMap = new Map<
    string,
    { payload: StockMetrics; updatedAt: string; hasOverview: boolean }
  >();

  if (cacheRows.data) {
    cacheRows.data.forEach((row) => {
      if (row?.payload && row?.updated_at) {
        cacheMap.set(row.ticker, {
          payload: row.payload as StockMetrics,
          updatedAt: row.updated_at,
          hasOverview: Boolean(row.has_overview)
        });
      }
    });
  }

  const staleTickers: string[] = [];
  const missingTickers: string[] = [];
  tickers.forEach((ticker) => {
    const cached = cacheMap.get(ticker);
    if (!cached) {
      missingTickers.push(ticker);
      return;
    }
    const payload = cached.payload as StockMetrics;
    const updatedAt = new Date(cached.updatedAt).getTime();
    const isFresh = Date.now() - updatedAt < SUPABASE_CACHE_TTL_MS;
    const versionMismatch = payload?.version !== DATA_VERSION;
    const needsOverview = includeOverview && !cached.hasOverview;
    data[ticker] = payload;
    if (!isFresh || versionMismatch || needsOverview) {
      staleTickers.push(ticker);
      return;
    }
    cache.set(
      `${ticker}:${includeOverview ? "full" : "returns"}:v${DATA_VERSION}`,
      { value: payload, updatedAt: updatedAt }
    );
  });

  if (cacheOnly) {
    const warmTargets = spreadTickers([
      ...missingTickers,
      ...staleTickers
    ]).slice(0, CACHE_WARM_BATCH_SIZE);
    if (warmTargets.length) {
      void warmTickers(supabase, warmTargets).catch(() => {});
    }
    missingTickers.forEach((ticker) => {
      errors[ticker] = "Market data is syncing.";
    });
    return NextResponse.json({ data, errors });
  }

  const refreshTickers = [...missingTickers, ...staleTickers];
  for (const ticker of refreshTickers) {
    if (!canFetchMarketData()) {
      const cached = cacheMap.get(ticker);
      if (cached?.payload) {
        data[ticker] = cached.payload;
        continue;
      }
      errors[ticker] = "Market data is syncing.";
      continue;
    }
    try {
      const metrics = await getStockMetrics(ticker, includeOverview, useDaily);
      const cached = cacheMap.get(ticker);
      const merged = mergeOverviewFields(metrics, cached?.payload ?? null);
      data[ticker] = merged;
      await supabase
        .from("market_data_snapshots")
        .upsert(
          {
            ticker,
            payload: merged,
            updated_at: new Date().toISOString(),
            has_overview: includeOverview || cached?.hasOverview || false
          },
          { onConflict: "ticker" }
        );
    } catch (error) {
      if (isRateLimitError(error)) {
        noteRateLimit(error instanceof Error ? error.message : undefined);
      }
      const cached = cacheMap.get(ticker);
      if (cached?.payload) {
        data[ticker] = cached.payload;
        continue;
      }
      errors[ticker] = "Market data is syncing.";
    }
  }

  return NextResponse.json({ data, errors });
}

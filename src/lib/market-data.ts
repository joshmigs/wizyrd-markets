type QuoteResult = {
  price: number;
  updatedAt: string | null;
};

type WeekOpenResult = {
  open: number;
  latestClose: number | null;
  latestDate: string | null;
};

type DailySeries = Record<string, { [key: string]: string }>;

const QUOTE_TTL_MS = 60 * 1000;
const OPEN_TTL_MS = 12 * 60 * 60 * 1000;

const quoteCache = new Map<string, { value: QuoteResult; cachedAt: number }>();
const openCache = new Map<string, { value: WeekOpenResult; cachedAt: number }>();

const normalizeTicker = (ticker: string) => ticker.trim().toUpperCase();

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const getProviderConfig = () => {
  const provider = (process.env.MARKET_DATA_PROVIDER ?? "alphavantage").toLowerCase();
  const apiKey =
    process.env.MARKET_DATA_API_KEY ??
    process.env.ALPHA_VANTAGE_API_KEY ??
    "";
  return { provider, apiKey };
};

const fetchAlphaVantageQuote = async (ticker: string, apiKey: string) => {
  const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(
    ticker
  )}&apikey=${encodeURIComponent(apiKey)}`;
  const response = await fetch(url, { cache: "no-store" });
  const data = (await response.json()) as {
    "Global Quote"?: Record<string, string>;
  };
  const quote = data["Global Quote"];
  if (!quote) {
    return null;
  }
  const price = Number(quote["05. price"]);
  if (!Number.isFinite(price)) {
    return null;
  }
  const updatedAt = quote["07. latest trading day"] ?? null;
  return { price, updatedAt };
};

const fetchAlphaVantageDaily = async (ticker: string, apiKey: string) => {
  const url = `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=${encodeURIComponent(
    ticker
  )}&outputsize=compact&apikey=${encodeURIComponent(apiKey)}`;
  const response = await fetch(url, { cache: "no-store" });
  const data = (await response.json()) as {
    "Time Series (Daily)"?: DailySeries;
  };
  return data["Time Series (Daily)"] ?? null;
};

const getWeekOpenFromSeries = (series: DailySeries, weekStart: string) => {
  const keys = Object.keys(series).sort();
  for (const dateKey of keys) {
    if (dateKey >= weekStart) {
      const openValue = Number(series[dateKey]["1. open"]);
      return Number.isFinite(openValue) ? openValue : null;
    }
  }
  return null;
};

const getLatestCloseFromSeries = (series: DailySeries) => {
  const keys = Object.keys(series).sort();
  const latestDate = keys[keys.length - 1] ?? null;
  if (!latestDate) {
    return { close: null, date: null };
  }
  const closeValue = Number(series[latestDate]["4. close"]);
  return {
    close: Number.isFinite(closeValue) ? closeValue : null,
    date: latestDate
  };
};

export async function getDelayedQuotes(tickers: string[]) {
  const { provider, apiKey } = getProviderConfig();
  const results = new Map<string, QuoteResult>();
  if (!apiKey) {
    return results;
  }

  for (const rawTicker of tickers) {
    const ticker = normalizeTicker(rawTicker);
    const cached = quoteCache.get(ticker);
    if (cached && Date.now() - cached.cachedAt < QUOTE_TTL_MS) {
      results.set(ticker, cached.value);
      continue;
    }

    let quote: QuoteResult | null = null;
    if (provider === "alphavantage") {
      quote = await fetchAlphaVantageQuote(ticker, apiKey);
      await sleep(250);
    }

    if (quote) {
      quoteCache.set(ticker, { value: quote, cachedAt: Date.now() });
      results.set(ticker, quote);
    }
  }

  return results;
}

export async function getWeekOpenPrices(tickers: string[], weekStart: string) {
  const { provider, apiKey } = getProviderConfig();
  const results = new Map<string, WeekOpenResult>();
  if (!apiKey) {
    return results;
  }

  for (const rawTicker of tickers) {
    const ticker = normalizeTicker(rawTicker);
    const cacheKey = `${ticker}:${weekStart}`;
    const cached = openCache.get(cacheKey);
    if (cached && Date.now() - cached.cachedAt < OPEN_TTL_MS) {
      results.set(ticker, cached.value);
      continue;
    }

    let openValue: number | null = null;
    let latestClose: number | null = null;
    let latestDate: string | null = null;
    if (provider === "alphavantage") {
      const series = await fetchAlphaVantageDaily(ticker, apiKey);
      if (series) {
        openValue = getWeekOpenFromSeries(series, weekStart);
        const latest = getLatestCloseFromSeries(series);
        latestClose = latest.close;
        latestDate = latest.date;
      }
      await sleep(250);
    }

    if (openValue !== null && Number.isFinite(openValue)) {
      const payload = { open: openValue, latestClose, latestDate };
      openCache.set(cacheKey, { value: payload, cachedAt: Date.now() });
      results.set(ticker, payload);
    }
  }

  return results;
}

type FmpProfile = {
  symbol?: string | null;
  companyName?: string | null;
  description?: string | null;
  sector?: string | null;
  industry?: string | null;
  mktCap?: number | null;
  beta?: number | null;
  pe?: number | null;
};

export type FmpNewsItem = {
  symbol?: string | null;
  title: string;
  url: string;
  publishedDate?: string | null;
  site?: string | null;
  text?: string | null;
};

const PROFILE_TTL_MS = 6 * 60 * 60 * 1000;
const NEWS_TTL_MS = 5 * 60 * 1000;

const profileCache = new Map<string, { updatedAt: number; data: FmpProfile | null }>();
const newsCache = new Map<string, { updatedAt: number; data: FmpNewsItem[] }>();

const getFmpApiKey = () => process.env.FMP_API_KEY?.trim() ?? "";

const parseNumber = (value: unknown) => {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[^0-9.-]/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const fetchFmpJson = async <T>(url: string): Promise<T | null> => {
  const result = await fetchFmpJsonWithStatus<T>(url);
  return result.data;
};

const fetchFmpJsonWithStatus = async <T>(
  url: string
): Promise<{ data: T | null; status: number | null; ok: boolean }> => {
  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
      return { data: null, status: response.status, ok: false };
    }
    const data = (await response.json()) as T;
    return { data, status: response.status, ok: true };
  } catch (_error) {
    return { data: null, status: null, ok: false };
  }
};

export const fetchFmpProfile = async (ticker: string): Promise<FmpProfile | null> => {
  const apiKey = getFmpApiKey();
  if (!apiKey) {
    return null;
  }
  const symbol = ticker.toUpperCase();
  const cached = profileCache.get(symbol);
  if (cached && Date.now() - cached.updatedAt < PROFILE_TTL_MS) {
    return cached.data;
  }
  const url = new URL(`https://financialmodelingprep.com/api/v3/profile/${symbol}`);
  url.searchParams.set("apikey", apiKey);
  const data = await fetchFmpJson<unknown>(url.toString());
  const record =
    Array.isArray(data) && data.length
      ? (data[0] as Record<string, unknown>)
      : null;
  const profile = record
    ? {
        symbol: (record.symbol as string) ?? symbol,
        companyName: (record.companyName as string) ?? null,
        description: (record.description as string) ?? null,
        sector: (record.sector as string) ?? null,
        industry: (record.industry as string) ?? null,
        mktCap: parseNumber(record.mktCap),
        beta: parseNumber(record.beta),
        pe: parseNumber(record.pe)
      }
    : null;
  profileCache.set(symbol, { updatedAt: Date.now(), data: profile });
  return profile;
};

export const fetchFmpNews = async ({
  ticker,
  limit = 8
}: {
  ticker?: string | null;
  limit?: number;
}): Promise<FmpNewsItem[]> => {
  const apiKey = getFmpApiKey();
  if (!apiKey) {
    return [];
  }
  const resolvedLimit = Math.min(20, Math.max(1, limit));
  const cacheKey = `${ticker ?? "all"}:${resolvedLimit}`;
  const cached = newsCache.get(cacheKey);
  if (cached && Date.now() - cached.updatedAt < NEWS_TTL_MS) {
    return cached.data;
  }
  const url = new URL("https://financialmodelingprep.com/api/v3/stock_news");
  if (ticker) {
    url.searchParams.set("tickers", ticker.toUpperCase());
  }
  url.searchParams.set("limit", String(resolvedLimit));
  url.searchParams.set("apikey", apiKey);
  const data = await fetchFmpJson<unknown>(url.toString());
  const items = Array.isArray(data)
    ? data
        .map((item) => {
          const record = item as Record<string, unknown>;
          const title = typeof record.title === "string" ? record.title : "";
          const urlValue = typeof record.url === "string" ? record.url : "";
          if (!title || !urlValue) {
            return null;
          }
          return {
            symbol:
              (record.symbol as string) ??
              (record.ticker as string) ??
              null,
            title,
            url: urlValue,
            publishedDate:
              typeof record.publishedDate === "string"
                ? record.publishedDate
                : null,
            site: typeof record.site === "string" ? record.site : null,
            text: typeof record.text === "string" ? record.text : null
          } as FmpNewsItem;
        })
        .filter(Boolean)
    : [];
  newsCache.set(cacheKey, { updatedAt: Date.now(), data: items });
  return items;
};

export const fetchFmpNewsWithStatus = async ({
  ticker,
  limit = 8
}: {
  ticker?: string | null;
  limit?: number;
}): Promise<{ items: FmpNewsItem[]; status: number | null; ok: boolean }> => {
  const apiKey = getFmpApiKey();
  if (!apiKey) {
    return { items: [], status: null, ok: false };
  }
  const resolvedLimit = Math.min(20, Math.max(1, limit));
  const url = new URL("https://financialmodelingprep.com/api/v3/stock_news");
  if (ticker) {
    url.searchParams.set("tickers", ticker.toUpperCase());
  }
  url.searchParams.set("limit", String(resolvedLimit));
  url.searchParams.set("apikey", apiKey);
  const { data, status, ok } = await fetchFmpJsonWithStatus<unknown>(url.toString());
  if (!ok || !Array.isArray(data)) {
    return { items: [], status, ok };
  }
  const items = data
    .map((item) => {
      const record = item as Record<string, unknown>;
      const title = typeof record.title === "string" ? record.title : "";
      const urlValue = typeof record.url === "string" ? record.url : "";
      if (!title || !urlValue) {
        return null;
      }
      return {
        symbol:
          (record.symbol as string) ??
          (record.ticker as string) ??
          null,
        title,
        url: urlValue,
        publishedDate:
          typeof record.publishedDate === "string"
            ? record.publishedDate
            : null,
        site: typeof record.site === "string" ? record.site : null,
        text: typeof record.text === "string" ? record.text : null
      } as FmpNewsItem;
    })
    .filter(Boolean);
  return { items, status, ok };
};

export type { FmpProfile };

import { NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { ALLOWED_TICKERS, getAssetName } from "@/lib/assets";

type NewsItem = {
  title: string;
  url: string;
  publishedDate?: string | null;
  site?: string | null;
  summary?: string | null;
};

type ResolvedQuery = {
  ticker: string;
  name?: string | null;
};

const NEWS_TTL_MS = 5 * 60 * 1000;
const newsCache = new Map<string, { updatedAt: number; items: NewsItem[] }>();
const googleCache = new Map<string, { updatedAt: number; items: NewsItem[] }>();
const DEFAULT_TICKER = "SPY";
const RSS_USER_AGENT = "Mozilla/5.0 (Wizyrd News)";
const GOOGLE_BASE_PARAMS = "hl=en-US&gl=US&ceid=US:en";
const GOOGLE_BUSINESS_FEED =
  "https://news.google.com/rss/headlines/section/topic/BUSINESS?hl=en-US&gl=US&ceid=US:en";

const decodeXml = (value: string) =>
  value
    .replace(/^<!\[CDATA\[/, "")
    .replace(/\]\]>$/, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");

const stripHtml = (value: string) =>
  value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

const truncate = (value: string, max = 220) => {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, Math.max(0, max - 3)).trimEnd()}...`;
};

const extractTag = (block: string, tag: string) => {
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  if (!match) {
    return null;
  }
  return decodeXml(match[1].trim());
};

const parseRssItems = (
  rssText: string,
  limit: number,
  fallbackSource: string
): NewsItem[] => {
  const blocks = rssText.match(/<item>[\s\S]*?<\/item>/gi) ?? [];
  const items: NewsItem[] = [];

  for (const block of blocks) {
    const title = extractTag(block, "title");
    const link = extractTag(block, "link");
    if (!title || !link) {
      continue;
    }
    const publishedDate = extractTag(block, "pubDate");
    const site = extractTag(block, "source") ?? fallbackSource;
    const description =
      extractTag(block, "content:encoded") ?? extractTag(block, "description");
    const summaryText = description ? stripHtml(description) : "";
    const summary = summaryText ? truncate(summaryText) : null;
    items.push({
      title,
      url: link,
      publishedDate,
      site,
      summary
    });
    if (items.length >= limit) {
      break;
    }
  }

  return items;
};

const fetchYahooNews = async (
  ticker: string,
  limit: number,
  forceRefresh = false
): Promise<NewsItem[]> => {
  const cacheKey = `${ticker}:${limit}`;
  const cached = newsCache.get(cacheKey);
  if (!forceRefresh && cached && Date.now() - cached.updatedAt < NEWS_TTL_MS) {
    return cached.items;
  }

  const url = new URL("https://feeds.finance.yahoo.com/rss/2.0/headline");
  url.searchParams.set("s", ticker);
  url.searchParams.set("region", "US");
  url.searchParams.set("lang", "en-US");

  try {
    const response = await fetch(url.toString(), {
      headers: {
        "User-Agent": RSS_USER_AGENT,
        "Accept": "application/rss+xml"
      }
    });
    if (!response.ok) {
      return [];
    }
    const rssText = await response.text();
    const items = parseRssItems(rssText, limit, "Yahoo Finance");
    newsCache.set(cacheKey, { updatedAt: Date.now(), items });
    return items;
  } catch (_error) {
    return [];
  }
};

const fetchGoogleNews = async (
  query: string | null,
  limit: number,
  forceRefresh = false
): Promise<NewsItem[]> => {
  const cacheKey = `${query ?? "top"}:${limit}`;
  const cached = googleCache.get(cacheKey);
  if (!forceRefresh && cached && Date.now() - cached.updatedAt < NEWS_TTL_MS) {
    return cached.items;
  }

  const url = query
    ? `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&${GOOGLE_BASE_PARAMS}`
    : GOOGLE_BUSINESS_FEED;

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": RSS_USER_AGENT,
        "Accept": "application/rss+xml"
      }
    });
    if (!response.ok) {
      return [];
    }
    const rssText = await response.text();
    const items = parseRssItems(rssText, limit, "Google News");
    googleCache.set(cacheKey, { updatedAt: Date.now(), items });
    return items;
  } catch (_error) {
    return [];
  }
};

const parseNewsDate = (value?: string | null) => {
  if (!value) {
    return null;
  }
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
};

const mergeNewsItems = (sources: NewsItem[][], limit: number): NewsItem[] => {
  const seen = new Set<string>();
  const merged: NewsItem[] = [];

  sources.flat().forEach((item) => {
    const key = item.url || item.title;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    merged.push(item);
  });

  merged.sort((a, b) => {
    const aTime = parseNewsDate(a.publishedDate);
    const bTime = parseNewsDate(b.publishedDate);
    if (aTime === null && bTime === null) {
      return 0;
    }
    if (aTime === null) {
      return 1;
    }
    if (bTime === null) {
      return -1;
    }
    return bTime - aTime;
  });

  return merged.slice(0, limit);
};

const normalizeTickerInput = (value: string) =>
  value.toUpperCase().replace(/[^A-Z0-9.]/g, "");

const resolveQuery = async (query: string): Promise<ResolvedQuery | null> => {
  const trimmed = query.trim();
  if (!trimmed) {
    return null;
  }
  const normalized = trimmed.toUpperCase();
  const cleanedTicker = normalizeTickerInput(trimmed);
  const isShortCandidate = cleanedTicker.length > 0 && cleanedTicker.length <= 6;
  const safeQuery = trimmed.replace(/[%,]/g, " ");

  try {
    const supabase = createSupabaseServiceClient();
    const { data: snapshot, error: snapshotError } = await supabase
      .from("asset_universe_snapshots")
      .select("id")
      .order("as_of", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!snapshotError?.code && snapshot?.id) {
      const filters = [];
      if (cleanedTicker) {
        filters.push(`ticker.ilike.${cleanedTicker}%`);
      }
      filters.push(`company_name.ilike.%${safeQuery}%`);
      const { data, error } = await supabase
        .from("asset_universe_members")
        .select("ticker, company_name")
        .eq("snapshot_id", snapshot.id)
        .or(filters.join(","))
        .limit(1);

      if (!error && data?.length) {
        const member = data[0] as { ticker: string; company_name?: string | null };
        return {
          ticker: member.ticker.toUpperCase(),
          name: member.company_name ?? null
        };
      }
    }
  } catch (_error) {
    // Fallback below.
  }

  if (isShortCandidate && !trimmed.includes(" ")) {
    return {
      ticker: cleanedTicker,
      name: ALLOWED_TICKERS.has(cleanedTicker)
        ? getAssetName(cleanedTicker) || null
        : null
    };
  }

  const lowerQuery = trimmed.toLowerCase();
  const fallback = [...ALLOWED_TICKERS].find((ticker) => {
    const name = getAssetName(ticker).toLowerCase();
    return ticker.includes(normalized) || name.includes(lowerQuery);
  });

  if (fallback) {
    return {
      ticker: fallback,
      name: getAssetName(fallback) || null
    };
  }

  return null;
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const requestedLimit = Number(searchParams.get("limit") ?? 8);
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(20, Math.max(1, requestedLimit))
    : 8;
  const forceRefresh = searchParams.has("refresh");

  const rawTicker = searchParams.get("ticker")?.trim() ?? "";
  const rawQuery = searchParams.get("q") ?? searchParams.get("query") ?? "";
  let resolved: ResolvedQuery | null = null;
  let ticker = rawTicker ? normalizeTickerInput(rawTicker) : "";

  if (!ticker && rawQuery.trim()) {
    resolved = await resolveQuery(rawQuery);
    if (!resolved) {
      return NextResponse.json(
        { error: "Couldn't match that to a ticker in the S&P 500 universe." },
        { status: 404 }
      );
    }
    ticker = resolved.ticker;
  }

  if (!ticker) {
    ticker = DEFAULT_TICKER;
  }

  const tickerName = rawTicker ? getAssetName(ticker) || resolved?.name || null : null;
  const googleQuery = rawQuery.trim()
    ? `${resolved?.name ?? ticker} stock`
    : rawTicker
      ? tickerName
        ? `${ticker} ${tickerName} stock`
        : `${ticker} stock`
      : null;

  const [yahooItems, googleItems] = await Promise.all([
    fetchYahooNews(ticker, limit, forceRefresh),
    fetchGoogleNews(googleQuery, limit, forceRefresh)
  ]);
  const news = mergeNewsItems([yahooItems, googleItems], limit);
  const label =
    resolved?.name && resolved?.ticker
      ? `${resolved.ticker} (${resolved.name})`
      : rawTicker && tickerName
        ? `${ticker} (${tickerName})`
        : resolved?.ticker ?? (rawTicker ? ticker : null);

  return NextResponse.json({ news, label });
}

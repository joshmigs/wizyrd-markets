import { NextResponse } from "next/server";

const ALPHA_VANTAGE_BASE = "https://www.alphavantage.co/query";
const WIKIDATA_ENDPOINT = "https://query.wikidata.org/sparql";
const YAHOO_PROFILE_ENDPOINT =
  "https://query1.finance.yahoo.com/v10/finance/quoteSummary";
const WEBSITE_TTL_MS = 1000 * 60 * 60 * 24;

const globalCache = globalThis as typeof globalThis & {
  websiteCache?: Map<string, { website: string | null; updatedAt: number }>;
};

const websiteCache =
  globalCache.websiteCache ??
  new Map<string, { website: string | null; updatedAt: number }>();
globalCache.websiteCache = websiteCache;

const normalizeWebsite = (value: unknown) => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
};

const USER_AGENT = "WizyrdMarkets/1.0 (website lookup)";

const fetchWebsiteFromWikidata = async (ticker: string) => {
  const query = `
    SELECT ?website WHERE {
      ?company wdt:P249 "${ticker}" .
      ?company wdt:P856 ?website .
    }
    LIMIT 1
  `;
  const url = new URL(WIKIDATA_ENDPOINT);
  url.searchParams.set("format", "json");
  url.searchParams.set("query", query);
  const response = await fetch(url.toString(), {
    headers: {
      accept: "application/sparql-results+json",
      "user-agent": USER_AGENT
    }
  });
  if (!response.ok) {
    return null;
  }
  const data = (await response.json()) as {
    results?: { bindings?: Array<{ website?: { value?: string } }> };
  };
  const value = data?.results?.bindings?.[0]?.website?.value;
  return normalizeWebsite(value);
};

const fetchWebsiteFromYahoo = async (ticker: string) => {
  const url = new URL(`${YAHOO_PROFILE_ENDPOINT}/${ticker}`);
  url.searchParams.set("modules", "assetProfile");
  const response = await fetch(url.toString(), {
    headers: {
      accept: "application/json,text/plain,*/*",
      "user-agent": USER_AGENT
    },
    cache: "no-store"
  });
  if (!response.ok) {
    return null;
  }
  const data = (await response.json()) as {
    quoteSummary?: {
      result?: Array<{ assetProfile?: { website?: string } }>;
    };
  };
  const value = data?.quoteSummary?.result?.[0]?.assetProfile?.website;
  return normalizeWebsite(value);
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const ticker = (searchParams.get("ticker") ?? "").trim().toUpperCase();

  if (!ticker) {
    return NextResponse.json({ error: "Missing ticker." }, { status: 400 });
  }

  const cached = websiteCache.get(ticker);
  if (cached && Date.now() - cached.updatedAt < WEBSITE_TTL_MS) {
    return NextResponse.json({ ticker, website: cached.website });
  }

  let website: string | null = null;

  const apiKey = process.env.MARKET_DATA_API_KEY;
  if (apiKey) {
    try {
      const url = new URL(ALPHA_VANTAGE_BASE);
      url.searchParams.set("function", "OVERVIEW");
      url.searchParams.set("symbol", ticker);
      url.searchParams.set("apikey", apiKey);
      const response = await fetch(url.toString());
      if (response.ok) {
        const data = (await response.json()) as Record<string, unknown>;
        if (!data?.Note && !data?.["Error Message"]) {
          website = normalizeWebsite(data?.Website);
        }
      }
    } catch {
      // Ignore and fall back to Wikidata.
    }
  }

  if (!website) {
    try {
      website = await fetchWebsiteFromWikidata(ticker);
    } catch {
      website = null;
    }
  }

  if (!website) {
    try {
      website = await fetchWebsiteFromYahoo(ticker);
    } catch {
      website = null;
    }
  }

  websiteCache.set(ticker, { website, updatedAt: Date.now() });
  return NextResponse.json({ ticker, website });
}

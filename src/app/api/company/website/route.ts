import { NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getAssetName } from "@/lib/assets";

const ALPHA_VANTAGE_BASE = "https://www.alphavantage.co/query";
const WIKIDATA_ENDPOINT = "https://query.wikidata.org/sparql";
const WIKIPEDIA_API = "https://en.wikipedia.org/w/api.php";
const WEBSITE_TTL_MS = 1000 * 60 * 60 * 24;
const NULL_TTL_MS = 1000 * 60 * 10;

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

const fetchCompanyName = async (ticker: string) => {
  let supabase: ReturnType<typeof createSupabaseServiceClient> | null = null;
  try {
    supabase = createSupabaseServiceClient();
  } catch {
    return normalizeWebsite(getAssetName(ticker)) ? getAssetName(ticker) : null;
  }

  const { data: snapshot } = await supabase
    .from("asset_universe_snapshots")
    .select("id")
    .order("as_of", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!snapshot?.id) {
    return getAssetName(ticker) || null;
  }

  const { data } = await supabase
    .from("asset_universe_members")
    .select("company_name")
    .eq("snapshot_id", snapshot.id)
    .eq("ticker", ticker)
    .maybeSingle();

  return data?.company_name ?? getAssetName(ticker) ?? null;
};

const fetchWikipediaTitle = async (query: string) => {
  const url = new URL(WIKIPEDIA_API);
  url.searchParams.set("action", "query");
  url.searchParams.set("list", "search");
  url.searchParams.set("srsearch", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("origin", "*");
  const response = await fetch(url.toString(), {
    headers: {
      accept: "application/json",
      "user-agent": USER_AGENT
    },
    cache: "no-store"
  });
  if (!response.ok) {
    return null;
  }
  const data = (await response.json()) as {
    query?: { search?: Array<{ title?: string }> };
  };
  const title = data?.query?.search?.[0]?.title;
  return title ?? null;
};

const fetchWikidataQid = async (title: string) => {
  const url = new URL(WIKIPEDIA_API);
  url.searchParams.set("action", "query");
  url.searchParams.set("prop", "pageprops");
  url.searchParams.set("titles", title);
  url.searchParams.set("format", "json");
  url.searchParams.set("origin", "*");
  const response = await fetch(url.toString(), {
    headers: {
      accept: "application/json",
      "user-agent": USER_AGENT
    },
    cache: "no-store"
  });
  if (!response.ok) {
    return null;
  }
  const data = (await response.json()) as {
    query?: {
      pages?: Record<string, { pageprops?: { wikibase_item?: string } }>;
    };
  };
  const pages = data?.query?.pages ?? {};
  const first = Object.values(pages)[0];
  return first?.pageprops?.wikibase_item ?? null;
};

const fetchWebsiteFromWikidataQid = async (qid: string) => {
  const query = `
    SELECT ?website WHERE {
      wd:${qid} wdt:P856 ?website .
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

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const ticker = (searchParams.get("ticker") ?? "").trim().toUpperCase();

  if (!ticker) {
    return NextResponse.json({ error: "Missing ticker." }, { status: 400 });
  }

  const cached = websiteCache.get(ticker);
  if (cached) {
    const ttl = cached.website ? WEBSITE_TTL_MS : NULL_TTL_MS;
    if (Date.now() - cached.updatedAt < ttl) {
      return NextResponse.json({ ticker, website: cached.website });
    }
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
      const companyName = await fetchCompanyName(ticker);
      if (companyName) {
        const title =
          (await fetchWikipediaTitle(companyName)) ??
          (await fetchWikipediaTitle(`${companyName} company`)) ??
          (await fetchWikipediaTitle(`${companyName} ticker ${ticker}`));
        if (title) {
          const qid = await fetchWikidataQid(title);
          if (qid) {
            website = await fetchWebsiteFromWikidataQid(qid);
          }
        }
      }
    } catch {
      website = null;
    }
  }

  websiteCache.set(ticker, { website, updatedAt: Date.now() });
  return NextResponse.json({ ticker, website });
}

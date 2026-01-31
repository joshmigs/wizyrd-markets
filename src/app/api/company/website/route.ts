import { NextResponse } from "next/server";

const ALPHA_VANTAGE_BASE = "https://www.alphavantage.co/query";
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

  const apiKey = process.env.MARKET_DATA_API_KEY;
  if (!apiKey) {
    websiteCache.set(ticker, { website: null, updatedAt: Date.now() });
    return NextResponse.json({ ticker, website: null });
  }

  try {
    const url = new URL(ALPHA_VANTAGE_BASE);
    url.searchParams.set("function", "OVERVIEW");
    url.searchParams.set("symbol", ticker);
    url.searchParams.set("apikey", apiKey);
    const response = await fetch(url.toString());
    if (!response.ok) {
      websiteCache.set(ticker, { website: null, updatedAt: Date.now() });
      return NextResponse.json({ ticker, website: null });
    }
    const data = (await response.json()) as Record<string, unknown>;
    const website = normalizeWebsite(data?.Website);
    websiteCache.set(ticker, { website, updatedAt: Date.now() });
    return NextResponse.json({ ticker, website });
  } catch {
    websiteCache.set(ticker, { website: null, updatedAt: Date.now() });
    return NextResponse.json({ ticker, website: null });
  }
}

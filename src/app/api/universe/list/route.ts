import { NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { ALLOWED_TICKERS, getAssetName } from "@/lib/assets";

type UniverseResult = {
  ticker: string;
  company_name: string | null;
  sector: string | null;
  industry?: string | null;
};

const BENCHMARK_ENTRY: UniverseResult = {
  ticker: "SPY",
  company_name: "S&P 500 Index",
  sector: "Benchmark",
  industry: "Index"
};

const CACHE_TTL_MS = 30_000;
let cachedUniverse: { timestamp: number; payload: unknown } | null = null;

const withBenchmark = (rows: UniverseResult[]) => {
  const filtered = rows
    .filter((row) => row.ticker !== BENCHMARK_ENTRY.ticker)
    .sort((a, b) => a.ticker.localeCompare(b.ticker));
  return [BENCHMARK_ENTRY, ...filtered];
};

export async function GET() {
  if (cachedUniverse && Date.now() - cachedUniverse.timestamp < CACHE_TTL_MS) {
    return NextResponse.json(cachedUniverse.payload);
  }
  let supabase: ReturnType<typeof createSupabaseServiceClient> | null = null;

  try {
    supabase = createSupabaseServiceClient();
  } catch (_error) {
    const fallback = [...ALLOWED_TICKERS]
      .map((ticker) => ({
        ticker,
        company_name: getAssetName(ticker) || null,
        sector: null,
        industry: null
      }));
    const payload = { results: withBenchmark(fallback) };
    cachedUniverse = { timestamp: Date.now(), payload };
    return NextResponse.json(payload);
  }

  const { data: snapshot, error: snapshotError } = await supabase
    .from("asset_universe_snapshots")
    .select("id")
    .order("as_of", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (snapshotError || !snapshot?.id) {
    const fallback = [...ALLOWED_TICKERS]
      .map((ticker) => ({
        ticker,
        company_name: getAssetName(ticker) || null,
        sector: null,
        industry: null
      }));
    const payload = { results: withBenchmark(fallback) };
    cachedUniverse = { timestamp: Date.now(), payload };
    return NextResponse.json(payload);
  }

  const runQuery = (columns: string) =>
    supabase
      .from("asset_universe_members")
      .select(columns)
      .eq("snapshot_id", snapshot.id)
      .order("ticker", { ascending: true })
      .limit(1000);

  let data: UniverseResult[] | null = null;
  let error = null;

  ({ data, error } = await runQuery("ticker, company_name, sector, industry"));
  if (error?.code === "42703") {
    ({ data, error } = await runQuery("ticker, company_name, sector"));
  }

  if (error) {
    const fallback = [...ALLOWED_TICKERS]
      .map((ticker) => ({
        ticker,
        company_name: getAssetName(ticker) || null,
        sector: null,
        industry: null
      }));
    const payload = { results: withBenchmark(fallback) };
    cachedUniverse = { timestamp: Date.now(), payload };
    return NextResponse.json(payload);
  }

  const payload = { results: withBenchmark(data ?? []) };
  cachedUniverse = { timestamp: Date.now(), payload };
  return NextResponse.json(payload);
}

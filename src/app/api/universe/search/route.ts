import { NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { ALLOWED_TICKERS, getAssetName } from "@/lib/assets";

type SearchResult = {
  ticker: string;
  company_name: string | null;
  sector: string | null;
  industry?: string | null;
};

const sortResults = (results: SearchResult[]) => {
  const sorted = [...results].sort((a, b) => a.ticker.localeCompare(b.ticker));
  const spyIndex = sorted.findIndex((row) => row.ticker === "SPY");
  if (spyIndex > 0) {
    const [spy] = sorted.splice(spyIndex, 1);
    sorted.unshift(spy);
  }
  return sorted;
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = (searchParams.get("query") ?? "").trim();

  if (!query) {
    return NextResponse.json({ results: [] });
  }

  const normalized = query.toUpperCase();
  const lowerQuery = query.toLowerCase();
  let supabase: ReturnType<typeof createSupabaseServiceClient> | null = null;

  try {
    supabase = createSupabaseServiceClient();
  } catch (_error) {
    const fallback = [...ALLOWED_TICKERS]
      .filter((ticker) => {
        const name = getAssetName(ticker).toLowerCase();
        return ticker.includes(normalized) || name.includes(lowerQuery);
      })
      .slice(0, 8)
      .map(
        (ticker) =>
          ({
            ticker,
            company_name: getAssetName(ticker) || null,
            sector: null,
            industry: null
          }) as SearchResult
      );
    return NextResponse.json({ results: sortResults(fallback) });
  }

  const { data: snapshot, error: snapshotError } = await supabase
    .from("asset_universe_snapshots")
    .select("id")
    .order("as_of", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (snapshotError?.code === "42P01") {
    const fallback = [...ALLOWED_TICKERS]
      .filter((ticker) => {
        const name = getAssetName(ticker).toLowerCase();
        return ticker.includes(normalized) || name.includes(lowerQuery);
      })
      .slice(0, 8)
      .map(
        (ticker) =>
          ({
            ticker,
            company_name: getAssetName(ticker) || null,
            sector: null,
            industry: null
          }) as SearchResult
      );
    return NextResponse.json({ results: sortResults(fallback) });
  }

  if (snapshot?.id) {
    const runQuery = (columns: string) =>
      supabase
        .from("asset_universe_members")
        .select(columns)
        .eq("snapshot_id", snapshot.id)
        .or(`ticker.ilike.${normalized}%,company_name.ilike.%${query}%`)
        .order("ticker", { ascending: true })
        .limit(8);

    let data;
    let error;
    ({ data, error } = await runQuery("ticker, company_name, sector, industry"));

    if (error?.code === "42703") {
      ({ data, error } = await runQuery("ticker, company_name, sector"));
    }

    if (error) {
      if (error.code === "42P01") {
        const fallback = [...ALLOWED_TICKERS]
          .filter((ticker) => {
            const name = getAssetName(ticker).toLowerCase();
            return ticker.includes(normalized) || name.includes(lowerQuery);
          })
          .slice(0, 8)
          .map(
            (ticker) =>
              ({
                ticker,
                company_name: getAssetName(ticker) || null,
                sector: null,
                industry: null
              }) as SearchResult
          );
        return NextResponse.json({ results: sortResults(fallback) });
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ results: sortResults((data ?? []) as SearchResult[]) });
  }

  const fallback = [...ALLOWED_TICKERS]
    .filter((ticker) => {
      const name = getAssetName(ticker).toLowerCase();
      return ticker.includes(normalized) || name.includes(lowerQuery);
    })
    .slice(0, 8)
    .map(
      (ticker) =>
        ({
          ticker,
          company_name: getAssetName(ticker) || null,
          sector: null,
          industry: null
        }) as SearchResult
    );

  return NextResponse.json({ results: sortResults(fallback) });
}

import { NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

type UniverseEntry = {
  ticker: string;
  companyName: string;
  sector: string;
  industry: string;
};

const WIKI_URL =
  "https://en.wikipedia.org/wiki/List_of_S%26P_500_companies";

const decodeHtml = (value: string) =>
  value
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&#160;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();

const stripTags = (value: string) => decodeHtml(value.replace(/<[^>]+>/g, ""));

const extractEntries = (html: string): UniverseEntry[] => {
  const tableMatch = html.match(
    /<table[^>]*id="constituents"[^>]*>([\s\S]*?)<\/table>/i
  );
  if (!tableMatch) {
    return [];
  }

  const tableHtml = tableMatch[1];
  const rows = tableHtml.match(/<tr[\s\S]*?<\/tr>/gi) ?? [];

  const entries: UniverseEntry[] = [];
  for (const row of rows) {
    const cells = row.match(/<td[\s\S]*?<\/td>/gi);
    if (!cells || cells.length < 3) {
      continue;
    }

    const ticker = stripTags(cells[0]).replace(/\s+/g, "");
    const companyName = stripTags(cells[1]);
    const sector = stripTags(cells[2]);
    const industry = cells[3] ? stripTags(cells[3]) : "";

    if (!ticker) {
      continue;
    }

    entries.push({
      ticker: ticker.toUpperCase(),
      companyName,
      sector,
      industry
    });
  }

  return entries;
};

const handleSync = async (request: Request) => {
  const secret = process.env.UNIVERSE_SYNC_SECRET;
  if (secret) {
    const headerSecret = request.headers.get("x-sync-secret");
    const { searchParams } = new URL(request.url);
    const querySecret = searchParams.get("secret");
    if (headerSecret !== secret && querySecret !== secret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const response = await fetch(WIKI_URL, {
    headers: {
      "User-Agent": "WizyrdUniverseSync/1.0"
    }
  });

  if (!response.ok) {
    return NextResponse.json(
      { error: `Failed to fetch Wikipedia (${response.status})` },
      { status: 502 }
    );
  }

  const html = await response.text();
  const entries = extractEntries(html);

  if (!entries.length) {
    return NextResponse.json(
      { error: "No tickers found in Wikipedia response." },
      { status: 500 }
    );
  }

  const supabase = createSupabaseServiceClient();
  const now = new Date().toISOString();

  const { data: snapshot, error: snapshotError } = await supabase
    .from("asset_universe_snapshots")
    .insert({ source: "wikipedia", as_of: now })
    .select("id")
    .single();

  if (snapshotError || !snapshot) {
    return NextResponse.json({ error: snapshotError?.message }, { status: 500 });
  }

  const members = entries.map((entry) => ({
    snapshot_id: snapshot.id,
    ticker: entry.ticker,
    company_name: entry.companyName,
    sector: entry.sector,
    industry: entry.industry || null
  }));

  let { error: membersError } = await supabase
    .from("asset_universe_members")
    .insert(members);

  if (membersError?.code === "42703") {
    const fallbackMembers = entries.map((entry) => ({
      snapshot_id: snapshot.id,
      ticker: entry.ticker,
      company_name: entry.companyName,
      sector: entry.sector
    }));
    ({ error: membersError } = await supabase
      .from("asset_universe_members")
      .insert(fallbackMembers));
  }

  if (membersError) {
    return NextResponse.json({ error: membersError.message }, { status: 500 });
  }

  await supabase
    .from("weeks")
    .update({ universe_snapshot_id: snapshot.id })
    .is("universe_snapshot_id", null)
    .gte("lock_time", now);

  return NextResponse.json({
    snapshotId: snapshot.id,
    count: members.length,
    asOf: now
  });
};

export async function POST(request: Request) {
  return handleSync(request);
}

export async function GET(request: Request) {
  return handleSync(request);
}

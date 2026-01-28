import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getEtDayEnd, getEtDayStart } from "@/lib/time";

type LeagueRow = {
  id: string;
  name: string;
};

type WeekRow = {
  id: string;
  week_start: string;
  week_end: string;
  lock_time: string;
  universe_snapshot_id?: string | null;
};

type MemberRow = {
  ticker: string;
  company_name: string | null;
  sector: string | null;
  industry: string | null;
};

type SnapshotRow = {
  ticker: string;
  payload: { lastPrice?: number | null; asOf?: string | null } | null;
  updated_at?: string | null;
};

export async function GET(request: Request) {
  const { user, error, status } = await getAuthenticatedUser(request);
  if (!user) {
    return NextResponse.json({ error }, { status });
  }

  const { searchParams } = new URL(request.url);
  const requestedLeagueId = searchParams.get("leagueId");
  const requestedWeekId = searchParams.get("weekId");

  const supabase = createSupabaseServiceClient();
  const { data: membership, error: membershipError } = await supabase
    .from("league_members")
    .select("league_id, joined_at, leagues(id, name)")
    .eq("user_id", user.id);

  if (membershipError) {
    return NextResponse.json({ error: membershipError.message }, { status: 500 });
  }

  const membershipRows = (membership ?? []) as {
    league_id: string;
    joined_at: string;
    leagues: LeagueRow | null;
  }[];

  const leagues = membershipRows
    .map((row) => row.leagues)
    .filter(Boolean) as LeagueRow[];

  if (requestedLeagueId && !leagues.find((league) => league.id === requestedLeagueId)) {
    return NextResponse.json(
      { error: "Not a member of this league." },
      { status: 403 }
    );
  }

  const activeLeagueId = requestedLeagueId ?? leagues[0]?.id ?? null;
  const joinedAtByLeague = new Map(
    membershipRows.map((row) => [row.league_id, row.joined_at])
  );

  if (!activeLeagueId) {
    return NextResponse.json({ leagues, weeks: [], week: null, lineup: null });
  }

  const { data: weeks, error: weeksError } = await supabase
    .from("weeks")
    .select("id, week_start, week_end, lock_time, universe_snapshot_id")
    .eq("league_id", activeLeagueId)
    .order("week_start", { ascending: true });

  if (weeksError) {
    return NextResponse.json({ error: weeksError.message }, { status: 500 });
  }

  const weekList = (weeks ?? []) as WeekRow[];
  if (weekList.length === 0) {
    return NextResponse.json({ leagues, weeks: [], week: null, lineup: null });
  }

  let selectedWeek =
    requestedWeekId != null
      ? weekList.find((entry) => entry.id === requestedWeekId) ?? null
      : null;

  if (requestedWeekId && !selectedWeek) {
    return NextResponse.json({ error: "Week not found for this league." }, { status: 404 });
  }

  if (!selectedWeek) {
    const now = new Date();
    const nowTime = now.getTime();
    selectedWeek =
      weekList.find((entry) => {
        const start = getEtDayStart(entry.week_start);
        const end = getEtDayEnd(entry.week_end);
        if (start === null || end === null) {
          return false;
        }
        return nowTime >= start && nowTime <= end;
      }) ??
      weekList.find((entry) => {
        const end = getEtDayEnd(entry.week_end);
        return end !== null && end >= nowTime;
      }) ??
      weekList[weekList.length - 1] ??
      null;
  }

  if (!selectedWeek) {
    return NextResponse.json({ leagues, weeks: weekList, week: null, lineup: null });
  }

  const { data: lineup, error: lineupError } = await supabase
    .from("lineups")
    .select("id, submitted_at, user_locked_at")
    .eq("league_id", activeLeagueId)
    .eq("week_id", selectedWeek.id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (lineupError) {
    return NextResponse.json({ error: lineupError.message }, { status: 500 });
  }

  if (!lineup) {
    return NextResponse.json({ leagues, weeks: weekList, week: selectedWeek, lineup: null });
  }

  const joinedAt = joinedAtByLeague.get(activeLeagueId);
  if (joinedAt) {
    const joinedTime = new Date(joinedAt).getTime();
    const lineupTime = new Date(lineup.submitted_at).getTime();
    if (Number.isFinite(joinedTime) && Number.isFinite(lineupTime)) {
      if (lineupTime < joinedTime) {
        return NextResponse.json({
          leagues,
          weeks: weekList,
          week: selectedWeek,
          lineup: null
        });
      }
    }
  }

  const { data: positions, error: positionsError } = await supabase
    .from("lineup_positions")
    .select("ticker, weight")
    .eq("lineup_id", lineup.id);

  if (positionsError) {
    return NextResponse.json({ error: positionsError.message }, { status: 500 });
  }

  const tickers = (positions ?? [])
    .map((position) => position.ticker.toUpperCase())
    .filter(Boolean);
  let members: MemberRow[] = [];
  if (tickers.length) {
    let snapshotId = selectedWeek.universe_snapshot_id ?? null;
    if (!snapshotId) {
      const { data: snapshot } = await supabase
        .from("asset_universe_snapshots")
        .select("id")
        .order("as_of", { ascending: false })
        .limit(1)
        .maybeSingle();
      snapshotId = snapshot?.id ?? null;
    }
    if (snapshotId) {
      const { data: memberRows } = await supabase
        .from("asset_universe_members")
        .select("ticker, company_name, sector, industry")
        .eq("snapshot_id", snapshotId)
        .in("ticker", tickers);
      members = (memberRows ?? []) as MemberRow[];
    }
  }
  const memberByTicker = new Map(
    members.map((member) => [member.ticker.toUpperCase(), member])
  );
  let priceAsOf: string | null = null;
  const priceByTicker = new Map<
    string,
    { lastPrice: number | null; asOf: string | null }
  >();
  if (tickers.length) {
    const { data: snapshots } = await supabase
      .from("market_data_snapshots")
      .select("ticker, payload, updated_at")
      .in("ticker", tickers);
    (snapshots ?? []).forEach((row) => {
      const typed = row as SnapshotRow;
      const ticker = typed.ticker?.toUpperCase();
      if (!ticker) {
        return;
      }
      const asOf = typed.payload?.asOf ?? typed.updated_at ?? null;
      priceByTicker.set(ticker, {
        lastPrice: typed.payload?.lastPrice ?? null,
        asOf
      });
    });
    const asOfValues = Array.from(priceByTicker.values())
      .map((entry) => entry.asOf)
      .filter(Boolean) as string[];
    if (asOfValues.length) {
      priceAsOf = asOfValues.sort().pop() ?? null;
    }
  }

  const weekEnd = getEtDayEnd(selectedWeek.week_end);
  if (weekEnd !== null && weekEnd < Date.now()) {
    priceAsOf = selectedWeek.lock_time ?? priceAsOf;
  }

  const enrichedPositions = (positions ?? []).map((position) => {
    const meta = memberByTicker.get(position.ticker.toUpperCase()) ?? null;
    const priceEntry = priceByTicker.get(position.ticker.toUpperCase());
    return {
      ticker: position.ticker,
      weight: Number(position.weight),
      company_name: meta?.company_name ?? null,
      sector: meta?.sector ?? null,
      industry: meta?.industry ?? null,
      last_price: priceEntry?.lastPrice ?? null,
      price_as_of: priceEntry?.asOf ?? null
    };
  });

  return NextResponse.json({
    leagues,
    weeks: weekList,
    week: selectedWeek,
    price_as_of: priceAsOf,
    lineup: {
      ...lineup,
      positions: enrichedPositions
    }
  });
}

import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { buildMatchupsForWeek } from "@/lib/matchups";
import { DEFAULT_BENCHMARK_TICKER, ensureBenchmarkUser } from "@/lib/benchmark";
import { scoreWeekIfReady } from "@/lib/scoring-runner";
import { getDelayedQuotes, getWeekOpenPrices } from "@/lib/market-data";
import { getEtDayEnd, getEtDayStart } from "@/lib/time";

type LiveBreakdown = {
  positions: { ticker: string; weight: number; wtd_return: number | null }[];
  total: number | null;
  missing: string[];
};

type PositionRow = {
  ticker: string;
  weight: number;
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

  const supabase = createSupabaseServiceClient();
  const { searchParams } = new URL(request.url);
  const leagueId = searchParams.get("leagueId");
  const weekId = searchParams.get("weekId");

  let activeLeagueId = leagueId ?? null;

  if (activeLeagueId) {
    const { data: membership } = await supabase
      .from("league_members")
      .select("league_id")
      .eq("league_id", activeLeagueId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!membership) {
      return NextResponse.json(
        { error: "Not a member of this league." },
        { status: 403 }
      );
    }
  } else {
    const { data: membership } = await supabase
      .from("league_members")
      .select("league_id")
      .eq("user_id", user.id)
      .limit(1);

    if (!membership || membership.length === 0) {
      return NextResponse.json({ league: null, matchup: null, week: null });
    }

    activeLeagueId = membership[0].league_id;
  }

  const { data: league, error: leagueError } = await supabase
    .from("leagues")
    .select("id, name")
    .eq("id", activeLeagueId)
    .maybeSingle();

  if (leagueError) {
    return NextResponse.json({ error: leagueError.message }, { status: 500 });
  }

  const { data: weeks, error: weeksError } = await supabase
    .from("weeks")
    .select("id, week_start, week_end, lock_time")
    .eq("league_id", activeLeagueId)
    .order("week_start", { ascending: true });

  if (weeksError) {
    return NextResponse.json({ error: weeksError.message }, { status: 500 });
  }

  const weekList = (weeks ??
    []) as { id: string; week_start: string; week_end: string; lock_time: string }[];
  const now = new Date();
  const selectedWeek = weekId
    ? weekList.find((item) => item.id === weekId) ?? null
    : weekList.find((item) => {
        const start = getEtDayStart(item.week_start);
        const end = getEtDayEnd(item.week_end);
        if (start === null || end === null) {
          return false;
        }
        const nowTime = now.getTime();
        return nowTime >= start && nowTime <= end;
      }) ??
      weekList.find((item) => {
        const end = getEtDayEnd(item.week_end);
        return end !== null && end >= now.getTime();
      }) ??
      weekList[weekList.length - 1] ??
      null;

  if (!selectedWeek) {
    return NextResponse.json({ league, matchup: null, week: null, weeks: weekList });
  }

  const { data: existingMatchups, error: matchupsError } = await supabase
    .from("matchups")
    .select("id, home_user_id, away_user_id")
    .eq("week_id", selectedWeek.id);

  if (matchupsError) {
    return NextResponse.json({ error: matchupsError.message }, { status: 500 });
  }

  const { data: members, error: membersError } = await supabase
    .from("league_members")
    .select("user_id")
    .eq("league_id", activeLeagueId);

  if (membersError) {
    return NextResponse.json({ error: membersError.message }, { status: 500 });
  }

  const memberIds = (members ?? []).map((member) => member.user_id);
  const { userId: benchmarkUserId, error: benchmarkError } =
    await ensureBenchmarkUser(supabase);
  if (!benchmarkUserId && benchmarkError && memberIds.length % 2 === 1) {
    return NextResponse.json({ error: benchmarkError }, { status: 500 });
  }
  const participants = new Set<string>();
  (existingMatchups ?? []).forEach((matchup) => {
    participants.add(matchup.home_user_id);
    participants.add(matchup.away_user_id);
  });

  const participantsReal = new Set(
    [...participants].filter((id) => id !== benchmarkUserId)
  );
  const extraParticipants = [...participantsReal].filter(
    (id) => !memberIds.includes(id)
  );
  const scheduleMemberIds = extraParticipants.length
    ? [...new Set([...memberIds, ...extraParticipants])]
    : memberIds;
  const scheduleNeedsBenchmark = scheduleMemberIds.length % 2 === 1;
  const expectedMatchups =
    scheduleNeedsBenchmark && benchmarkUserId
      ? Math.ceil(scheduleMemberIds.length / 2)
      : Math.floor(scheduleMemberIds.length / 2);
  const missingCount = scheduleMemberIds.filter(
    (id) => !participantsReal.has(id)
  ).length;
  const maxMissing = scheduleNeedsBenchmark && !benchmarkUserId ? 1 : 0;
  const hasDuplicateEntries =
    participants.size !== (existingMatchups ?? []).length * 2;
  const beforeLock = new Date(selectedWeek.lock_time).getTime() > now.getTime();
  const needsSchedule =
    beforeLock &&
    ((existingMatchups ?? []).length !== expectedMatchups ||
      missingCount > maxMissing ||
      hasDuplicateEntries);

  if (needsSchedule) {
    const { data: history, error: historyError } = await supabase
      .from("matchups")
      .select("home_user_id, away_user_id, week_id")
      .eq("league_id", activeLeagueId)
      .neq("week_id", selectedWeek.id);

    if (historyError) {
      return NextResponse.json({ error: historyError.message }, { status: 500 });
    }

    await supabase.from("matchups").delete().eq("week_id", selectedWeek.id);

    const pairs = buildMatchupsForWeek(
      scheduleMemberIds,
      (history ?? []).map((row) => ({
        home_user_id: row.home_user_id,
        away_user_id: row.away_user_id
      })),
      selectedWeek.id,
      benchmarkUserId
    );

    if (pairs.length) {
      const { error: insertError } = await supabase
        .from("matchups")
        .insert(
          pairs.map((pair) => ({
            league_id: activeLeagueId,
            week_id: selectedWeek.id,
            home_user_id: pair.home_user_id,
            away_user_id: pair.away_user_id
          }))
        );

      if (insertError) {
        return NextResponse.json({ error: insertError.message }, { status: 500 });
      }
    }
  }

  await scoreWeekIfReady({
    supabase,
    leagueId: activeLeagueId,
    weekId: selectedWeek.id,
    weekEnd: selectedWeek.week_end
  });

  const { data: matchup, error: matchupError } = await supabase
    .from("matchups")
    .select("id, home_user_id, away_user_id, home_score, away_score")
    .eq("week_id", selectedWeek.id)
    .or(`home_user_id.eq.${user.id},away_user_id.eq.${user.id}`)
    .limit(1)
    .maybeSingle();

  if (matchupError) {
    return NextResponse.json({ error: matchupError.message }, { status: 500 });
  }

  if (!matchup) {
    return NextResponse.json({ league, matchup: null, week: selectedWeek, weeks: weekList });
  }

  const { data: profiles, error: profileError } = await supabase
    .from("profiles")
    .select("id, display_name, team_logo_url")
    .in("id", [matchup.home_user_id, matchup.away_user_id]);

  if (profileError) {
    return NextResponse.json({ error: profileError.message }, { status: 500 });
  }

  const homeProfile =
    profiles?.find((profile) => profile.id === matchup.home_user_id) ?? null;
  const awayProfile =
    profiles?.find((profile) => profile.id === matchup.away_user_id) ?? null;

  const viewerIsHome = matchup.home_user_id === user.id;
  const lockTime = new Date(selectedWeek.lock_time).getTime();
  const canViewOpponent = now.getTime() >= lockTime;

  const getPositions = async (userId: string) => {
    if (benchmarkUserId && userId === benchmarkUserId) {
      return [{ ticker: DEFAULT_BENCHMARK_TICKER, weight: 1 }];
    }

    const { data: lineup } = await supabase
      .from("lineups")
      .select("id")
      .eq("week_id", selectedWeek.id)
      .eq("user_id", userId)
      .maybeSingle();

    if (!lineup) {
      return [];
    }

    const { data: positions } = await supabase
      .from("lineup_positions")
      .select("ticker, weight")
      .eq("lineup_id", lineup.id);

    return (positions ?? []).map((position) => ({
      ticker: position.ticker,
      weight: Number(position.weight)
    }));
  };

  const [homePositions, awayPositions] = await Promise.all([
    getPositions(matchup.home_user_id),
    getPositions(matchup.away_user_id)
  ]);

  const allLineupTickers = Array.from(
    new Set(
      [...homePositions, ...awayPositions].map((position) =>
        position.ticker.toUpperCase()
      )
    )
  );
  const priceByTicker = new Map<
    string,
    { lastPrice: number | null; asOf: string | null }
  >();
  let priceAsOf: string | null = null;
  if (allLineupTickers.length) {
    const { data: snapshots } = await supabase
      .from("market_data_snapshots")
      .select("ticker, payload, updated_at")
      .in("ticker", allLineupTickers);
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

  const weekStartTime = getEtDayStart(selectedWeek.week_start) ?? 0;
  const weekEndTime = getEtDayEnd(selectedWeek.week_end) ?? 0;
  const nowTime = now.getTime();
  const isLiveWeek = nowTime >= weekStartTime && nowTime <= weekEndTime;

  let liveHomeScore: number | null = null;
  let liveAwayScore: number | null = null;
  let liveUpdatedAt: string | null = null;
  let liveStatus: "delayed" | "unavailable" | "final" = "unavailable";
  let liveBreakdown: { home: LiveBreakdown; away: LiveBreakdown } | null = null;

  const buildHistoricalBreakdown = (
    positions: PositionRow[],
    priceMap: Map<string, { monday_open: number; friday_close: number }>
  ): LiveBreakdown => {
    const missing: string[] = [];
    let totalReturn = 0;
    let hasMissing = false;
    const positionsWithReturn = positions.map((position) => {
      const ticker = position.ticker.toUpperCase();
      const prices = priceMap.get(ticker);
      if (!prices) {
        missing.push(ticker);
        hasMissing = true;
        return { ticker: position.ticker, weight: position.weight, wtd_return: null };
      }
      const value = prices.friday_close / prices.monday_open - 1;
      totalReturn += position.weight * value;
      return { ticker: position.ticker, weight: position.weight, wtd_return: value };
    });
    return {
      positions: positionsWithReturn,
      total: hasMissing ? null : totalReturn,
      missing
    };
  };

  if (isLiveWeek) {
    const allTickers = Array.from(
      new Set(
        [...homePositions, ...awayPositions].map((position) =>
          position.ticker.toUpperCase()
        )
      )
    );
    const [quotes, opens] = await Promise.all([
      getDelayedQuotes(allTickers),
      getWeekOpenPrices(allTickers, selectedWeek.week_start)
    ]);
    const fetchedAt = new Date().toISOString();

    const buildBreakdown = (positions: PositionRow[]): LiveBreakdown => {
      const missing: string[] = [];
      let totalReturn = 0;
      let hasMissing = false;
      const positionsWithReturn = positions.map((position) => {
        const ticker = position.ticker.toUpperCase();
        const quote = quotes.get(ticker);
        const openEntry = opens.get(ticker);
        const open = openEntry?.open;
        const price = quote?.price ?? openEntry?.latestClose ?? null;
        if (!openEntry || open === undefined || price === null) {
          missing.push(ticker);
          hasMissing = true;
          return { ticker: position.ticker, weight: position.weight, wtd_return: null };
        }
        const value = price / open - 1;
        totalReturn += position.weight * value;
        return { ticker: position.ticker, weight: position.weight, wtd_return: value };
      });

      return {
        positions: positionsWithReturn,
        total: hasMissing ? null : totalReturn,
        missing
      };
    };

    const homeLive = homePositions.length
      ? buildBreakdown(homePositions)
      : { positions: [], total: null, missing: [] };
    const awayLive = awayPositions.length
      ? buildBreakdown(awayPositions)
      : { positions: [], total: null, missing: [] };

    liveHomeScore = homeLive.total;
    liveAwayScore = awayLive.total;
    liveUpdatedAt = fetchedAt;
    const hasLiveData =
      homeLive.positions.some((entry) => entry.wtd_return !== null) ||
      awayLive.positions.some((entry) => entry.wtd_return !== null);
    if (liveHomeScore !== null || liveAwayScore !== null || hasLiveData) {
      liveStatus = "delayed";
    }
    liveBreakdown = { home: homeLive, away: awayLive };
  } else if (nowTime > weekEndTime) {
    const allTickers = Array.from(
      new Set(
        [...homePositions, ...awayPositions].map((position) =>
          position.ticker.toUpperCase()
        )
      )
    );
    const { data: weeklyPrices } = allTickers.length
      ? await supabase
          .from("weekly_prices")
          .select("ticker, monday_open, friday_close")
          .eq("week_id", selectedWeek.id)
          .in("ticker", allTickers)
      : { data: [] };
    const priceMap = new Map(
      (weeklyPrices ?? []).map((row) => [
        row.ticker.toUpperCase(),
        {
          monday_open: Number(row.monday_open),
          friday_close: Number(row.friday_close)
        }
      ])
    );

    liveBreakdown = {
      home: buildHistoricalBreakdown(homePositions, priceMap),
      away: buildHistoricalBreakdown(awayPositions, priceMap)
    };
    liveStatus = "final";
  }

  if (weekEndTime && nowTime > weekEndTime) {
    priceAsOf = selectedWeek.lock_time ?? priceAsOf;
  }

  const enrichPositions = (positions: PositionRow[]) =>
    positions.map((position) => {
      const entry = priceByTicker.get(position.ticker.toUpperCase());
      return {
        ...position,
        last_price: entry?.lastPrice ?? null,
        price_as_of: entry?.asOf ?? null
      };
    });

  const homeWithPrice = enrichPositions(homePositions);
  const awayWithPrice = enrichPositions(awayPositions);

  return NextResponse.json({
    league,
    week: selectedWeek,
    matchup,
    homeProfile,
    awayProfile,
    lineups: {
      home: viewerIsHome || canViewOpponent ? homeWithPrice : [],
      away: !viewerIsHome || canViewOpponent ? awayWithPrice : [],
      viewer_is_home: viewerIsHome,
      can_view_opponent: canViewOpponent
    },
    price_as_of: priceAsOf,
    weeks: weekList,
    live: {
      home_score: liveHomeScore,
      away_score: liveAwayScore,
      updated_at: liveUpdatedAt,
      status: liveStatus
    },
    live_breakdown: liveBreakdown
  });
}

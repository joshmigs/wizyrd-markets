import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { calculateWeeklyReturn, scoreMatchup } from "@/lib/scoring";
import { DEFAULT_BENCHMARK_TICKER, ensureBenchmarkUser } from "@/lib/benchmark";

export async function POST(request: Request) {
  const { user, error, status } = await getAuthenticatedUser(request);
  if (!user) {
    return NextResponse.json({ error }, { status });
  }

  const body = await request.json().catch(() => null);
  const leagueId = body?.leagueId;
  const weekId = body?.weekId;

  if (!leagueId || !weekId) {
    return NextResponse.json({ error: "League and week are required." }, { status: 400 });
  }

  const supabase = createSupabaseServiceClient();

  const { data: membership } = await supabase
    .from("league_members")
    .select("league_id")
    .eq("league_id", leagueId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!membership) {
    return NextResponse.json({ error: "Not a member of this league." }, { status: 403 });
  }

  const { data: lineups, error: lineupError } = await supabase
    .from("lineups")
    .select("id, user_id")
    .eq("league_id", leagueId)
    .eq("week_id", weekId);

  if (lineupError || !lineups) {
    return NextResponse.json({ error: lineupError?.message }, { status: 500 });
  }

  const lineupIds = lineups.map((lineup) => lineup.id);
  if (lineupIds.length === 0) {
    return NextResponse.json({ error: "No lineups found." }, { status: 400 });
  }

  const { data: positions, error: positionsError } = await supabase
    .from("lineup_positions")
    .select("lineup_id, ticker, weight")
    .in("lineup_id", lineupIds);

  if (positionsError || !positions) {
    return NextResponse.json({ error: positionsError?.message }, { status: 500 });
  }

  const { data: prices, error: pricesError } = await supabase
    .from("weekly_prices")
    .select("ticker, monday_open, friday_close")
    .eq("week_id", weekId);

  if (pricesError || !prices) {
    return NextResponse.json({ error: pricesError?.message }, { status: 500 });
  }

  const priceMap = new Map(
    prices.map((price) => [price.ticker.toUpperCase(), {
      ticker: price.ticker,
      mondayOpen: Number(price.monday_open),
      fridayClose: Number(price.friday_close)
    }])
  );

  const { userId: benchmarkUserId } = await ensureBenchmarkUser(supabase);
  const benchmarkPrice = priceMap.get(DEFAULT_BENCHMARK_TICKER);
  const benchmarkReturn = benchmarkPrice
    ? benchmarkPrice.fridayClose / benchmarkPrice.mondayOpen - 1
    : null;

  const { data: activeMembers, error: activeMembersError } = await supabase
    .from("league_members")
    .select("user_id")
    .eq("league_id", leagueId);

  if (activeMembersError) {
    return NextResponse.json({ error: activeMembersError.message }, { status: 500 });
  }

  const activeMemberIds = new Set(
    (activeMembers ?? []).map((member) => member.user_id)
  );
  if (benchmarkUserId) {
    activeMemberIds.add(benchmarkUserId);
  }

  const resolveForfeitWinner = (homeUserId: string, awayUserId: string) => {
    const homeActive = activeMemberIds.has(homeUserId);
    const awayActive = activeMemberIds.has(awayUserId);
    if (homeActive === awayActive) {
      return null;
    }
    return homeActive ? homeUserId : awayUserId;
  };

  const positionsByLineup = new Map<string, { ticker: string; weight: number }[]>();
  for (const position of positions) {
    const list = positionsByLineup.get(position.lineup_id) ?? [];
    list.push({ ticker: position.ticker, weight: Number(position.weight) });
    positionsByLineup.set(position.lineup_id, list);
  }

  const lineupReturnByUser = new Map<string, number>();
  for (const lineup of lineups) {
    const lineupPositions = positionsByLineup.get(lineup.id) ?? [];
    if (lineupPositions.length === 0) {
      return NextResponse.json(
        { error: `Missing positions for lineup ${lineup.id}.` },
        { status: 400 }
      );
    }
    const { weeklyReturn } = calculateWeeklyReturn(lineupPositions, priceMap);
    lineupReturnByUser.set(lineup.user_id, weeklyReturn);

    const { error: updateError } = await supabase
      .from("lineups")
      .update({ weekly_return: weeklyReturn })
      .eq("id", lineup.id);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }
  }

  const { data: matchups, error: matchupsError } = await supabase
    .from("matchups")
    .select("id, home_user_id, away_user_id")
    .eq("league_id", leagueId)
    .eq("week_id", weekId);

  if (matchupsError || !matchups) {
    return NextResponse.json({ error: matchupsError?.message }, { status: 500 });
  }

  if (benchmarkUserId && benchmarkReturn !== null) {
    lineupReturnByUser.set(benchmarkUserId, benchmarkReturn);
  }

  for (const matchup of matchups) {
    const forfeitWinner = resolveForfeitWinner(
      matchup.home_user_id,
      matchup.away_user_id
    );
    if (forfeitWinner) {
      const { error: updateError } = await supabase
        .from("matchups")
        .update({
          home_score: 0,
          away_score: 0,
          winner_user_id: forfeitWinner
        })
        .eq("id", matchup.id);

      if (updateError) {
        return NextResponse.json({ error: updateError.message }, { status: 500 });
      }
      continue;
    }
    const homeReturn =
      lineupReturnByUser.get(matchup.home_user_id) ??
      (matchup.home_user_id === benchmarkUserId ? benchmarkReturn ?? 0 : 0);
    const awayReturn =
      lineupReturnByUser.get(matchup.away_user_id) ??
      (matchup.away_user_id === benchmarkUserId ? benchmarkReturn ?? 0 : 0);

    if (
      (matchup.home_user_id === benchmarkUserId ||
        matchup.away_user_id === benchmarkUserId) &&
      benchmarkReturn === null
    ) {
      return NextResponse.json(
        { error: "Missing benchmark prices for scoring." },
        { status: 400 }
      );
    }

    const result = scoreMatchup(
      matchup.home_user_id,
      matchup.away_user_id,
      homeReturn,
      awayReturn
    );

    const { error: updateError } = await supabase
      .from("matchups")
      .update({
        home_score: result.homeScore,
        away_score: result.awayScore,
        winner_user_id: result.winnerUserId
      })
      .eq("id", matchup.id);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true });
}

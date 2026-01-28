import type { SupabaseClient } from "@supabase/supabase-js";
import { calculateWeeklyReturn } from "@/lib/scoring";
import {
  DEFAULT_BENCHMARK_TICKER,
  ensureBenchmarkUser
} from "@/lib/benchmark";
import { getEtDayEnd } from "@/lib/time";

type MatchupRow = {
  id: string;
  home_user_id: string;
  away_user_id: string;
  home_score: number | null;
  away_score: number | null;
};

type LineupRow = {
  id: string;
  user_id: string;
  weekly_return: number | null;
};

type PositionRow = {
  lineup_id: string;
  ticker: string;
  weight: number;
};

type PriceRow = {
  ticker: string;
  monday_open: number;
  friday_close: number;
};

export async function scoreWeekIfReady({
  supabase,
  leagueId,
  weekId,
  weekEnd
}: {
  supabase: SupabaseClient;
  leagueId: string;
  weekId: string;
  weekEnd: string;
}) {
  const endOfDay = getEtDayEnd(weekEnd);
  if (!endOfDay || Date.now() < endOfDay) {
    return { scored: false, reason: "week_not_ended" };
  }

  const { data: matchups, error: matchupsError } = await supabase
    .from("matchups")
    .select("id, home_user_id, away_user_id, home_score, away_score")
    .eq("league_id", leagueId)
    .eq("week_id", weekId);

  if (matchupsError) {
    return { scored: false, reason: matchupsError.message };
  }

  const matchupRows = (matchups ?? []) as MatchupRow[];
  if (!matchupRows.length) {
    return { scored: false, reason: "no_matchups" };
  }

  const needsScoring = matchupRows.some(
    (matchup) => matchup.home_score === null || matchup.away_score === null
  );
  if (!needsScoring) {
    return { scored: false, reason: "already_scored" };
  }

  const { userId: benchmarkUserId, error: benchmarkError } =
    await ensureBenchmarkUser(supabase);
  if (!benchmarkUserId && benchmarkError) {
    return { scored: false, reason: benchmarkError };
  }

  const participantIds = new Set<string>();
  matchupRows.forEach((matchup) => {
    participantIds.add(matchup.home_user_id);
    participantIds.add(matchup.away_user_id);
  });

  const realUserIds = [...participantIds].filter(
    (id) => id !== benchmarkUserId
  );

  const { data: activeMembers, error: activeMembersError } = await supabase
    .from("league_members")
    .select("user_id")
    .eq("league_id", leagueId);

  if (activeMembersError) {
    return { scored: false, reason: activeMembersError.message };
  }

  const activeMemberIds = new Set(
    (activeMembers ?? []).map((member) => member.user_id)
  );
  if (benchmarkUserId) {
    activeMemberIds.add(benchmarkUserId);
  }

  const resolveForfeitWinner = (matchup: MatchupRow) => {
    const homeActive = activeMemberIds.has(matchup.home_user_id);
    const awayActive = activeMemberIds.has(matchup.away_user_id);
    if (homeActive === awayActive) {
      return null;
    }
    return homeActive ? matchup.home_user_id : matchup.away_user_id;
  };

  const { data: lineups, error: lineupsError } = await supabase
    .from("lineups")
    .select("id, user_id, weekly_return")
    .eq("league_id", leagueId)
    .eq("week_id", weekId)
    .in("user_id", realUserIds);

  if (lineupsError) {
    return { scored: false, reason: lineupsError.message };
  }

  const lineupRows = (lineups ?? []) as LineupRow[];
  const lineupIds = lineupRows.map((lineup) => lineup.id);

  const positions =
    lineupIds.length > 0
      ? await supabase
          .from("lineup_positions")
          .select("lineup_id, ticker, weight")
          .in("lineup_id", lineupIds)
      : { data: [], error: null };

  if (positions.error) {
    return { scored: false, reason: positions.error.message };
  }

  const { data: prices, error: pricesError } = await supabase
    .from("weekly_prices")
    .select("ticker, monday_open, friday_close")
    .eq("week_id", weekId);

  if (pricesError) {
    return { scored: false, reason: pricesError.message };
  }

  const priceMap = new Map(
    (prices ?? []).map((price: PriceRow) => [
      price.ticker.toUpperCase(),
      {
        ticker: price.ticker,
        mondayOpen: Number(price.monday_open),
        fridayClose: Number(price.friday_close)
      }
    ])
  );

  const benchmarkPrice = priceMap.get(DEFAULT_BENCHMARK_TICKER);
  const benchmarkReturn = benchmarkPrice
    ? benchmarkPrice.fridayClose / benchmarkPrice.mondayOpen - 1
    : null;

  if (participantIds.has(benchmarkUserId ?? "") && benchmarkReturn === null) {
    return { scored: false, reason: "Missing benchmark prices." };
  }

  const positionsByLineup = new Map<string, PositionRow[]>();
  (positions.data ?? []).forEach((position: PositionRow) => {
    const list = positionsByLineup.get(position.lineup_id) ?? [];
    list.push({
      lineup_id: position.lineup_id,
      ticker: position.ticker,
      weight: Number(position.weight)
    });
    positionsByLineup.set(position.lineup_id, list);
  });

  const lineupReturnByUser = new Map<string, number>();
  for (const lineup of lineupRows) {
    const lineupPositions = positionsByLineup.get(lineup.id) ?? [];
    if (!lineupPositions.length) {
      continue;
    }
    let weeklyReturn: number;
    try {
      ({ weeklyReturn } = calculateWeeklyReturn(lineupPositions, priceMap));
    } catch (error) {
      return {
        scored: false,
        reason: error instanceof Error ? error.message : "Missing weekly prices."
      };
    }
    lineupReturnByUser.set(lineup.user_id, weeklyReturn);

    if (lineup.weekly_return !== weeklyReturn) {
      await supabase
        .from("lineups")
        .update({ weekly_return: weeklyReturn })
        .eq("id", lineup.id);
    }
  }

  if (benchmarkUserId && benchmarkReturn !== null) {
    lineupReturnByUser.set(benchmarkUserId, benchmarkReturn);
  }

  for (const matchup of matchupRows) {
    const forfeitWinner = resolveForfeitWinner(matchup);
    if (forfeitWinner) {
      await supabase
        .from("matchups")
        .update({
          home_score: 0,
          away_score: 0,
          winner_user_id: forfeitWinner
        })
        .eq("id", matchup.id);
      continue;
    }
    const homeReturn =
      lineupReturnByUser.get(matchup.home_user_id) ?? 0;
    const awayReturn =
      lineupReturnByUser.get(matchup.away_user_id) ?? 0;

    const winnerUserId =
      homeReturn === awayReturn
        ? null
        : homeReturn > awayReturn
          ? matchup.home_user_id
          : matchup.away_user_id;

    await supabase
      .from("matchups")
      .update({
        home_score: homeReturn,
        away_score: awayReturn,
        winner_user_id: winnerUserId
      })
      .eq("id", matchup.id);
  }

  return { scored: true };
}

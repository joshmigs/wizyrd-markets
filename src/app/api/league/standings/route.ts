import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import {
  BENCHMARK_DISPLAY_NAME,
  BENCHMARK_LOGO_URL,
  ensureBenchmarkUser
} from "@/lib/benchmark";

type MemberRow = {
  league_id: string;
  profiles: {
    id: string;
    display_name: string;
    team_logo_url?: string | null;
  } | null;
};

type MatchupRow = {
  league_id: string;
  home_user_id: string;
  away_user_id: string;
  home_score: number | null;
  away_score: number | null;
  winner_user_id: string | null;
  week_id: string;
};

type LeagueRow = {
  id: string;
  name: string;
};

type WeekRow = {
  id: string;
  league_id: string;
  week_start: string;
  week_end: string;
};

type RecordRow = {
  wins: number;
  losses: number;
  ties: number;
  games: number;
  totalReturn: number;
};

type LineupReturnRow = {
  league_id: string;
  user_id: string;
  week_id: string;
  weekly_return: number | null;
};

type ReturnEntry = {
  week_id: string;
  value: number;
};

const mean = (values: number[]) =>
  values.reduce((sum, value) => sum + value, 0) / values.length;

const stdDev = (values: number[]) => {
  if (values.length < 2) {
    return null;
  }
  const avg = mean(values);
  const variance =
    values.reduce((sum, value) => sum + (value - avg) ** 2, 0) /
    (values.length - 1);
  if (variance === 0) {
    return null;
  }
  return Math.sqrt(variance);
};

const annualizedReturn = (values: number[]) => {
  if (values.length === 0) {
    return null;
  }
  const total = values.reduce((acc, value) => acc * (1 + value), 1);
  const weeklyGeometric = Math.pow(total, 1 / values.length) - 1;
  return Math.pow(1 + weeklyGeometric, 52) - 1;
};

const computeBetaAlpha = (portfolio: number[], benchmark: number[]) => {
  if (portfolio.length === 0 || benchmark.length === 0) {
    return { beta: null, alpha: null };
  }
  if (portfolio.length < 2 || benchmark.length < 2) {
    return { beta: 0, alpha: portfolio[0] - benchmark[0] };
  }

  const avgPortfolio = mean(portfolio);
  const avgBenchmark = mean(benchmark);
  const covariance =
    portfolio.reduce(
      (sum, value, index) =>
        sum + (value - avgPortfolio) * (benchmark[index] - avgBenchmark),
      0
    ) /
    (portfolio.length - 1);
  const variance =
    benchmark.reduce((sum, value) => sum + (value - avgBenchmark) ** 2, 0) /
    (benchmark.length - 1);

  if (variance === 0) {
    return { beta: null, alpha: null };
  }

  const beta = covariance / variance;
  const alpha = avgPortfolio - beta * avgBenchmark;

  return { beta, alpha };
};

export async function GET(request: Request) {
  const { user, error, status } = await getAuthenticatedUser(request);
  if (!user) {
    return NextResponse.json({ error }, { status });
  }

  const { searchParams } = new URL(request.url);
  const leagueId = searchParams.get("leagueId");

  const supabase = createSupabaseServiceClient();
  let leagueIds: string[] = [];
  let leagues: LeagueRow[] = [];

  if (leagueId) {
    const { data: membership } = await supabase
      .from("league_members")
      .select("league_id")
      .eq("league_id", leagueId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!membership) {
      return NextResponse.json({ error: "Not a member of this league." }, { status: 403 });
    }

    const { data: leagueData, error: leagueError } = await supabase
      .from("leagues")
      .select("id, name")
      .eq("id", leagueId)
      .maybeSingle();

    if (leagueError) {
      return NextResponse.json({ error: leagueError.message }, { status: 500 });
    }

    leagues = leagueData ? [leagueData as LeagueRow] : [];
    leagueIds = leagues.map((league) => league.id);
  } else {
    const { data, error: membershipError } = await supabase
      .from("league_members")
      .select("league_id, leagues(id, name)")
      .eq("user_id", user.id);

    if (membershipError) {
      return NextResponse.json({ error: membershipError.message }, { status: 500 });
    }

    leagues = (data ?? [])
      .map((row) => (row as { leagues: LeagueRow | null }).leagues)
      .filter(Boolean) as LeagueRow[];
    leagueIds = leagues.map((league) => league.id);
  }

  if (leagueIds.length === 0) {
    return NextResponse.json({ leagues: [] });
  }

  const { userId: benchmarkUserId } = await ensureBenchmarkUser(supabase);

  const { data: weekData, error: weekError } = await supabase
    .from("weeks")
    .select("id, league_id, week_start, week_end")
    .in("league_id", leagueIds);

  if (weekError) {
    return NextResponse.json({ error: weekError.message }, { status: 500 });
  }

  const weeks = (weekData ?? []) as WeekRow[];
  const weekIds = weeks.map((week) => week.id);
  const { data: benchmarkPrices, error: benchmarkError } = weekIds.length
    ? await supabase
        .from("weekly_prices")
        .select("week_id, monday_open, friday_close")
        .in("week_id", weekIds)
        .eq("ticker", "SPY")
    : { data: [], error: null };

  if (benchmarkError) {
    return NextResponse.json({ error: benchmarkError.message }, { status: 500 });
  }

  const weekLeagueById = new Map(weeks.map((week) => [week.id, week.league_id]));
  const weekStartById = new Map(
    weeks.map((week) => [week.id, new Date(week.week_start).getTime()])
  );
  const weekEndById = new Map(
    weeks.map((week) => [week.id, new Date(week.week_end).getTime()])
  );
  const benchmarkReturnByLeague = new Map<string, { total: number; count: number }>();
  const benchmarkReturnByWeekId = new Map<string, number>();
  const benchmarkReturnsByLeague = new Map<string, number[]>();
  (benchmarkPrices ?? []).forEach((row) => {
    const leagueId = weekLeagueById.get(row.week_id);
    if (!leagueId) {
      return;
    }
    const value = Number(row.friday_close) / Number(row.monday_open) - 1;
    benchmarkReturnByWeekId.set(row.week_id, value);
    const current = benchmarkReturnByLeague.get(leagueId) ?? { total: 0, count: 0 };
    benchmarkReturnByLeague.set(leagueId, {
      total: current.total + value,
      count: current.count + 1
    });
    const list = benchmarkReturnsByLeague.get(leagueId) ?? [];
    list.push(value);
    benchmarkReturnsByLeague.set(leagueId, list);
  });

  const { data: memberData, error: memberError } = await supabase
    .from("league_members")
    .select("league_id, profiles(id, display_name, team_logo_url)")
    .in("league_id", leagueIds);

  if (memberError) {
    return NextResponse.json({ error: memberError.message }, { status: 500 });
  }

  const members = (memberData ?? []) as MemberRow[];
  const membersByLeague = new Map<string, MemberRow[]>();
  members.forEach((member) => {
    const list = membersByLeague.get(member.league_id) ?? [];
    list.push(member);
    membersByLeague.set(member.league_id, list);
  });

  const { data: lineupReturns, error: lineupReturnsError } = await supabase
    .from("lineups")
    .select("league_id, user_id, week_id, weekly_return")
    .in("league_id", leagueIds)
    .not("weekly_return", "is", null);

  if (lineupReturnsError) {
    return NextResponse.json({ error: lineupReturnsError.message }, { status: 500 });
  }

  const returnsByLeagueUser = new Map<string, Map<string, ReturnEntry[]>>();
  (lineupReturns ?? []).forEach((row: LineupReturnRow) => {
    const value = row.weekly_return;
    if (value === null || value === undefined) {
      return;
    }
    const leagueMap = returnsByLeagueUser.get(row.league_id) ?? new Map();
    const list = leagueMap.get(row.user_id) ?? [];
    list.push({ week_id: row.week_id, value: Number(value) });
    leagueMap.set(row.user_id, list);
    returnsByLeagueUser.set(row.league_id, leagueMap);
  });

  const { data: matchups, error: matchupsError } = await supabase
    .from("matchups")
    .select(
      "league_id, week_id, home_user_id, away_user_id, home_score, away_score, winner_user_id"
    )
    .in("league_id", leagueIds);

  if (matchupsError) {
    return NextResponse.json({ error: matchupsError.message }, { status: 500 });
  }

  const recordByLeague = new Map<string, Map<string, RecordRow>>();

  leagues.forEach((league) => {
    const map = new Map<string, RecordRow>();
    (membersByLeague.get(league.id) ?? []).forEach((member) => {
      if (member.profiles) {
        map.set(member.profiles.id, {
          wins: 0,
          losses: 0,
          ties: 0,
          games: 0,
          totalReturn: 0
        });
      }
    });
    if (benchmarkUserId) {
      map.set(benchmarkUserId, {
        wins: 0,
        losses: 0,
        ties: 0,
        games: 0,
        totalReturn: 0
      });
    }
    recordByLeague.set(league.id, map);
  });

  (matchups ?? []).forEach((matchup: MatchupRow) => {
    const leagueMap = recordByLeague.get(matchup.league_id);
    if (!leagueMap) {
      return;
    }
    const home = leagueMap.get(matchup.home_user_id);
    const away = leagueMap.get(matchup.away_user_id);

    const homeScore = matchup.home_score;
    const awayScore = matchup.away_score;
    const scored =
      homeScore !== null &&
      awayScore !== null &&
      Number.isFinite(Number(homeScore)) &&
      Number.isFinite(Number(awayScore));

    if (!scored && !matchup.winner_user_id) {
      return;
    }

    if (home && scored) {
      home.games += 1;
      home.totalReturn += Number(homeScore);
    }
    if (away && scored) {
      away.games += 1;
      away.totalReturn += Number(awayScore);
    }

    let winner = matchup.winner_user_id;
    if (!winner && scored) {
      if (Number(homeScore) > Number(awayScore)) {
        winner = matchup.home_user_id;
      } else if (Number(awayScore) > Number(homeScore)) {
        winner = matchup.away_user_id;
      }
    }

    if (!winner) {
      if (home) {
        home.ties += 1;
      }
      if (away) {
        away.ties += 1;
      }
      return;
    }

    if (winner === matchup.home_user_id) {
      if (home) {
        home.wins += 1;
      }
      if (away) {
        away.losses += 1;
      }
    } else {
      if (away) {
        away.wins += 1;
      }
      if (home) {
        home.losses += 1;
      }
    }
  });

  const now = Date.now();
  (matchups ?? []).forEach((matchup: MatchupRow) => {
    const weekEnd = weekEndById.get(matchup.week_id);
    if (!weekEnd || weekEnd >= now) {
      return;
    }
    const leagueMap = returnsByLeagueUser.get(matchup.league_id) ?? new Map();
    const ensureEntry = (userId: string) => {
      const list = leagueMap.get(userId) ?? [];
      if (!list.some((entry) => entry.week_id === matchup.week_id)) {
        list.push({ week_id: matchup.week_id, value: 0 });
        leagueMap.set(userId, list);
        returnsByLeagueUser.set(matchup.league_id, leagueMap);
      }
    };
    ensureEntry(matchup.home_user_id);
    ensureEntry(matchup.away_user_id);
  });

  const response = leagues.map((league) => {
    const memberRows = membersByLeague.get(league.id) ?? [];
    const leagueMap = recordByLeague.get(league.id) ?? new Map();
    const returnMap = returnsByLeagueUser.get(league.id) ?? new Map();
    const rows = memberRows
      .map((member) => member.profiles)
      .filter(Boolean)
      .map((profile) => {
        const returnEntries = returnMap.get(profile!.id) ?? [];
        const sortedEntries = [...returnEntries].sort((a, b) => {
          const startA = weekStartById.get(a.week_id) ?? 0;
          const startB = weekStartById.get(b.week_id) ?? 0;
          return startA - startB;
        });
        const portfolioReturns = sortedEntries.map((entry) => entry.value);
        const alignedPortfolio: number[] = [];
        const alignedBenchmark: number[] = [];
        const now = Date.now();
        sortedEntries.forEach((entry) => {
          let benchmark = benchmarkReturnByWeekId.get(entry.week_id);
          if (benchmark === undefined) {
            const weekEnd = weekEndById.get(entry.week_id);
            if (weekEnd && weekEnd < now) {
              benchmark = 0;
            }
          }
          if (benchmark === undefined) {
            return;
          }
          alignedPortfolio.push(entry.value);
          alignedBenchmark.push(benchmark);
        });
        const { alpha, beta } = computeBetaAlpha(alignedPortfolio, alignedBenchmark);
        const annualized = annualizedReturn(portfolioReturns);
        const volatility = stdDev(portfolioReturns);
        const record = leagueMap.get(profile!.id) ?? {
          wins: 0,
          losses: 0,
          ties: 0,
          games: 0,
          totalReturn: 0
        };
        const winPct =
          record.games > 0 ? record.wins / record.games : null;
        const lossPct =
          record.games > 0 ? record.losses / record.games : null;
        const tiePct =
          record.games > 0 ? record.ties / record.games : null;
        const avgReturn =
          portfolioReturns.length > 0
            ? mean(portfolioReturns)
            : record.games > 0
              ? record.totalReturn / record.games
              : null;
        return {
          user_id: profile!.id,
          display_name: profile!.display_name,
          team_logo_url: profile!.team_logo_url ?? null,
          wins: record.wins,
          losses: record.losses,
          ties: record.ties,
          games: record.games,
          win_pct: winPct,
          loss_pct: lossPct,
          tie_pct: tiePct,
          avg_return: avgReturn,
          annualized_return: annualized,
          volatility,
          alpha,
          beta,
          is_benchmark: false
        };
      });

    if (benchmarkUserId) {
      const record = leagueMap.get(benchmarkUserId) ?? {
        wins: 0,
        losses: 0,
        ties: 0,
        games: 0,
        totalReturn: 0
      };
      const completedWeekIds = weeks
        .filter(
          (week) =>
            week.league_id === league.id &&
            (weekEndById.get(week.id) ?? 0) < now
        )
        .map((week) => week.id);
      const benchmarkReturns = completedWeekIds.length
        ? completedWeekIds
            .map((weekId) => benchmarkReturnByWeekId.get(weekId) ?? null)
            .filter((value): value is number => typeof value === "number")
        : benchmarkReturnsByLeague.get(league.id) ?? [];
      const benchmarkAvg =
        benchmarkReturns.length > 0 ? mean(benchmarkReturns) : null;
      const benchmarkAnnualized = annualizedReturn(benchmarkReturns);
      const benchmarkVolatility = stdDev(benchmarkReturns);
      const benchmarkAlphaBeta =
        benchmarkReturns.length >= 2
          ? computeBetaAlpha(benchmarkReturns, benchmarkReturns)
          : { alpha: null, beta: null };
      const winPct =
        record.games > 0 ? record.wins / record.games : null;
      const lossPct =
        record.games > 0 ? record.losses / record.games : null;
      const tiePct =
        record.games > 0 ? record.ties / record.games : null;
      const avgReturn =
        record.games > 0
          ? record.totalReturn / record.games
          : benchmarkAvg;
      rows.push({
        user_id: benchmarkUserId,
        display_name: BENCHMARK_DISPLAY_NAME,
        team_logo_url: BENCHMARK_LOGO_URL,
        wins: record.wins,
        losses: record.losses,
        ties: record.ties,
        games: record.games,
        win_pct: winPct,
        loss_pct: lossPct,
        tie_pct: tiePct,
        avg_return: avgReturn,
        annualized_return: benchmarkAnnualized,
        volatility: benchmarkVolatility,
        alpha: benchmarkAlphaBeta.alpha,
        beta: benchmarkAlphaBeta.beta,
        is_benchmark: true
      });
    }

    rows.sort((a, b) => {
      if (a.is_benchmark !== b.is_benchmark) {
        return a.is_benchmark ? 1 : -1;
      }
      const pctA = a.win_pct ?? -1;
      const pctB = b.win_pct ?? -1;
      if (pctA !== pctB) {
        return pctB - pctA;
      }
      if (a.wins !== b.wins) {
        return b.wins - a.wins;
      }
      const avgA = a.avg_return ?? -Infinity;
      const avgB = b.avg_return ?? -Infinity;
      return avgB - avgA;
    });

    return {
      id: league.id,
      name: league.name,
      standings: rows
    };
  });

  return NextResponse.json({ leagues: response });
}

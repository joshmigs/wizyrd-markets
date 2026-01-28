import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { scoreWeekIfReady } from "@/lib/scoring-runner";
import { getEtDayEnd } from "@/lib/time";

type MatchupRow = {
  home_user_id: string;
  away_user_id: string;
  winner_user_id: string | null;
  home_score: number | null;
  away_score: number | null;
  week_id: string;
};

type LineupRow = {
  week_id: string;
  weekly_return: number | null;
};

type WeekRow = {
  id: string;
  week_start: string;
  week_end: string;
  league_id: string;
};

type PriceRow = {
  week_id: string;
  monday_open: number;
  friday_close: number;
};

type WeekCandidate = {
  id: string;
  start: number;
  end: number;
};

const RANGE_WEEKS: Record<string, number | null> = {
  "1w": 1,
  "2w": 2,
  "3w": 3,
  "4w": 4,
  "6m": 26,
  "12m": 52,
  "12w": 12
};

const CACHE_TTL_MS = 15_000;
const cache = new Map<string, { timestamp: number; payload: unknown }>();

const getRangeStartDate = (range: string) => {
  const now = new Date();
  if (range === "all") {
    return null;
  }
  if (range === "qtd") {
    const quarterStartMonth = Math.floor(now.getUTCMonth() / 3) * 3;
    return new Date(Date.UTC(now.getUTCFullYear(), quarterStartMonth, 1)).toISOString();
  }
  if (range === "ytd") {
    return new Date(Date.UTC(now.getUTCFullYear(), 0, 1)).toISOString();
  }
  const weeksBack = RANGE_WEEKS[range];
  if (typeof weeksBack === "number") {
    return new Date(Date.now() - weeksBack * 7 * 24 * 60 * 60 * 1000).toISOString();
  }
  return null;
};

const resolveWeekEnd = (dateStr: string) => {
  const end = getEtDayEnd(dateStr);
  if (end !== null) {
    return end;
  }
  const parsed = new Date(dateStr).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
};

const mean = (values: number[]) =>
  values.reduce((sum, value) => sum + value, 0) / values.length;

const stdDev = (values: number[]) => {
  if (values.length < 2) {
    return values.length === 1 ? 0 : null;
  }
  const avg = mean(values);
  const variance =
    values.reduce((sum, value) => sum + (value - avg) ** 2, 0) /
    (values.length - 1);
  return Math.sqrt(variance);
};

const compoundedReturn = (values: number[], count: number) => {
  const slice = values.slice(-count);
  if (slice.length === 0) {
    return null;
  }
  const total = slice.reduce((acc, value) => acc * (1 + value), 1);
  return total - 1;
};

const annualizedReturn = (values: number[]) => {
  if (values.length === 0) {
    return null;
  }
  const total = values.reduce((acc, value) => acc * (1 + value), 1);
  const weeklyGeometric = Math.pow(total, 1 / values.length) - 1;
  return Math.pow(1 + weeklyGeometric, 52) - 1;
};

const cumulativeSeries = (values: number[]) => values.slice();

const buildWeeklyMetricSeries = (portfolio: number[], benchmark: number[]) => {
  const length = Math.min(portfolio.length, benchmark.length);
  const weeklySharpe: number[] = [];
  const weeklyBeta: number[] = [];
  const weeklyAlpha: number[] = [];
  const weeklyVolatility: number[] = [];

  for (let i = 0; i < length; i += 1) {
    const portfolioSlice = portfolio.slice(0, i + 1);
    const benchmarkSlice = benchmark.slice(0, i + 1);
    const vol = stdDev(portfolioSlice);
    const avg = mean(portfolioSlice);
    const sharpe = vol && vol !== 0 ? avg / vol : 0;
    const { beta, alpha } = computeBetaAlpha(portfolioSlice, benchmarkSlice);
    weeklySharpe.push(sharpe);
    weeklyBeta.push(beta ?? 0);
    weeklyAlpha.push(alpha ?? 0);
    weeklyVolatility.push(vol ?? 0);
  }

  return { weeklySharpe, weeklyBeta, weeklyAlpha, weeklyVolatility };
};

const pickRangeWeeks = ({
  weeks,
  range,
  rangeWeeks,
  startDate,
  now
}: {
  weeks: WeekCandidate[];
  range: string;
  rangeWeeks: number | null;
  startDate: string | null;
  now: number;
}) => {
  let filtered = weeks;
  if (range === "live") {
    const liveWeek = weeks.find((week) => week.start <= now && week.end >= now) ?? null;
    if (liveWeek) {
      filtered = [liveWeek];
    } else {
      const completed = weeks.filter((week) => week.end && week.end <= now);
      if (completed.length) {
        filtered = [completed[completed.length - 1]];
      }
    }
    return filtered;
  }

  if (startDate && rangeWeeks === null) {
    const startBoundary = new Date(startDate).getTime();
    filtered = weeks.filter((week) => week.end >= startBoundary);
  }
  if (typeof rangeWeeks === "number") {
    const completed = weeks.filter((week) => week.end && week.end <= now);
    const pool = completed.length ? completed : weeks;
    filtered = pool.slice(-rangeWeeks);
  }
  if (filtered.length === 0 && weeks.length) {
    filtered = weeks.slice(-1);
  }
  return filtered;
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
      (sum, value, index) => sum + (value - avgPortfolio) * (benchmark[index] - avgBenchmark),
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
  const range = searchParams.get("range") ?? "4w";
  const targetUserId = searchParams.get("userId") ?? user.id;
  const rangeWeeks = RANGE_WEEKS[range] ?? null;
  const startDate = getRangeStartDate(range);

  const cacheKey = [
    "analytics",
    user.id,
    targetUserId,
    leagueId ?? "all",
    range
  ].join(":");
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return NextResponse.json(cached.payload);
  }

  const supabase = createSupabaseServiceClient();

  if (targetUserId !== user.id) {
    if (!leagueId) {
      return NextResponse.json(
        { error: "League is required to view another member." },
        { status: 400 }
      );
    }

    const { data: memberCheck } = await supabase
      .from("league_members")
      .select("user_id")
      .eq("league_id", leagueId)
      .in("user_id", [user.id, targetUserId]);

    if (!memberCheck || memberCheck.length < 2) {
      return NextResponse.json({ error: "Not authorized." }, { status: 403 });
    }
  }

  let weeks: WeekRow[] = [];
  if (leagueId || startDate) {
    let weeksQuery = supabase
      .from("weeks")
      .select("id, week_start, week_end, league_id")
      .order("week_start", { ascending: true });

    if (leagueId) {
      weeksQuery = weeksQuery.eq("league_id", leagueId);
    }
    if (startDate && rangeWeeks === null) {
      weeksQuery = weeksQuery.gte("week_end", startDate);
    }

    const { data, error: weeksError } = await weeksQuery;
    if (weeksError) {
      return NextResponse.json({ error: weeksError.message }, { status: 500 });
    }
    weeks = (data ?? []) as WeekRow[];
  }

  const now = Date.now();
  const weekById = new Map(weeks.map((week) => [week.id, week]));
  const weekStartById = new Map(
    weeks.map((week) => [week.id, new Date(week.week_start).getTime()])
  );
  const weekEndById = new Map(
    weeks.map((week) => [week.id, resolveWeekEnd(week.week_end)])
  );

  const fetchMatchups = async () => {
    let query = supabase
      .from("matchups")
      .select(
        "home_user_id, away_user_id, winner_user_id, home_score, away_score, week_id"
      )
      .or(`home_user_id.eq.${targetUserId},away_user_id.eq.${targetUserId}`);

    if (leagueId) {
      query = query.eq("league_id", leagueId);
    }

    return query;
  };

  const { data: matchupData, error: matchupError } = await fetchMatchups();
  if (matchupError) {
    return NextResponse.json({ error: matchupError.message }, { status: 500 });
  }

  let matchupRows = (matchupData ?? []) as MatchupRow[];
  let recordRows = matchupRows;
  const recordWeekIds = [...new Set(recordRows.map((row) => row.week_id))];
  const missingWeekIds = recordWeekIds.filter((weekId) => !weekEndById.has(weekId));
  if (missingWeekIds.length) {
    const { data: recordWeeks, error: recordWeeksError } = await supabase
      .from("weeks")
      .select("id, week_start, week_end, league_id")
      .in("id", missingWeekIds);
    if (recordWeeksError) {
      return NextResponse.json({ error: recordWeeksError.message }, { status: 500 });
    }
    (recordWeeks ?? []).forEach((week) => {
      const typed = week as WeekRow;
      weekById.set(typed.id, typed);
      weekStartById.set(typed.id, new Date(typed.week_start).getTime());
      weekEndById.set(typed.id, resolveWeekEnd(typed.week_end));
    });
  }

  const fetchLineups = async () => {
    let query = supabase
      .from("lineups")
      .select("week_id, weekly_return")
      .eq("user_id", targetUserId);

    if (leagueId) {
      query = query.eq("league_id", leagueId);
    }

    return query;
  };

  const { data: lineupData, error: lineupError } = await fetchLineups();
  if (lineupError) {
    return NextResponse.json({ error: lineupError.message }, { status: 500 });
  }

  let lineups = (lineupData ?? []) as LineupRow[];
  const lineupWeekIds = [...new Set(lineups.map((row) => row.week_id))];
  const lineupMissingWeekIds = lineupWeekIds.filter((weekId) => !weekEndById.has(weekId));
  if (lineupMissingWeekIds.length) {
    const { data: extraWeeks, error: extraWeeksError } = await supabase
      .from("weeks")
      .select("id, week_start, week_end, league_id")
      .in("id", lineupMissingWeekIds);
    if (extraWeeksError) {
      return NextResponse.json({ error: extraWeeksError.message }, { status: 500 });
    }
    (extraWeeks ?? []).forEach((week) => {
      const typed = week as WeekRow;
      weekById.set(typed.id, typed);
      weekStartById.set(typed.id, new Date(typed.week_start).getTime());
      weekEndById.set(typed.id, resolveWeekEnd(typed.week_end));
    });
  }

  const candidateWeekIds = new Set([
    ...recordWeekIds,
    ...lineupWeekIds
  ]);
  if (candidateWeekIds.size === 0) {
    weeks.forEach((week) => candidateWeekIds.add(week.id));
  }

  const candidateWeeks = [...candidateWeekIds]
    .map((id) => ({
      id,
      start: weekStartById.get(id) ?? 0,
      end: weekEndById.get(id) ?? 0
    }))
    .filter((week) => week.start || week.end)
    .sort((a, b) => {
      const aKey = a.start || a.end;
      const bKey = b.start || b.end;
      return aKey - bKey;
    });
  const leagueWeeks = weeks
    .map((week) => ({
      id: week.id,
      start: weekStartById.get(week.id) ?? 0,
      end: weekEndById.get(week.id) ?? 0
    }))
    .filter((week) => week.start || week.end)
    .sort((a, b) => {
      const aKey = a.start || a.end;
      const bKey = b.start || b.end;
      return aKey - bKey;
    });
  const baseWeeks =
    range === "live" && leagueWeeks.length ? leagueWeeks : candidateWeeks;
  let filteredWeeks = pickRangeWeeks({
    weeks: baseWeeks,
    range,
    rangeWeeks,
    startDate,
    now
  });
  if (!filteredWeeks.length && leagueWeeks.length) {
    filteredWeeks = pickRangeWeeks({
      weeks: leagueWeeks,
      range,
      rangeWeeks,
      startDate,
      now
    });
  }

  const selectedWeekIds = filteredWeeks.map((week) => week.id);
  const selectedWeekSet = new Set(selectedWeekIds);
  let scoredAny = false;
  if (filteredWeeks.length) {
    const results = await Promise.all(
      filteredWeeks
        .map((week) => weekById.get(week.id))
        .filter((week): week is WeekRow => Boolean(week))
        .map((week) =>
          scoreWeekIfReady({
            supabase,
            leagueId: week.league_id,
            weekId: week.id,
            weekEnd: week.week_end
          })
        )
    );
    scoredAny = results.some((result) => result?.scored);
  }

  if (scoredAny) {
    const { data: refreshedMatchups, error: refreshMatchupsError } =
      await fetchMatchups();
    if (refreshMatchupsError) {
      return NextResponse.json({ error: refreshMatchupsError.message }, { status: 500 });
    }
    matchupRows = (refreshedMatchups ?? []) as MatchupRow[];
    recordRows = matchupRows;

    const { data: refreshedLineups, error: refreshLineupsError } =
      await fetchLineups();
    if (refreshLineupsError) {
      return NextResponse.json({ error: refreshLineupsError.message }, { status: 500 });
    }
    lineups = (refreshedLineups ?? []) as LineupRow[];
  }

  const scoredWeekIds = new Set<string>();
  lineups.forEach((row) => {
    if (Number.isFinite(Number(row.weekly_return))) {
      scoredWeekIds.add(row.week_id);
    }
  });
  matchupRows.forEach((matchup) => {
    const hasScores =
      matchup.home_score !== null &&
      matchup.away_score !== null &&
      Number.isFinite(Number(matchup.home_score)) &&
      Number.isFinite(Number(matchup.away_score));
    if (hasScores || matchup.winner_user_id) {
      scoredWeekIds.add(matchup.week_id);
    }
  });

  if (range !== "live" && scoredWeekIds.size) {
    const scoredWeeks = [...scoredWeekIds]
      .map((id) => ({
        id,
        start: weekStartById.get(id) ?? 0,
        end: weekEndById.get(id) ?? 0
      }))
      .filter((week) => week.start || week.end)
      .sort((a, b) => {
        const aKey = a.start || a.end;
        const bKey = b.start || b.end;
        return aKey - bKey;
      });
    filteredWeeks = pickRangeWeeks({
      weeks: scoredWeeks.length ? scoredWeeks : filteredWeeks,
      range,
      rangeWeeks,
      startDate,
      now
    });
  }

  const finalWeekIds = filteredWeeks.map((week) => week.id);
  const finalWeekSet = new Set(finalWeekIds);

  const matchupRowsForWeek = matchupRows.filter((row) =>
    finalWeekSet.has(row.week_id)
  ) as MatchupRow[];
  const selectedLineups = lineups.filter((row) => finalWeekSet.has(row.week_id));

  const weekOrder = new Map<string, number>();
  filteredWeeks.forEach((week, index) => {
    weekOrder.set(week.id, index);
  });

  const returnsByWeekId = new Map<string, number>();
  selectedLineups.forEach((row) => {
    const value = Number(row.weekly_return);
    if (Number.isFinite(value)) {
      returnsByWeekId.set(row.week_id, value);
    }
  });

  matchupRowsForWeek.forEach((matchup) => {
    if (returnsByWeekId.has(matchup.week_id)) {
      return;
    }
    const hasScores =
      matchup.home_score !== null &&
      matchup.away_score !== null &&
      Number.isFinite(Number(matchup.home_score)) &&
      Number.isFinite(Number(matchup.away_score));
    if (hasScores) {
      if (matchup.home_user_id === targetUserId) {
        returnsByWeekId.set(matchup.week_id, Number(matchup.home_score));
      } else if (matchup.away_user_id === targetUserId) {
        returnsByWeekId.set(matchup.week_id, Number(matchup.away_score));
      }
      return;
    }

    const weekEnd = weekEndById.get(matchup.week_id);
    if ((weekEnd && weekEnd < now) || !weekEnd) {
      returnsByWeekId.set(matchup.week_id, 0);
    }
  });

  if (returnsByWeekId.size === 0 && recordRows.length) {
    const fallbackWeekSet = finalWeekSet.size ? finalWeekSet : null;
    recordRows.forEach((matchup) => {
      if (fallbackWeekSet && !fallbackWeekSet.has(matchup.week_id)) {
        return;
      }
      const hasScores =
        matchup.home_score !== null &&
        matchup.away_score !== null &&
        Number.isFinite(Number(matchup.home_score)) &&
        Number.isFinite(Number(matchup.away_score));
      if (hasScores) {
        if (matchup.home_user_id === targetUserId) {
          returnsByWeekId.set(matchup.week_id, Number(matchup.home_score));
        } else if (matchup.away_user_id === targetUserId) {
          returnsByWeekId.set(matchup.week_id, Number(matchup.away_score));
        }
        return;
      }
      const weekEnd = weekEndById.get(matchup.week_id);
      if ((weekEnd && weekEnd < now) || !weekEnd) {
        returnsByWeekId.set(matchup.week_id, 0);
      }
    });
  }

  if (finalWeekIds.length) {
    finalWeekIds.forEach((weekId) => {
      if (returnsByWeekId.has(weekId)) {
        return;
      }
      const weekEnd = weekEndById.get(weekId);
      if (!weekEnd || weekEnd < now) {
        returnsByWeekId.set(weekId, 0);
      }
    });
  }

  if (returnsByWeekId.size === 0 && finalWeekIds.length) {
    finalWeekIds.forEach((weekId) => {
      const weekEnd = weekEndById.get(weekId);
      if (!weekEnd || weekEnd < now) {
        returnsByWeekId.set(weekId, 0);
      }
    });
  }

  let wins = 0;
  let losses = 0;
  let ties = 0;
  for (const matchup of recordRows) {
    const hasScores =
      matchup.home_score !== null &&
      matchup.away_score !== null &&
      Number.isFinite(Number(matchup.home_score)) &&
      Number.isFinite(Number(matchup.away_score));
    const hasResult = Boolean(matchup.winner_user_id) || hasScores;

    if (!hasResult) {
      continue;
    }

    let winner = matchup.winner_user_id;
    if (!winner && hasScores) {
      const homeScore = Number(matchup.home_score);
      const awayScore = Number(matchup.away_score);
      if (homeScore > awayScore) {
        winner = matchup.home_user_id;
      } else if (awayScore > homeScore) {
        winner = matchup.away_user_id;
      }
    }

    if (!winner) {
      ties += 1;
    } else if (winner === targetUserId) {
      wins += 1;
    } else {
      losses += 1;
    }
  }

  const games = wins + losses + ties;
  const winPct = games ? wins / games : null;

  const weekEntries = [...returnsByWeekId.entries()];
  const sortedEntries = weekEntries.sort((a, b) => {
    const indexA = weekOrder.get(a[0]) ?? 0;
    const indexB = weekOrder.get(b[0]) ?? 0;
    return indexA - indexB;
  });
  const portfolioReturns = sortedEntries.map((entry) => entry[1]);

  const avgWeekly = portfolioReturns.length ? mean(portfolioReturns) : null;
  const monthly = compoundedReturn(portfolioReturns, 4);
  const annualized = annualizedReturn(portfolioReturns);
  const volatility = stdDev(portfolioReturns);

  const selectedLineupWeekIds = sortedEntries.map((entry) => entry[0]);
  const uniqueLineupWeeks = [...new Set(selectedLineupWeekIds)];

  let benchmarkReturns: number[] = [];
  if (uniqueLineupWeeks.length) {
    const { data: priceData, error: priceError } = await supabase
      .from("weekly_prices")
      .select("week_id, monday_open, friday_close")
      .in("week_id", uniqueLineupWeeks)
      .eq("ticker", "SPY");

    if (!priceError) {
      const prices = (priceData ?? []) as PriceRow[];
      const byWeek = new Map<string, number>();
      prices.forEach((row) => {
        const value = Number(row.friday_close) / Number(row.monday_open) - 1;
        byWeek.set(row.week_id, value);
      });

      benchmarkReturns = uniqueLineupWeeks
        .map((weekId) => {
          const value = byWeek.get(weekId);
          if (value !== undefined) {
            return value;
          }
          const weekEnd = weekEndById.get(weekId);
          if (weekEnd && weekEnd < now) {
            return 0;
          }
          return null;
        })
        .filter((value): value is number => typeof value === "number");
    }
  }

  const alignedBenchmark = benchmarkReturns.slice(0, portfolioReturns.length);
  const alignedPortfolio = portfolioReturns.slice(0, alignedBenchmark.length);
  const { alpha, beta } = computeBetaAlpha(alignedPortfolio, alignedBenchmark);
  const { weeklySharpe, weeklyBeta, weeklyAlpha, weeklyVolatility } =
    buildWeeklyMetricSeries(alignedPortfolio, alignedBenchmark);

  const payload = {
    record: { wins, losses, ties, games, winPct },
    stats: {
      avgWeekly,
      monthly,
      annualized,
      stdDev: volatility
    },
    benchmark: {
      alpha,
      beta
    },
    series: {
      portfolio: portfolioReturns,
      benchmark: alignedBenchmark,
      cumulative: cumulativeSeries(portfolioReturns),
      benchmarkCumulative: cumulativeSeries(alignedBenchmark),
      weeklySharpe,
      weeklyBeta,
      weeklyAlpha,
      weeklyVolatility
    }
  };

  cache.set(cacheKey, { timestamp: Date.now(), payload });
  return NextResponse.json(payload);
}

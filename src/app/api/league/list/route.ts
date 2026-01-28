import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getEtDayEnd, getEtDayStart } from "@/lib/time";

const CACHE_TTL_MS = 15_000;
const cache = new Map<string, { timestamp: number; payload: unknown }>();

export async function GET(request: Request) {
  const { user, error, status } = await getAuthenticatedUser(request);
  if (!user) {
    return NextResponse.json({ error }, { status });
  }

  const cacheKey = `league-list:${user.id}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return NextResponse.json(cached.payload);
  }

  const supabase = createSupabaseServiceClient();
  const { data, error: fetchError } = await supabase
    .from("league_members")
    .select("league_id, leagues(id, name, invite_code, created_by)")
    .eq("user_id", user.id);

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 });
  }

  const leagues = (data ?? [])
    .map((row) => (row as { leagues: unknown }).leagues)
    .filter(Boolean);

  const leagueIds = leagues.map((league) => (league as { id: string }).id);
  if (leagueIds.length === 0) {
    const payload = { leagues };
    cache.set(cacheKey, { timestamp: Date.now(), payload });
    return NextResponse.json(payload);
  }

  const nowTime = Date.now();
  const { data: allWeeks, error: weeksError } = await supabase
    .from("weeks")
    .select("id, league_id, week_start, week_end, lock_time")
    .in("league_id", leagueIds)
    .order("week_start", { ascending: true });

  if (weeksError) {
    return NextResponse.json({ error: weeksError.message }, { status: 500 });
  }

  const weeksByLeague = new Map<
    string,
    { id: string; week_start: string; week_end: string; lock_time: string }[]
  >();
  (allWeeks ?? []).forEach((week) => {
    const list = weeksByLeague.get(week.league_id) ?? [];
    list.push({
      id: week.id,
      week_start: week.week_start,
      week_end: week.week_end,
      lock_time: week.lock_time
    });
    weeksByLeague.set(week.league_id, list);
  });

  const nextWeekByLeague = new Map<
    string,
    { id: string; week_start: string; week_end: string; lock_time: string }
  >();
  const currentWeekByLeague = new Map<
    string,
    { id: string; week_start: string; week_end: string; lock_time: string }
  >();
  const statusWeekByLeague = new Map<
    string,
    { id: string; week_start: string; week_end: string; lock_time: string }
  >();
  const currentWeekIds: string[] = [];
  const upcomingWeekIds: string[] = [];

  leagueIds.forEach((leagueId) => {
    const list = weeksByLeague.get(leagueId) ?? [];
    if (!list.length) {
      return;
    }

    let currentWeek: { id: string; week_start: string; week_end: string; lock_time: string } | null =
      null;
    let nextWeek: { id: string; week_start: string; week_end: string; lock_time: string } | null =
      null;

    for (const week of list) {
      const start = getEtDayStart(week.week_start);
      const end = getEtDayEnd(week.week_end);
      if (start === null || end === null) {
        continue;
      }
      if (!currentWeek && nowTime >= start && nowTime <= end) {
        currentWeek = week;
      }
      if (!nextWeek && start > nowTime) {
        nextWeek = week;
      }
    }

    if (currentWeek) {
      currentWeekByLeague.set(leagueId, currentWeek);
      currentWeekIds.push(currentWeek.id);
    }

    if (nextWeek) {
      nextWeekByLeague.set(leagueId, nextWeek);
      upcomingWeekIds.push(nextWeek.id);
    }

    const statusWeek =
      currentWeek ??
      list.find((week) => {
        const end = getEtDayEnd(week.week_end);
        return end !== null && end >= nowTime;
      }) ??
      list[list.length - 1] ??
      null;

    if (statusWeek) {
      statusWeekByLeague.set(leagueId, statusWeek);
    }
  });

  const lineupWeekIds = [...new Set([...upcomingWeekIds, ...currentWeekIds])];
  const statusWeekIds = [
    ...new Set([...statusWeekByLeague.values()].map((week) => week.id))
  ];

  const { data: memberRows, error: memberCountsError } = await supabase
    .from("league_members")
    .select("league_id")
    .in("league_id", leagueIds);

  if (memberCountsError) {
    return NextResponse.json({ error: memberCountsError.message }, { status: 500 });
  }

  const memberCountByLeague = new Map<string, number>();
  (memberRows ?? []).forEach((row) => {
    const leagueId = row.league_id;
    memberCountByLeague.set(leagueId, (memberCountByLeague.get(leagueId) ?? 0) + 1);
  });

  const { data: statusLineups, error: statusLineupsError } = statusWeekIds.length
    ? await supabase
        .from("lineups")
        .select("league_id, week_id, user_id, submitted_at, user_locked_at")
        .in("league_id", leagueIds)
        .in("week_id", statusWeekIds)
    : { data: [], error: null };

  if (statusLineupsError) {
    return NextResponse.json({ error: statusLineupsError.message }, { status: 500 });
  }

  const lockedUsersByLeague = new Map<string, Set<string>>();
  (statusLineups ?? []).forEach((lineup) => {
    const targetWeek = statusWeekByLeague.get(lineup.league_id);
    if (!targetWeek || targetWeek.id !== lineup.week_id) {
      return;
    }
    const users = lockedUsersByLeague.get(lineup.league_id) ?? new Set<string>();
    users.add(lineup.user_id);
    lockedUsersByLeague.set(lineup.league_id, users);
  });
  const lockedCountByLeague = new Map(
    [...lockedUsersByLeague.entries()].map(([leagueId, users]) => [
      leagueId,
      users.size
    ])
  );

  const { data: lineups, error: lineupError } = lineupWeekIds.length
    ? await supabase
        .from("lineups")
        .select("league_id, week_id")
        .eq("user_id", user.id)
        .in("week_id", lineupWeekIds)
    : { data: [], error: null };

  if (lineupError) {
    return NextResponse.json({ error: lineupError.message }, { status: 500 });
  }

  const lineupSetByLeague = new Map<string, boolean>();
  const currentLineupSetByLeague = new Map<string, boolean>();
  (lineups ?? []).forEach((lineup) => {
    const isCurrent = currentWeekIds.includes(lineup.week_id);
    if (isCurrent) {
      currentLineupSetByLeague.set(lineup.league_id, true);
    } else {
      lineupSetByLeague.set(lineup.league_id, true);
    }
  });

  const enriched = leagues.map((league) => {
    const typed = league as { id: string; created_by?: string | null };
    return {
      ...league,
      current_week: currentWeekByLeague.get(typed.id) ?? null,
      next_week: nextWeekByLeague.get(typed.id) ?? null,
      lineup_set: lineupSetByLeague.get(typed.id) ?? false,
      current_lineup_set: currentLineupSetByLeague.get(typed.id) ?? false,
      member_count: memberCountByLeague.get(typed.id) ?? 0,
      locked_lineups: lockedCountByLeague.get(typed.id) ?? 0,
      is_creator: typed.created_by === user.id
    };
  });

  const payload = { leagues: enriched };
  cache.set(cacheKey, { timestamp: Date.now(), payload });
  return NextResponse.json(payload);
}

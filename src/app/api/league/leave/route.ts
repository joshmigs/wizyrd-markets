import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { buildMatchupsForWeek } from "@/lib/matchups";
import { ensureBenchmarkUser } from "@/lib/benchmark";
import { getEtDayEnd } from "@/lib/time";

type WeekRow = {
  id: string;
  week_start: string;
  week_end: string;
  lock_time: string;
};

type MatchupRow = {
  id: string;
  week_id: string;
  home_user_id: string;
  away_user_id: string;
};

const resolveWeekEnd = (weekEnd: string) => {
  const end = getEtDayEnd(weekEnd);
  if (end !== null) {
    return end;
  }
  const parsed = new Date(weekEnd).getTime();
  return Number.isNaN(parsed) ? null : parsed;
};

export async function POST(request: Request) {
  const { user, error, status } = await getAuthenticatedUser(request);
  if (!user) {
    return NextResponse.json({ error }, { status });
  }

  const body = await request.json().catch(() => null);
  const leagueId = body?.leagueId;
  if (!leagueId) {
    return NextResponse.json({ error: "League is required." }, { status: 400 });
  }

  const supabase = createSupabaseServiceClient();
  const { data: league, error: leagueError } = await supabase
    .from("leagues")
    .select("id, created_by")
    .eq("id", leagueId)
    .maybeSingle();

  if (leagueError) {
    return NextResponse.json({ error: leagueError.message }, { status: 500 });
  }
  if (!league) {
    return NextResponse.json({ error: "League not found." }, { status: 404 });
  }
  if (league.created_by === user.id) {
    return NextResponse.json(
      { error: "Commissioners must delete the league to leave it." },
      { status: 403 }
    );
  }

  const { data: membership } = await supabase
    .from("league_members")
    .select("user_id")
    .eq("league_id", leagueId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!membership) {
    return NextResponse.json({ error: "Not a member of this league." }, { status: 403 });
  }

  const { data: memberRows, error: membersError } = await supabase
    .from("league_members")
    .select("user_id")
    .eq("league_id", leagueId);

  if (membersError) {
    return NextResponse.json({ error: membersError.message }, { status: 500 });
  }

  const memberIds = (memberRows ?? [])
    .map((row) => row.user_id)
    .filter(Boolean);

  const { data: weeks, error: weeksError } = await supabase
    .from("weeks")
    .select("id, week_start, week_end, lock_time")
    .eq("league_id", leagueId)
    .order("week_start", { ascending: true });

  if (weeksError) {
    return NextResponse.json({ error: weeksError.message }, { status: 500 });
  }

  const now = Date.now();
  const remainingWeeks = (weeks ?? []).filter((week) => {
    const end = resolveWeekEnd(week.week_end);
    return end !== null && end >= now;
  }) as WeekRow[];

  const remainingWeekIds = remainingWeeks.map((week) => week.id);

  if (remainingWeekIds.length) {
    const { data: historyRows, error: historyError } = await supabase
      .from("matchups")
      .select("id, week_id, home_user_id, away_user_id")
      .eq("league_id", leagueId);

    if (historyError) {
      return NextResponse.json({ error: historyError.message }, { status: 500 });
    }

    const matchupsByWeek = new Map<string, MatchupRow[]>();
    (historyRows ?? []).forEach((row) => {
      const list = matchupsByWeek.get(row.week_id) ?? [];
      list.push(row as MatchupRow);
      matchupsByWeek.set(row.week_id, list);
    });

    const historyPairs = (historyRows ?? []).map((row) => ({
      home_user_id: row.home_user_id,
      away_user_id: row.away_user_id
    }));

    let benchmarkUserId: string | null = null;
    if (memberIds.length % 2 === 1) {
      const { userId, error: benchmarkError } = await ensureBenchmarkUser(supabase);
      if (!userId && benchmarkError) {
        return NextResponse.json({ error: benchmarkError }, { status: 500 });
      }
      benchmarkUserId = userId;
    }

    for (const week of remainingWeeks) {
      const existing = matchupsByWeek.get(week.id) ?? [];
      if (existing.length) {
        continue;
      }
      const pairs = buildMatchupsForWeek(
        memberIds,
        historyPairs,
        week.id,
        benchmarkUserId ?? undefined
      );
      if (!pairs.length) {
        continue;
      }
      const { data: inserted, error: insertError } = await supabase
        .from("matchups")
        .insert(
          pairs.map((pair) => ({
            league_id: leagueId,
            week_id: week.id,
            home_user_id: pair.home_user_id,
            away_user_id: pair.away_user_id
          }))
        )
        .select("id, week_id, home_user_id, away_user_id");

      if (insertError) {
        return NextResponse.json({ error: insertError.message }, { status: 500 });
      }

      (inserted ?? []).forEach((matchup) => {
        historyPairs.push({
          home_user_id: matchup.home_user_id,
          away_user_id: matchup.away_user_id
        });
        const list = matchupsByWeek.get(matchup.week_id) ?? [];
        list.push(matchup as MatchupRow);
        matchupsByWeek.set(matchup.week_id, list);
      });
    }
  }

  const { error: leaveError } = await supabase
    .from("league_members")
    .delete()
    .eq("league_id", leagueId)
    .eq("user_id", user.id);

  if (leaveError) {
    return NextResponse.json({ error: leaveError.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { scoreWeekIfReady } from "@/lib/scoring-runner";

type MatchupRow = {
  id: string;
  league_id: string;
  week_id: string;
  home_user_id: string;
  away_user_id: string;
  home_score: number | null;
  away_score: number | null;
  winner_user_id: string | null;
};

type WeekRow = {
  id: string;
  week_start: string;
  week_end: string;
  league_id: string;
};

type LeagueRow = {
  id: string;
  name: string;
};

type ProfileRow = {
  id: string;
  display_name: string;
  team_logo_url?: string | null;
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

export async function GET(request: Request) {
  const { user, error, status } = await getAuthenticatedUser(request);
  if (!user) {
    return NextResponse.json({ error }, { status });
  }

  const { searchParams } = new URL(request.url);
  const leagueId = searchParams.get("leagueId");
  const range = searchParams.get("range") ?? "4w";
  const startDate = getRangeStartDate(range);

  const supabase = createSupabaseServiceClient();

  const buildMatchupsQuery = () => {
    let query = supabase
      .from("matchups")
      .select(
        "id, league_id, week_id, home_user_id, away_user_id, home_score, away_score, winner_user_id"
      )
      .or(`home_user_id.eq.${user.id},away_user_id.eq.${user.id}`);

    if (leagueId) {
      query = query.eq("league_id", leagueId);
    }
    return query;
  };

  const { data: matchupData, error: matchupError } = await buildMatchupsQuery();
  if (matchupError) {
    return NextResponse.json({ error: matchupError.message }, { status: 500 });
  }

  let matchups = (matchupData ?? []) as MatchupRow[];
  if (!matchups.length) {
    return NextResponse.json({ results: [] });
  }

  const weekIds = [...new Set(matchups.map((matchup) => matchup.week_id))];
  const { data: weekData, error: weekError } = await supabase
    .from("weeks")
    .select("id, week_start, week_end, league_id")
    .in("id", weekIds);

  if (weekError) {
    return NextResponse.json({ error: weekError.message }, { status: 500 });
  }

  const weeks = (weekData ?? []) as WeekRow[];
  const weekById = new Map(weeks.map((week) => [week.id, week]));

  await Promise.all(
    weeks.map((week) =>
      scoreWeekIfReady({
        supabase,
        leagueId: week.league_id,
        weekId: week.id,
        weekEnd: week.week_end
      })
    )
  );

  const { data: refreshedMatchups, error: refreshError } = await buildMatchupsQuery();
  if (refreshError) {
    return NextResponse.json({ error: refreshError.message }, { status: 500 });
  }
  matchups = (refreshedMatchups ?? []) as MatchupRow[];

  const filteredWeekIds = startDate
    ? new Set(
        weeks
          .filter((week) => new Date(week.week_end) >= new Date(startDate))
          .map((week) => week.id)
      )
    : null;

  const filteredMatchups = filteredWeekIds
    ? matchups.filter((matchup) => filteredWeekIds.has(matchup.week_id))
    : matchups;

  const leagueIds = [
    ...new Set(filteredMatchups.map((matchup) => matchup.league_id))
  ];
  const { data: leagueData, error: leagueError } = await supabase
    .from("leagues")
    .select("id, name")
    .in("id", leagueIds);

  if (leagueError) {
    return NextResponse.json({ error: leagueError.message }, { status: 500 });
  }

  const leagues = (leagueData ?? []) as LeagueRow[];
  const leagueById = new Map(leagues.map((league) => [league.id, league]));

  const profileIds = [
    ...new Set(
      filteredMatchups.flatMap((matchup) => [
        matchup.home_user_id,
        matchup.away_user_id
      ])
    )
  ];
  const { data: profileData, error: profileError } = await supabase
    .from("profiles")
    .select("id, display_name, team_logo_url")
    .in("id", profileIds);

  if (profileError) {
    return NextResponse.json({ error: profileError.message }, { status: 500 });
  }

  const profiles = (profileData ?? []) as ProfileRow[];
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));

  const results = filteredMatchups
    .map((matchup) => {
      const week = weekById.get(matchup.week_id) ?? null;
      const league = leagueById.get(matchup.league_id) ?? null;
      return {
        id: matchup.id,
        week,
        league,
        matchup,
        homeProfile: profileById.get(matchup.home_user_id) ?? null,
        awayProfile: profileById.get(matchup.away_user_id) ?? null
      };
    })
    .sort((a, b) => {
      const dateA = a.week?.week_start ?? "";
      const dateB = b.week?.week_start ?? "";
      return dateA < dateB ? 1 : -1;
    });

  return NextResponse.json({ results });
}

import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { ensureBenchmarkUser } from "@/lib/benchmark";

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
  home_score: number | null;
  away_score: number | null;
  winner_user_id: string | null;
};

type ProfileRow = {
  id: string;
  display_name: string;
  team_logo_url?: string | null;
};

export async function GET(request: Request) {
  const { user, error, status } = await getAuthenticatedUser(request);
  if (!user) {
    return NextResponse.json({ error }, { status });
  }

  const { searchParams } = new URL(request.url);
  const leagueId = searchParams.get("leagueId");
  if (!leagueId) {
    return NextResponse.json({ error: "League is required." }, { status: 400 });
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

  const { data: weeks, error: weeksError } = await supabase
    .from("weeks")
    .select("id, week_start, week_end, lock_time")
    .eq("league_id", leagueId);

  if (weeksError) {
    return NextResponse.json({ error: weeksError.message }, { status: 500 });
  }

  const weekList = (weeks ?? []) as WeekRow[];
  const weekById = new Map(weekList.map((week) => [week.id, week]));

  await ensureBenchmarkUser(supabase);

  const { data: matchups, error: matchupError } = await supabase
    .from("matchups")
    .select(
      "id, week_id, home_user_id, away_user_id, home_score, away_score, winner_user_id"
    )
    .eq("league_id", leagueId)
    .or(`home_user_id.eq.${user.id},away_user_id.eq.${user.id}`);

  if (matchupError) {
    return NextResponse.json({ error: matchupError.message }, { status: 500 });
  }

  const list = (matchups ?? []) as MatchupRow[];
  const profileIds = Array.from(
    new Set(list.flatMap((matchup) => [matchup.home_user_id, matchup.away_user_id]))
  );

  const { data: profiles, error: profileError } = await supabase
    .from("profiles")
    .select("id, display_name, team_logo_url")
    .in("id", profileIds);

  if (profileError) {
    return NextResponse.json({ error: profileError.message }, { status: 500 });
  }

  const profileMap = new Map(
    (profiles ?? []).map((profile) => [profile.id, profile as ProfileRow])
  );

  const items = list
    .map((matchup) => ({
      matchup,
      week: weekById.get(matchup.week_id) ?? null,
      homeProfile: profileMap.get(matchup.home_user_id) ?? null,
      awayProfile: profileMap.get(matchup.away_user_id) ?? null
    }))
    .sort((a, b) => {
      const aTime = a.week ? new Date(a.week.week_start).getTime() : 0;
      const bTime = b.week ? new Date(b.week.week_start).getTime() : 0;
      return bTime - aTime;
    });

  return NextResponse.json({ matchups: items });
}

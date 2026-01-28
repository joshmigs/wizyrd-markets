import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { isLineupLocked, validateLineupPositions } from "@/lib/lineup";
import { loadAllowedTickers } from "@/lib/universe";

export async function POST(request: Request) {
  const { user, error, status } = await getAuthenticatedUser(request);
  if (!user) {
    return NextResponse.json({ error }, { status });
  }

  const body = await request.json().catch(() => null);
  const leagueId = body?.leagueId;
  const weekId = body?.weekId;
  const positions = body?.positions;

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

  const { data: week, error: weekError } = await supabase
    .from("weeks")
    .select("id, lock_time, universe_snapshot_id")
    .eq("id", weekId)
    .eq("league_id", leagueId)
    .single();

  if (weekError || !week) {
    return NextResponse.json({ error: "Week not found." }, { status: 404 });
  }

  if (isLineupLocked(week.lock_time)) {
    return NextResponse.json({ error: "Lineups are locked for this week." }, { status: 403 });
  }

  const { allowed } = await loadAllowedTickers(
    supabase,
    week.universe_snapshot_id ?? null
  );

  const validation = validateLineupPositions(positions ?? [], 5, allowed);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const { data: lineup, error: lineupError } = await supabase
    .from("lineups")
    .upsert(
      {
        league_id: leagueId,
        week_id: weekId,
        user_id: user.id,
        submitted_at: new Date().toISOString(),
        user_locked_at: null
      },
      { onConflict: "week_id,user_id" }
    )
    .select("id")
    .single();

  if (lineupError || !lineup) {
    return NextResponse.json({ error: lineupError?.message }, { status: 500 });
  }

  const { error: deleteError } = await supabase
    .from("lineup_positions")
    .delete()
    .eq("lineup_id", lineup.id);

  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }

  const { error: insertError } = await supabase.from("lineup_positions").insert(
    validation.normalized.map((position) => ({
      lineup_id: lineup.id,
      ticker: position.ticker,
      weight: position.weight
    }))
  );

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  return NextResponse.json({ lineupId: lineup.id });
}

import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { isLineupLocked } from "@/lib/lineup";

export async function POST(request: Request) {
  const { user, error, status } = await getAuthenticatedUser(request);
  if (!user) {
    return NextResponse.json({ error }, { status });
  }

  const body = await request.json().catch(() => null);
  const leagueId = body?.leagueId;
  const weekId = body?.weekId;
  const locked = Boolean(body?.locked);

  if (!leagueId || !weekId) {
    return NextResponse.json({ error: "League and week are required." }, { status: 400 });
  }

  const supabase = createSupabaseServiceClient();

  const { data: week, error: weekError } = await supabase
    .from("weeks")
    .select("id, lock_time")
    .eq("id", weekId)
    .eq("league_id", leagueId)
    .single();

  if (weekError || !week) {
    return NextResponse.json({ error: "Week not found." }, { status: 404 });
  }

  if (isLineupLocked(week.lock_time)) {
    return NextResponse.json({ error: "Lineups are locked for this week." }, { status: 403 });
  }

  const { data: lineup, error: lineupError } = await supabase
    .from("lineups")
    .select("id, user_locked_at")
    .eq("league_id", leagueId)
    .eq("week_id", weekId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (lineupError) {
    return NextResponse.json({ error: lineupError.message }, { status: 500 });
  }

  if (!lineup) {
    return NextResponse.json(
      { error: "Save a lineup before locking it." },
      { status: 400 }
    );
  }

  const { data: updated, error: updateError } = await supabase
    .from("lineups")
    .update({ user_locked_at: locked ? new Date().toISOString() : null })
    .eq("id", lineup.id)
    .select("user_locked_at")
    .single();

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({ lockedAt: updated?.user_locked_at ?? null });
}

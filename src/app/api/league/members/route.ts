import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

type ActionType = "remove" | "ban";

export async function GET(request: Request) {
  const { user, error, status, superAdmin } = await getAuthenticatedUser(request);
  if (!user) {
    return NextResponse.json({ error }, { status });
  }

  const { searchParams } = new URL(request.url);
  const leagueId = searchParams.get("leagueId");
  if (!leagueId) {
    return NextResponse.json({ error: "League is required." }, { status: 400 });
  }

  const supabase = createSupabaseServiceClient();
  if (!superAdmin) {
    const { data: membership } = await supabase
      .from("league_members")
      .select("user_id")
      .eq("league_id", leagueId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!membership) {
      return NextResponse.json({ error: "Not a member of this league." }, { status: 403 });
    }
  }

  const { data, error: memberError } = await supabase
    .from("league_members")
    .select("user_id, profiles(id, display_name)")
    .eq("league_id", leagueId);

  if (memberError) {
    return NextResponse.json({ error: memberError.message }, { status: 500 });
  }

  const members = (data ?? [])
    .map((row) => {
      const typed = row as {
        user_id: string;
        profiles: { id: string; display_name: string | null } | null;
      };
      return {
        id: typed.user_id,
        display_name: typed.profiles?.display_name ?? null
      };
    })
    .filter((member) => Boolean(member.id));

  return NextResponse.json({ members });
}

export async function POST(request: Request) {
  const { user, error, status, superAdmin } = await getAuthenticatedUser(request);
  if (!user) {
    return NextResponse.json({ error }, { status });
  }

  const body = (await request.json().catch(() => null)) as {
    leagueId?: string;
    userId?: string;
    action?: ActionType;
    reason?: string | null;
  } | null;

  const leagueId = body?.leagueId;
  const userId = body?.userId;
  const action = body?.action;
  const reason = body?.reason?.trim() || null;

  if (!leagueId || !userId || !action) {
    return NextResponse.json(
      { error: "League, user, and action are required." },
      { status: 400 }
    );
  }

  if (action !== "remove" && action !== "ban") {
    return NextResponse.json({ error: "Invalid action." }, { status: 400 });
  }

  const supabase = createSupabaseServiceClient();
  const { data: league, error: leagueError } = await supabase
    .from("leagues")
    .select("id, created_by")
    .eq("id", leagueId)
    .maybeSingle();

  if (leagueError || !league) {
    return NextResponse.json({ error: "League not found." }, { status: 404 });
  }

  if (league.created_by !== user.id && !superAdmin) {
    return NextResponse.json(
      { error: "Only the league creator can manage members." },
      { status: 403 }
    );
  }

  if (userId === league.created_by) {
    return NextResponse.json(
      { error: "You cannot remove the league creator." },
      { status: 400 }
    );
  }

  const { error: removeError } = await supabase
    .from("league_members")
    .delete()
    .eq("league_id", leagueId)
    .eq("user_id", userId);

  if (removeError) {
    return NextResponse.json({ error: removeError.message }, { status: 500 });
  }

  if (action === "ban") {
    const { error: banError } = await supabase.from("league_bans").upsert(
      {
        league_id: leagueId,
        user_id: userId,
        banned_by: user.id,
        reason
      },
      { onConflict: "league_id,user_id" }
    );

    if (banError) {
      return NextResponse.json({ error: banError.message }, { status: 500 });
    }
  }

  return NextResponse.json({ success: true });
}

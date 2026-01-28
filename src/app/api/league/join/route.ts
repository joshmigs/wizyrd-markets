import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { ensureProfile } from "@/lib/profiles";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const { user, error, status } = await getAuthenticatedUser(request);
  if (!user) {
    return NextResponse.json({ error }, { status });
  }

  const body = await request.json().catch(() => null);
  const inviteCode = body?.inviteCode?.trim()?.toUpperCase();
  if (!inviteCode) {
    return NextResponse.json({ error: "Invite code is required." }, { status: 400 });
  }

  const supabase = createSupabaseServiceClient();
  try {
    await ensureProfile(user);
  } catch (profileError) {
    return NextResponse.json(
      { error: (profileError as Error).message },
      { status: 500 }
    );
  }

  const { data: league, error: leagueError } = await supabase
    .from("leagues")
    .select("id, name, invite_code, max_members")
    .eq("invite_code", inviteCode)
    .single();

  if (leagueError || !league) {
    return NextResponse.json({ error: "Invite code not found." }, { status: 404 });
  }

  const { data: leagueBan, error: leagueBanError } = await supabase
    .from("league_bans")
    .select("user_id")
    .eq("league_id", league.id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (
    leagueBanError &&
    !(
      leagueBanError.code === "42P01" ||
      leagueBanError.code === "PGRST205" ||
      leagueBanError.message?.includes("schema cache")
    )
  ) {
    return NextResponse.json({ error: leagueBanError.message }, { status: 500 });
  }

  if (leagueBan) {
    return NextResponse.json(
      { error: "You are not allowed to join this league." },
      { status: 403 }
    );
  }

  const { data: existingMember } = await supabase
    .from("league_members")
    .select("user_id")
    .eq("league_id", league.id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (existingMember) {
    if (user.email) {
      await supabase
        .from("league_invites")
        .update({ status: "accepted", responded_at: new Date().toISOString() })
        .eq("league_id", league.id)
        .eq("email", user.email.toLowerCase())
        .eq("status", "pending");
    }
    return NextResponse.json({ league });
  }

  const { count, error: countError } = await supabase
    .from("league_members")
    .select("user_id", { count: "exact", head: true })
    .eq("league_id", league.id);

  if (countError) {
    return NextResponse.json({ error: countError.message }, { status: 500 });
  }

  const maxMembers = Number(league.max_members);
  if (Number.isFinite(maxMembers) && count !== null && count >= maxMembers) {
    return NextResponse.json(
      { error: "This league is full." },
      { status: 403 }
    );
  }

  const { error: memberError } = await supabase
    .from("league_members")
    .insert({ league_id: league.id, user_id: user.id });

  if (memberError && memberError.code !== "23505") {
    return NextResponse.json({ error: memberError.message }, { status: 500 });
  }

  if (user.email) {
    await supabase
      .from("league_invites")
      .update({ status: "accepted", responded_at: new Date().toISOString() })
      .eq("league_id", league.id)
      .eq("email", user.email.toLowerCase())
      .eq("status", "pending");
  }

  return NextResponse.json({ league });
}

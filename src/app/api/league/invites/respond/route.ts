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
  const inviteId = body?.inviteId as string | undefined;
  const action = body?.action as "accept" | "decline" | undefined;

  if (!inviteId || !action) {
    return NextResponse.json({ error: "Invite and action are required." }, { status: 400 });
  }

  const email = user.email?.toLowerCase();
  if (!email) {
    return NextResponse.json({ error: "Missing email address." }, { status: 400 });
  }

  const supabase = createSupabaseServiceClient();
  const { data: invite, error: inviteError } = await supabase
    .from("league_invites")
    .select("id, league_id, email, status, leagues(id, name, invite_code, max_members)")
    .eq("id", inviteId)
    .maybeSingle();

  if (inviteError || !invite) {
    return NextResponse.json({ error: "Invite not found." }, { status: 404 });
  }

  if (invite.email?.toLowerCase() !== email) {
    return NextResponse.json({ error: "Not authorized for this invite." }, { status: 403 });
  }

  if (action === "decline") {
    const { error: declineError } = await supabase
      .from("league_invites")
      .update({ status: "declined", responded_at: new Date().toISOString() })
      .eq("id", inviteId);
    if (declineError) {
      return NextResponse.json({ error: declineError.message }, { status: 500 });
    }
    return NextResponse.json({ status: "declined" });
  }

  try {
    await ensureProfile(user);
  } catch (profileError) {
    return NextResponse.json(
      { error: (profileError as Error).message },
      { status: 500 }
    );
  }

  const leagueId = invite.leagues?.id ?? invite.league_id;
  if (!leagueId) {
    return NextResponse.json({ error: "League not found." }, { status: 404 });
  }

  const { data: leagueBan, error: leagueBanError } = await supabase
    .from("league_bans")
    .select("user_id")
    .eq("league_id", leagueId)
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
    .eq("league_id", leagueId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!existingMember) {
    const { count, error: countError } = await supabase
      .from("league_members")
      .select("user_id", { count: "exact", head: true })
      .eq("league_id", leagueId);

    if (countError) {
      return NextResponse.json({ error: countError.message }, { status: 500 });
    }

    const maxMembers = Number(invite.leagues?.max_members ?? null);
    if (Number.isFinite(maxMembers) && count !== null && count >= maxMembers) {
      return NextResponse.json({ error: "This league is full." }, { status: 403 });
    }

    const { error: memberError } = await supabase
      .from("league_members")
      .insert({ league_id: leagueId, user_id: user.id });

    if (memberError && memberError.code !== "23505") {
      return NextResponse.json({ error: memberError.message }, { status: 500 });
    }
  }

  const { error: acceptError } = await supabase
    .from("league_invites")
    .update({ status: "accepted", responded_at: new Date().toISOString() })
    .eq("id", inviteId);

  if (acceptError) {
    return NextResponse.json({ error: acceptError.message }, { status: 500 });
  }

  return NextResponse.json({ status: "accepted", leagueId });
}

import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const { user, error, status, superAdmin } = await getAuthenticatedUser(request);
  if (!user) {
    return NextResponse.json({ error }, { status });
  }

  const body = (await request.json().catch(() => null)) as {
    leagueId?: string;
  } | null;

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
  if (league.created_by !== user.id && !superAdmin) {
    return NextResponse.json(
      { error: "Only the league creator can delete this league." },
      { status: 403 }
    );
  }

  const { error: deleteError } = await supabase
    .from("leagues")
    .delete()
    .eq("id", leagueId);

  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

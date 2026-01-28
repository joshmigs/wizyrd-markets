import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { user, error, status } = await getAuthenticatedUser(request);
  if (!user) {
    return NextResponse.json({ error }, { status });
  }

  const email = user.email?.toLowerCase();
  if (!email) {
    return NextResponse.json({ error: "Missing email address." }, { status: 400 });
  }

  const supabase = createSupabaseServiceClient();
  const { data, error: inviteError } = await supabase
    .from("league_invites")
    .select("id, league_id, status, created_at, leagues(id, name, invite_code)")
    .eq("email", email)
    .eq("status", "pending")
    .order("created_at", { ascending: false });

  if (inviteError) {
    return NextResponse.json({ error: inviteError.message }, { status: 500 });
  }

  return NextResponse.json({ invites: data ?? [] });
}

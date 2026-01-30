import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { user, error, status } = await getAuthenticatedUser(request);
  if (!user) {
    return NextResponse.json({ error }, { status });
  }

  const supabase = createSupabaseServiceClient();
  const { data: memberships, error: membershipError } = await supabase
    .from("league_members")
    .select("league_id")
    .eq("user_id", user.id);

  if (membershipError) {
    return NextResponse.json({ error: membershipError.message }, { status: 500 });
  }

  const leagueIds = (memberships ?? [])
    .map((row) => (row as { league_id: string | null }).league_id)
    .filter(Boolean) as string[];

  if (leagueIds.length === 0) {
    return NextResponse.json({ usernames: [] });
  }

  const { data: members, error: memberError } = await supabase
    .from("league_members")
    .select("user_id, profiles(display_name)")
    .in("league_id", leagueIds);

  if (memberError) {
    return NextResponse.json({ error: memberError.message }, { status: 500 });
  }

  const usernames = Array.from(
    new Set(
      (members ?? [])
        .map((row) => {
          const typed = row as {
            user_id: string;
            profiles: { display_name: string | null } | null;
          };
          if (typed.user_id === user.id) {
            return null;
          }
          return typed.profiles?.display_name ?? null;
        })
        .filter(Boolean) as string[]
    )
  ).sort((a, b) => a.localeCompare(b));

  return NextResponse.json({ usernames });
}

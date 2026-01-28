import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

type LeagueMemberRow = {
  user_id: string;
  profiles: {
    id: string;
    display_name: string | null;
    team_logo_url: string | null;
  } | null;
};

type LeagueRow = {
  id: string;
  name: string;
  invite_code: string;
  created_by: string;
  created_at: string;
  league_members: LeagueMemberRow[] | null;
};

export async function GET(request: Request) {
  const { user, error, status, superAdmin } = await getAuthenticatedUser(request);
  if (!user) {
    return NextResponse.json({ error }, { status });
  }

  if (!superAdmin) {
    return NextResponse.json(
      { error: "Super admin access required." },
      { status: 403 }
    );
  }

  const supabase = createSupabaseServiceClient();
  const { data, error: leaguesError } = await supabase
    .from("leagues")
    .select(
      "id, name, invite_code, created_by, created_at, league_members(user_id, profiles(id, display_name, team_logo_url))"
    )
    .order("created_at", { ascending: false });

  if (leaguesError) {
    return NextResponse.json({ error: leaguesError.message }, { status: 500 });
  }

  const leagues = (data ?? []).map((row) => {
    const typed = row as LeagueRow;
    const members = (typed.league_members ?? []).map((member) => ({
      id: member.user_id,
      display_name: member.profiles?.display_name ?? null,
      team_logo_url: member.profiles?.team_logo_url ?? null,
      is_creator: member.user_id === typed.created_by
    }));

    return {
      id: typed.id,
      name: typed.name,
      invite_code: typed.invite_code,
      created_by: typed.created_by,
      created_at: typed.created_at,
      member_count: members.length,
      members
    };
  });

  return NextResponse.json({ leagues });
}

import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

const MESSAGE_TABLE = "direct_messages";

const isMissingTable = (error?: { code?: string | null; message?: string | null }) =>
  error?.code === "42P01" ||
  error?.code === "PGRST205" ||
  Boolean(error?.message?.includes("schema cache"));

export async function GET(request: Request) {
  const { user, error, status } = await getAuthenticatedUser(request);
  if (!user) {
    return NextResponse.json({ error }, { status });
  }

  const supabase = createSupabaseServiceClient();
  const { data, error: fetchError } = await supabase
    .from(MESSAGE_TABLE)
    .select("league_id")
    .eq("recipient_id", user.id)
    .is("read_at", null);

  if (fetchError) {
    if (isMissingTable(fetchError)) {
      return NextResponse.json(
        { error: "Messaging storage is not configured yet." },
        { status: 500 }
      );
    }
    return NextResponse.json({ error: fetchError.message }, { status: 500 });
  }

  const counts: Record<string, number> = {};
  (data ?? []).forEach((row) => {
    const leagueId = row.league_id;
    if (!leagueId) {
      return;
    }
    counts[leagueId] = (counts[leagueId] ?? 0) + 1;
  });

  const leagues = Object.entries(counts).map(([leagueId, unread]) => ({
    leagueId,
    unread
  }));

  return NextResponse.json({ leagues });
}

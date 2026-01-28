import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

const MESSAGE_TABLE = "direct_messages";

const isMissingTable = (error?: { code?: string | null; message?: string | null }) =>
  error?.code === "42P01" ||
  error?.code === "PGRST205" ||
  Boolean(error?.message?.includes("schema cache"));

const isMissingScopeColumn = (error?: { code?: string | null; message?: string | null }) =>
  error?.code === "42703" && Boolean(error?.message?.includes("scope"));

export async function GET(request: Request) {
  const { user, error, status } = await getAuthenticatedUser(request);
  if (!user) {
    return NextResponse.json({ error }, { status });
  }

  const { searchParams } = new URL(request.url);
  const leagueId = searchParams.get("leagueId") ?? "";
  if (!leagueId) {
    return NextResponse.json({ error: "League is required." }, { status: 400 });
  }

  const supabase = createSupabaseServiceClient();
  const { data: membership, error: membershipError } = await supabase
    .from("league_members")
    .select("user_id")
    .eq("league_id", leagueId)
    .eq("user_id", user.id)
    .limit(1);

  if (membershipError) {
    return NextResponse.json({ error: membershipError.message }, { status: 500 });
  }

  if (!membership?.length) {
    return NextResponse.json({ error: "Messaging is limited to league members." }, { status: 403 });
  }

  const { data, error: fetchError } = await supabase
    .from(MESSAGE_TABLE)
    .select("sender_id, scope")
    .eq("league_id", leagueId)
    .eq("recipient_id", user.id)
    .is("read_at", null);

  if (fetchError) {
    if (isMissingTable(fetchError)) {
      return NextResponse.json(
        { error: "Messaging storage is not configured yet." },
        { status: 500 }
      );
    }
    if (isMissingScopeColumn(fetchError)) {
      return NextResponse.json(
        { error: "Messaging storage needs a scope column." },
        { status: 500 }
      );
    }
    return NextResponse.json({ error: fetchError.message }, { status: 500 });
  }

  const counts: Record<string, number> = {};
  let leagueUnread = 0;
  (data ?? []).forEach((row) => {
    if (row.scope === "league") {
      if (row.sender_id && row.sender_id === user.id) {
        return;
      }
      leagueUnread += 1;
      return;
    }
    const senderId = row.sender_id;
    if (!senderId) {
      return;
    }
    counts[senderId] = (counts[senderId] ?? 0) + 1;
  });

  const members = Object.entries(counts).map(([userId, unread]) => ({
    userId,
    unread
  }));

  return NextResponse.json({ members, leagueUnread });
}

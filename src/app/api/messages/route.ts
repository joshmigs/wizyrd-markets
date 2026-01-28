import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

const MESSAGE_TABLE = "direct_messages";
const SCOPE_DIRECT = "direct";
const SCOPE_LEAGUE = "league";

const isMissingTable = (error?: { code?: string | null; message?: string | null }) =>
  error?.code === "42P01" ||
  error?.code === "PGRST205" ||
  Boolean(error?.message?.includes("schema cache"));

const isMissingScopeColumn = (error?: { code?: string | null; message?: string | null }) =>
  error?.code === "42703" && Boolean(error?.message?.includes("scope"));

const ensureLeagueMembers = async (
  supabase: ReturnType<typeof createSupabaseServiceClient>,
  leagueId: string,
  userIds: string[]
) => {
  const { data, error } = await supabase
    .from("league_members")
    .select("user_id")
    .eq("league_id", leagueId)
    .in("user_id", userIds);

  if (error) {
    return { error: error.message, status: 500 };
  }

  const members = new Set((data ?? []).map((row) => row.user_id));
  const missing = userIds.some((id) => !members.has(id));
  if (missing) {
    return { error: "Messaging is limited to league members.", status: 403 };
  }

  return { error: null, status: 200 };
};

export async function GET(request: Request) {
  const { user, error, status } = await getAuthenticatedUser(request);
  if (!user) {
    return NextResponse.json({ error }, { status });
  }

  const { searchParams } = new URL(request.url);
  const leagueId = searchParams.get("leagueId") ?? "";
  const otherUserId = searchParams.get("userId") ?? "";
  const scope = (searchParams.get("scope") ?? SCOPE_DIRECT).toLowerCase();
  if (!leagueId || (scope === SCOPE_DIRECT && !otherUserId)) {
    return NextResponse.json(
      { error: "League and user are required." },
      { status: 400 }
    );
  }

  const supabase = createSupabaseServiceClient();
  if (scope === SCOPE_LEAGUE) {
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
      return NextResponse.json(
        { error: "Messaging is limited to league members." },
        { status: 403 }
      );
    }

    const { data, error: fetchError } = await supabase
      .from(MESSAGE_TABLE)
      .select("id, league_id, sender_id, recipient_id, message, created_at, read_at")
      .eq("league_id", leagueId)
      .eq("scope", SCOPE_LEAGUE)
      .order("created_at", { ascending: true })
      .limit(500);

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

    const unique = new Map<string, typeof data[number]>();
    (data ?? []).forEach((row) => {
      const key = `${row.sender_id}|${row.message}|${row.created_at}`;
      if (!unique.has(key)) {
        unique.set(key, row);
      }
    });

    return NextResponse.json({ messages: Array.from(unique.values()) });
  }

  if (!otherUserId) {
    return NextResponse.json(
      { error: "League and user are required." },
      { status: 400 }
    );
  }

  const membership = await ensureLeagueMembers(supabase, leagueId, [
    user.id,
    otherUserId
  ]);
  if (membership.error) {
    return NextResponse.json(
      { error: membership.error },
      { status: membership.status }
    );
  }

  const { data, error: fetchError } = await supabase
    .from(MESSAGE_TABLE)
    .select("id, league_id, sender_id, recipient_id, message, created_at, read_at")
    .eq("league_id", leagueId)
    .eq("scope", SCOPE_DIRECT)
    .or(
      `and(sender_id.eq.${user.id},recipient_id.eq.${otherUserId}),and(sender_id.eq.${otherUserId},recipient_id.eq.${user.id})`
    )
    .order("created_at", { ascending: true })
    .limit(200);

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

  return NextResponse.json({ messages: data ?? [] });
}

export async function POST(request: Request) {
  const { user, error, status } = await getAuthenticatedUser(request);
  if (!user) {
    return NextResponse.json({ error }, { status });
  }

  const body = (await request.json().catch(() => null)) as {
    leagueId?: string;
    recipientId?: string;
    message?: string;
    scope?: string;
  } | null;

  const leagueId = body?.leagueId ?? "";
  const recipientId = body?.recipientId ?? "";
  const message = body?.message?.trim() ?? "";
  const scope = (body?.scope ?? SCOPE_DIRECT).toLowerCase();

  if (!leagueId || !message) {
    return NextResponse.json(
      { error: "League, recipient, and message are required." },
      { status: 400 }
    );
  }

  const supabase = createSupabaseServiceClient();
  if (scope === SCOPE_LEAGUE) {
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
      return NextResponse.json(
        { error: "Messaging is limited to league members." },
        { status: 403 }
      );
    }

    const { data: memberRows, error: memberError } = await supabase
      .from("league_members")
      .select("user_id")
      .eq("league_id", leagueId);

    if (memberError) {
      return NextResponse.json({ error: memberError.message }, { status: 500 });
    }

    const recipients = new Set((memberRows ?? []).map((row) => row.user_id));
    recipients.add(user.id);
    const now = new Date().toISOString();
    const payload = Array.from(recipients).map((recipient) => ({
      league_id: leagueId,
      sender_id: user.id,
      recipient_id: recipient,
      message,
      scope: SCOPE_LEAGUE,
      read_at: recipient === user.id ? now : null
    }));

    const { data, error: insertError } = await supabase
      .from(MESSAGE_TABLE)
      .insert(payload)
      .select("id, created_at");

    if (insertError) {
      if (isMissingTable(insertError)) {
        return NextResponse.json(
          { error: "Messaging storage is not configured yet." },
          { status: 500 }
        );
      }
      if (isMissingScopeColumn(insertError)) {
        return NextResponse.json(
          { error: "Messaging storage needs a scope column." },
          { status: 500 }
        );
      }
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    const first = Array.isArray(data) ? data[0] : null;
    return NextResponse.json({
      id: first?.id ?? null,
      created_at: first?.created_at ?? null
    });
  }

  if (!recipientId) {
    return NextResponse.json(
      { error: "League, recipient, and message are required." },
      { status: 400 }
    );
  }

  const membership = await ensureLeagueMembers(supabase, leagueId, [
    user.id,
    recipientId
  ]);
  if (membership.error) {
    return NextResponse.json(
      { error: membership.error },
      { status: membership.status }
    );
  }

  const { data, error: insertError } = await supabase
    .from(MESSAGE_TABLE)
    .insert({
      league_id: leagueId,
      sender_id: user.id,
      recipient_id: recipientId,
      message,
      scope: SCOPE_DIRECT
    })
    .select("id, created_at")
    .maybeSingle();

  if (insertError) {
    if (isMissingTable(insertError)) {
      return NextResponse.json(
        { error: "Messaging storage is not configured yet." },
        { status: 500 }
      );
    }
    if (isMissingScopeColumn(insertError)) {
      return NextResponse.json(
        { error: "Messaging storage needs a scope column." },
        { status: 500 }
      );
    }
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  return NextResponse.json({ id: data?.id ?? null, created_at: data?.created_at ?? null });
}

export async function PATCH(request: Request) {
  const { user, error, status } = await getAuthenticatedUser(request);
  if (!user) {
    return NextResponse.json({ error }, { status });
  }

  const body = (await request.json().catch(() => null)) as {
    leagueId?: string;
    userId?: string;
    scope?: string;
  } | null;

  const leagueId = body?.leagueId ?? "";
  const otherUserId = body?.userId ?? "";
  const scope = (body?.scope ?? SCOPE_DIRECT).toLowerCase();

  if (!leagueId || (scope === SCOPE_DIRECT && !otherUserId)) {
    return NextResponse.json(
      { error: "League and user are required." },
      { status: 400 }
    );
  }

  const supabase = createSupabaseServiceClient();
  const readAt = new Date().toISOString();
  const updateQuery = supabase
    .from(MESSAGE_TABLE)
    .update({ read_at: readAt })
    .eq("league_id", leagueId)
    .eq("recipient_id", user.id)
    .eq("scope", scope)
    .is("read_at", null);

  if (scope === SCOPE_DIRECT) {
    updateQuery.eq("sender_id", otherUserId);
  }

  const { data, error: updateError } = await updateQuery.select("id");

  if (updateError) {
    if (isMissingTable(updateError)) {
      return NextResponse.json(
        { error: "Messaging storage is not configured yet." },
        { status: 500 }
      );
    }
    if (isMissingScopeColumn(updateError)) {
      return NextResponse.json(
        { error: "Messaging storage needs a scope column." },
        { status: 500 }
      );
    }
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({ updated: data?.length ?? 0, read_at: readAt });
}

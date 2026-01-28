import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

const TABLE = "wizyrd_chat_history";

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
    .from(TABLE)
    .select("messages, updated_at")
    .eq("user_id", user.id)
    .maybeSingle();

  if (fetchError) {
    if (isMissingTable(fetchError)) {
      return NextResponse.json(
        { error: "Chat history storage is not configured yet." },
        { status: 500 }
      );
    }
    return NextResponse.json({ error: fetchError.message }, { status: 500 });
  }

  return NextResponse.json({
    messages: Array.isArray(data?.messages) ? data?.messages : [],
    updated_at: data?.updated_at ?? null
  });
}

export async function PUT(request: Request) {
  const { user, error, status } = await getAuthenticatedUser(request);
  if (!user) {
    return NextResponse.json({ error }, { status });
  }

  const body = (await request.json().catch(() => null)) as {
    messages?: unknown;
  } | null;

  const messages = Array.isArray(body?.messages) ? body?.messages : [];
  const supabase = createSupabaseServiceClient();
  const updatedAt = new Date().toISOString();
  const { error: upsertError } = await supabase
    .from(TABLE)
    .upsert(
      {
        user_id: user.id,
        messages,
        updated_at: updatedAt
      },
      { onConflict: "user_id" }
    );

  if (upsertError) {
    if (isMissingTable(upsertError)) {
      return NextResponse.json(
        { error: "Chat history storage is not configured yet." },
        { status: 500 }
      );
    }
    return NextResponse.json({ error: upsertError.message }, { status: 500 });
  }

  return NextResponse.json({ updated_at: updatedAt });
}

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
  const { count, error: countError } = await supabase
    .from(MESSAGE_TABLE)
    .select("id", { count: "exact", head: true })
    .eq("recipient_id", user.id)
    .is("read_at", null);

  if (countError) {
    if (isMissingTable(countError)) {
      return NextResponse.json(
        { error: "Messaging storage is not configured yet." },
        { status: 500 }
      );
    }
    return NextResponse.json({ error: countError.message }, { status: 500 });
  }

  return NextResponse.json({ unread: count ?? 0 });
}

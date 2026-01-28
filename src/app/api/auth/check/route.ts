import { NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { resolveUserIdByEmail } from "@/lib/supabase/admin";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    displayName?: string;
    email?: string;
  };

  const displayName = (body.displayName ?? "").trim();
  const email = (body.email ?? "").trim().toLowerCase();

  const supabase = createSupabaseServiceClient();
  let displayNameTaken = false;
  let emailTaken = false;

  if (displayName) {
    const { data, error } = await supabase
      .from("profiles")
      .select("id")
      .ilike("display_name", displayName)
      .limit(1);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    displayNameTaken = (data?.length ?? 0) > 0;
  }

  if (email) {
    const { userId, error } = await resolveUserIdByEmail(supabase, email);
    if (error && error !== "User not found.") {
      return NextResponse.json({ error }, { status: 500 });
    }
    emailTaken = Boolean(userId);
  }

  return NextResponse.json({ displayNameTaken, emailTaken });
}

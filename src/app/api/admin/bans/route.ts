import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { resolveUserIdByIdentifier } from "@/lib/supabase/admin";

const PRIMARY_ADMIN_EMAIL = "joshuamigliardi@gmail.com";
const PRIMARY_ADMIN_USERNAME = "joshmigs";

const DURATION_DAYS: Record<string, number> = {
  "1w": 7,
  "2w": 14,
  "4w": 28,
  "3m": 90,
  "6m": 180,
  "9m": 270,
  "1y": 365
};

const computeEndDate = (duration?: string | null) => {
  if (!duration || duration === "permanent") {
    return null;
  }
  const days = DURATION_DAYS[duration];
  if (!days) {
    return null;
  }
  const end = new Date();
  end.setUTCDate(end.getUTCDate() + days);
  return end.toISOString();
};

export async function POST(request: Request) {
  const { user, error, status, owner, superAdmin } =
    await getAuthenticatedUser(request);
  if (!user) {
    return NextResponse.json({ error }, { status });
  }
  if (!owner && !superAdmin) {
    return NextResponse.json({ error: "Super admin access required." }, { status: 403 });
  }

  const { identifier, email, duration, reason } = (await request.json()) as {
    identifier?: string;
    email?: string;
    duration?: string;
    reason?: string | null;
  };

  const targetIdentifier = (identifier ?? email ?? "").trim();
  if (!targetIdentifier) {
    return NextResponse.json(
      { error: "Provide a target email or username." },
      { status: 400 }
    );
  }

  const normalizedIdentifier = targetIdentifier.toLowerCase();
  if (
    normalizedIdentifier === PRIMARY_ADMIN_EMAIL ||
    normalizedIdentifier === PRIMARY_ADMIN_USERNAME
  ) {
    return NextResponse.json(
      { error: "Primary admin access cannot be suspended." },
      { status: 403 }
    );
  }

  const supabase = createSupabaseServiceClient();
  const { userId, error: resolveError } = await resolveUserIdByIdentifier(
    supabase,
    targetIdentifier
  );
  if (resolveError || !userId) {
    const status =
      resolveError === "User not found."
        ? 404
        : resolveError?.includes("Multiple users match")
          ? 409
          : 500;
    return NextResponse.json({ error: resolveError ?? "User not found." }, { status });
  }
  if (userId === user.id) {
    return NextResponse.json({ error: "You cannot ban your own account." }, { status: 400 });
  }

  const { data: targetUserData } = await supabase.auth.admin.getUserById(userId);
  if (
    targetUserData?.user?.email?.toLowerCase() === PRIMARY_ADMIN_EMAIL
  ) {
    return NextResponse.json(
      { error: "Primary admin access cannot be suspended." },
      { status: 403 }
    );
  }

  const endsAt = computeEndDate(duration);

  await supabase.from("user_bans").delete().eq("user_id", userId);

  const { error: insertError } = await supabase.from("user_bans").insert({
    user_id: userId,
    banned_by: user.id,
    ends_at: endsAt,
    reason: reason ?? null
  });

  if (insertError) {
    if (insertError.code === "42P01") {
      return NextResponse.json(
        { error: "Ban table not configured." },
        { status: 500 }
      );
    }
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  return NextResponse.json({ bannedUntil: endsAt });
}

export async function DELETE(request: Request) {
  const { user, error, status, owner, superAdmin } =
    await getAuthenticatedUser(request);
  if (!user) {
    return NextResponse.json({ error }, { status });
  }
  if (!owner && !superAdmin) {
    return NextResponse.json({ error: "Super admin access required." }, { status: 403 });
  }

  const { identifier, email } = (await request.json()) as {
    identifier?: string;
    email?: string;
  };
  const targetIdentifier = (identifier ?? email ?? "").trim();
  if (!targetIdentifier) {
    return NextResponse.json(
      { error: "Provide a target email or username." },
      { status: 400 }
    );
  }

  const supabase = createSupabaseServiceClient();
  const { userId, error: resolveError } = await resolveUserIdByIdentifier(
    supabase,
    targetIdentifier
  );
  if (resolveError || !userId) {
    const status =
      resolveError === "User not found."
        ? 404
        : resolveError?.includes("Multiple users match")
          ? 409
          : 500;
    return NextResponse.json({ error: resolveError ?? "User not found." }, { status });
  }

  const { data, error: deleteError } = await supabase
    .from("user_bans")
    .delete()
    .eq("user_id", userId)
    .select("id");

  if (deleteError) {
    if (deleteError.code === "42P01") {
      return NextResponse.json(
        { error: "Ban table not configured." },
        { status: 500 }
      );
    }
    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }

  return NextResponse.json({ cleared: data?.length ?? 0 });
}

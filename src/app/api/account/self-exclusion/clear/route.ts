import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { resolveUserIdByIdentifier } from "@/lib/supabase/admin";

export async function POST(request: Request) {
  try {
    const { user, error, status, powerUser } = await getAuthenticatedUser(request);
    if (!user) {
      return NextResponse.json({ error }, { status });
    }

    if (!powerUser) {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }

    const body = await request.json().catch(() => null);
    const targetIdentifier = body?.identifier?.trim() ?? body?.email?.trim();
    const targetUserId = body?.userId?.trim();

    if (!targetIdentifier && !targetUserId) {
      return NextResponse.json(
        { error: "Provide a target email, username, or user id." },
        { status: 400 }
      );
    }

    const supabase = createSupabaseServiceClient();
    let resolvedUserId = targetUserId ?? null;

    if (!resolvedUserId && targetIdentifier) {
      const { userId, error: resolveError } = await resolveUserIdByIdentifier(
        supabase,
        targetIdentifier
      );
      if (resolveError) {
        const status =
          resolveError === "User not found."
            ? 404
            : resolveError.includes("Multiple users match")
              ? 409
              : 500;
        return NextResponse.json({ error: resolveError }, { status });
      }
      resolvedUserId = userId;
    }

    const { data, error: deleteError } = await supabase
      .from("self_exclusions")
      .delete()
      .eq("user_id", resolvedUserId)
      .select("id");

    if (deleteError) {
      return NextResponse.json({ error: deleteError.message }, { status: 500 });
    }

    return NextResponse.json({ cleared: data?.length ?? 0 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unable to clear self-exclusion.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

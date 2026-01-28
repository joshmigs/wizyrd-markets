import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import {
  resolveUserIdByEmail,
  resolveUserIdByIdentifier
} from "@/lib/supabase/admin";
import { ensureProfile } from "@/lib/profiles";

const PRIMARY_ADMIN_EMAIL = "joshuamigliardi@gmail.com";

type AdminUserRow = {
  user_id: string;
  role?: string | null;
  added_by?: string | null;
  created_at?: string | null;
};

const shouldIgnoreAdminError = (error?: { code?: string | null; message?: string | null }) =>
  error?.code === "42P01" ||
  error?.code === "PGRST205" ||
  Boolean(error?.message?.includes("schema cache"));

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
  const { data, error: listError } = await supabase
    .from("admin_users")
    .select("user_id, role, added_by, created_at")
    .order("created_at", { ascending: false });

  if (listError) {
    if (shouldIgnoreAdminError(listError)) {
      return NextResponse.json({
        superAdmins: [],
        warning: "Super admin table not configured yet."
      });
    }
    return NextResponse.json({ error: listError.message }, { status: 500 });
  }

  const rows = (data ?? []) as AdminUserRow[];
  const adminRowMap = new Map(rows.map((row) => [row.user_id, row]));
  const { userId: primaryUserId } = await resolveUserIdByEmail(
    supabase,
    PRIMARY_ADMIN_EMAIL
  );

  const userIds = Array.from(
    new Set([
      ...rows.map((row) => row.user_id).filter(Boolean),
      ...(primaryUserId ? [primaryUserId] : [])
    ])
  );

  const profileMap = new Map<string, string>();
  if (userIds.length) {
    const { data: profileRows } = await supabase
      .from("profiles")
      .select("id, display_name")
      .in("id", userIds);
    (profileRows ?? []).forEach((profile) => {
      if (profile?.id) {
        profileMap.set(profile.id, profile.display_name ?? "");
      }
    });
  }

  const emailMap = new Map<string, string>();
  await Promise.all(
    userIds.map(async (userId) => {
      try {
        const { data: userData } = await supabase.auth.admin.getUserById(userId);
        if (userData?.user?.email) {
          emailMap.set(userId, userData.user.email);
        }
      } catch (_error) {
        // ignore lookup errors
      }
    })
  );

  const superAdmins = userIds.map((userId) => {
    const row = adminRowMap.get(userId);
    const displayName = profileMap.get(userId) || null;
    const userEmail = emailMap.get(userId) ?? null;
    return {
      user_id: userId,
      display_name: displayName,
      user_email: userEmail,
      role: row?.role ?? "super_admin",
      added_by: row?.added_by ?? null,
      created_at: row?.created_at ?? null,
      primary: Boolean(primaryUserId && userId === primaryUserId)
    };
  });

  return NextResponse.json({ superAdmins });
}

export async function POST(request: Request) {
  try {
    const { user, error, status, owner } = await getAuthenticatedUser(request);
    if (!user) {
      return NextResponse.json({ error }, { status });
    }

    const isPrimaryAdmin = user.email?.toLowerCase() === PRIMARY_ADMIN_EMAIL;
    if (!owner && !isPrimaryAdmin) {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }

    const body = await request.json().catch(() => null);
    const targetIdentifier = body?.identifier?.trim() ?? body?.email?.trim();
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
    if (resolveError) {
      const statusCode =
        resolveError === "User not found."
          ? 404
          : resolveError.includes("Multiple users match")
            ? 409
            : 500;
      return NextResponse.json({ error: resolveError }, { status: statusCode });
    }

    const { data: targetAuth, error: targetAuthError } =
      await supabase.auth.admin.getUserById(userId);
    if (targetAuthError || !targetAuth?.user) {
      return NextResponse.json({ error: "User not found." }, { status: 404 });
    }

    try {
      await ensureProfile(targetAuth.user);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unable to create profile record.";
      return NextResponse.json({ error: message }, { status: 500 });
    }

    const { error: insertError } = await supabase.from("admin_users").upsert(
      {
        user_id: userId,
        role: "super_admin",
        added_by: user.id
      },
      { onConflict: "user_id" }
    );

    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, userId });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unable to add super admin.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { user, error, status } = await getAuthenticatedUser(request);
    if (!user) {
      return NextResponse.json({ error }, { status });
    }

    const isPrimaryAdmin = user.email?.toLowerCase() === PRIMARY_ADMIN_EMAIL;
    if (!isPrimaryAdmin) {
      return NextResponse.json(
        { error: "Only the primary admin can revoke access." },
        { status: 403 }
      );
    }

    const body = await request.json().catch(() => null);
    const targetUserId = typeof body?.userId === "string" ? body.userId.trim() : "";
    const targetIdentifier = body?.identifier?.trim() ?? body?.email?.trim() ?? "";
    if (!targetUserId && !targetIdentifier) {
      return NextResponse.json(
        { error: "Provide a target email, username, or user id." },
        { status: 400 }
      );
    }

    const supabase = createSupabaseServiceClient();
    let userId = targetUserId;
    if (!userId) {
      const { userId: resolvedUserId, error: resolveError } =
        await resolveUserIdByIdentifier(supabase, targetIdentifier);
      if (resolveError || !resolvedUserId) {
        const statusCode =
          resolveError === "User not found."
            ? 404
            : resolveError?.includes("Multiple users match")
              ? 409
              : 500;
        return NextResponse.json(
          { error: resolveError ?? "User not found." },
          { status: statusCode }
        );
      }
      userId = resolvedUserId;
    }

    if (userId === user.id) {
      return NextResponse.json(
        { error: "You cannot revoke your own access." },
        { status: 400 }
      );
    }

    const { data, error: deleteError } = await supabase
      .from("admin_users")
      .delete()
      .eq("user_id", userId)
      .select("user_id");

    if (deleteError) {
      return NextResponse.json({ error: deleteError.message }, { status: 500 });
    }

    return NextResponse.json({ removed: data?.length ?? 0 });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Unable to remove super admin.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

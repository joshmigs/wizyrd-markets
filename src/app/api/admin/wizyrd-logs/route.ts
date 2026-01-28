import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

type PromptLogRow = {
  id: string;
  prompt: string;
  response: string | null;
  created_at: string;
  user_id: string | null;
  user_email?: string | null;
  read_at?: string | null;
  read_by?: string | null;
  deleted_at?: string | null;
  deleted_by?: string | null;
  flagged?: boolean | null;
  flagged_at?: string | null;
  profiles?: {
    display_name: string | null;
  } | null;
};

const shouldIgnoreLogError = (error?: { code?: string | null; message?: string | null }) =>
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

  const { searchParams } = new URL(request.url);
  const requestedLimit = Number(searchParams.get("limit") ?? 100);
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(200, Math.max(10, requestedLimit))
    : 100;

  const supabase = createSupabaseServiceClient();
  const baseSelect = "id, prompt, created_at, user_id, profiles(display_name)";
  const extendedSelect =
    "id, prompt, response, created_at, user_id, user_email, read_at, read_by, deleted_at, deleted_by, flagged, flagged_at, profiles(display_name)";
  let warning: string | null = null;
  const cutoff = new Date(Date.now() - 30 * 1000).toISOString();
  let { data, error: logsError } = await supabase
    .from("wizyrd_prompt_logs")
    .select(extendedSelect)
    .or(`deleted_at.is.null,deleted_at.gte.${cutoff}`)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (logsError?.code === "42703") {
    warning =
      "Wizyrd log columns are not configured yet. Add response, user_email, read_at, read_by, deleted_at, deleted_by, flagged, and flagged_at.";
    const fallback = await supabase
      .from("wizyrd_prompt_logs")
      .select(baseSelect)
      .order("created_at", { ascending: false })
      .limit(limit);
    data = fallback.data;
    logsError = fallback.error;
  }

  if (logsError) {
    if (shouldIgnoreLogError(logsError)) {
      return NextResponse.json({
        logs: [],
        warning: "Wizyrd logging table not configured yet."
      });
    }
    return NextResponse.json({ error: logsError.message }, { status: 500 });
  }

  let logs = (data ?? []).map((row) => {
    const typed = row as PromptLogRow;
    return {
      id: typed.id,
      prompt: typed.prompt,
      response: typed.response ?? null,
      created_at: typed.created_at,
      user_id: typed.user_id,
      user_email: typed.user_email ?? null,
      read_at: typed.read_at ?? null,
      read_by: typed.read_by ?? null,
      deleted_at: typed.deleted_at ?? null,
      deleted_by: typed.deleted_by ?? null,
      flagged: typed.flagged ?? null,
      flagged_at: typed.flagged_at ?? null,
      display_name: typed.profiles?.display_name ?? null
    };
  });

  const missingEmails = Array.from(
    new Set(
      logs
        .filter((log) => !log.user_email && log.user_id)
        .map((log) => log.user_id as string)
    )
  );
  if (missingEmails.length) {
    const emailMap = new Map<string, string>();
    await Promise.all(
      missingEmails.map(async (userId) => {
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
    logs = logs.map((log) => ({
      ...log,
      user_email: log.user_email ?? (log.user_id ? emailMap.get(log.user_id) ?? null : null)
    }));
  }

  return NextResponse.json({ logs, warning: warning ?? undefined });
}

export async function PATCH(request: Request) {
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

  const body = await request.json().catch(() => null);
  const logId = typeof body?.id === "string" ? body.id : "";
  const shouldRead = Boolean(body?.read);
  const shouldRestore = Boolean(body?.restore);
  const nextFlagged =
    typeof body?.flagged === "boolean" ? (body.flagged as boolean) : null;
  if (!logId) {
    return NextResponse.json({ error: "Missing log id." }, { status: 400 });
  }

  const supabase = createSupabaseServiceClient();
  const updates: Record<string, string | boolean | null> = {};
  const now = new Date().toISOString();
  if (shouldRead) {
    updates.read_at = now;
    updates.read_by = user.id;
  }
  if (shouldRestore) {
    updates.deleted_at = null;
    updates.deleted_by = null;
  }
  if (nextFlagged !== null) {
    updates.flagged = nextFlagged;
    updates.flagged_at = nextFlagged ? now : null;
  }
  if (!Object.keys(updates).length) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }
  const { error: updateError } = await supabase
    .from("wizyrd_prompt_logs")
    .update(updates)
    .eq("id", logId);

  if (updateError?.code === "42703") {
    return NextResponse.json(
      { error: "Log tracking columns are not configured yet." },
      { status: 400 }
    );
  }

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({
    id: logId,
    read_at: updates.read_at ?? null,
    read_by: updates.read_by ?? null,
    deleted_at: updates.deleted_at ?? undefined,
    deleted_by: updates.deleted_by ?? undefined,
    flagged: updates.flagged ?? undefined,
    flagged_at: updates.flagged_at ?? undefined
  });
}

export async function DELETE(request: Request) {
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

  const body = await request.json().catch(() => null);
  const logId = typeof body?.id === "string" ? body.id : "";
  const forceDelete = Boolean(body?.force);
  if (!logId) {
    return NextResponse.json({ error: "Missing log id." }, { status: 400 });
  }

  const supabase = createSupabaseServiceClient();
  const { data: existingLog, error: lookupError } = await supabase
    .from("wizyrd_prompt_logs")
    .select("flagged")
    .eq("id", logId)
    .maybeSingle();

  if (lookupError && lookupError.code !== "42703") {
    return NextResponse.json({ error: lookupError.message }, { status: 500 });
  }

  if (existingLog?.flagged) {
    return NextResponse.json(
      { error: "Unflag this log before deleting it." },
      { status: 400 }
    );
  }
  if (forceDelete) {
    const { error: deleteError } = await supabase
      .from("wizyrd_prompt_logs")
      .delete()
      .eq("id", logId);
    if (deleteError) {
      return NextResponse.json({ error: deleteError.message }, { status: 500 });
    }
    return NextResponse.json({ id: logId, force: true });
  }

  const deletedAt = new Date().toISOString();
  const { error: deleteError } = await supabase
    .from("wizyrd_prompt_logs")
    .update({ deleted_at: deletedAt, deleted_by: user.id })
    .eq("id", logId);

  if (deleteError?.code === "42703") {
    return NextResponse.json(
      { error: "Delete tracking is not configured yet." },
      { status: 400 }
    );
  }

  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }

  return NextResponse.json({ id: logId, deleted_at: deletedAt, deleted_by: user.id });
}

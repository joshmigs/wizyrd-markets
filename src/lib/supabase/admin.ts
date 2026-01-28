import type { SupabaseClient } from "@supabase/supabase-js";

type AdminAuthClient = {
  admin?: {
    getUserByEmail?: (email: string) => Promise<{
      data?: { user?: { id: string; email?: string | null } };
      error?: { message: string };
    }>;
    listUsers?: (options?: { page?: number; perPage?: number }) => Promise<{
      data?: { users?: { id: string; email?: string | null }[] };
      error?: { message: string };
    }>;
  };
  api?: {
    getUserByEmail?: (email: string) => Promise<{
      data?: { user?: { id: string; email?: string | null } };
      user?: { id: string; email?: string | null };
      error?: { message: string };
    }>;
  };
};

export async function resolveUserIdByEmail(
  supabase: SupabaseClient,
  email: string
): Promise<{ userId: string | null; error?: string }> {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) {
    return { userId: null, error: "Provide a target email." };
  }

  const authClient = supabase.auth as unknown as AdminAuthClient;

  if (authClient.admin?.getUserByEmail) {
    const { data, error } = await authClient.admin.getUserByEmail(normalizedEmail);
    if (error) {
      return { userId: null, error: error.message };
    }
    return { userId: data?.user?.id ?? null, error: data?.user ? undefined : "User not found." };
  }

  if (authClient.admin?.listUsers) {
    const { data, error } = await authClient.admin.listUsers({ perPage: 2000 });
    if (error) {
      return { userId: null, error: error.message };
    }
    const match =
      data?.users?.find(
        (user) => user.email?.toLowerCase() === normalizedEmail
      ) ?? null;
    return { userId: match?.id ?? null, error: match ? undefined : "User not found." };
  }

  if (authClient.api?.getUserByEmail) {
    const { data, user, error } = await authClient.api.getUserByEmail(normalizedEmail);
    if (error) {
      return { userId: null, error: error.message };
    }
    const resolved = data?.user ?? user ?? null;
    return { userId: resolved?.id ?? null, error: resolved ? undefined : "User not found." };
  }

  return { userId: null, error: "Admin user lookup not available." };
}

export async function resolveUserIdByIdentifier(
  supabase: SupabaseClient,
  identifier: string
): Promise<{ userId: string | null; error?: string }> {
  const trimmed = identifier.trim();
  if (!trimmed) {
    return { userId: null, error: "Provide a user email or username." };
  }

  if (trimmed.includes("@")) {
    return resolveUserIdByEmail(supabase, trimmed);
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("id, display_name")
    .ilike("display_name", trimmed)
    .limit(2);

  if (error) {
    if (
      error.code === "42P01" ||
      error.code === "PGRST205" ||
      error.message?.includes("schema cache")
    ) {
      return { userId: null, error: "User lookup not available." };
    }
    return { userId: null, error: error.message };
  }

  if (!data || data.length === 0) {
    return { userId: null, error: "User not found." };
  }

  if (data.length > 1) {
    return {
      userId: null,
      error: "Multiple users match that name. Use an email instead."
    };
  }

  return { userId: data[0].id ?? null };
}

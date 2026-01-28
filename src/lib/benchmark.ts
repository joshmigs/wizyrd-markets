import crypto from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveUserIdByEmail } from "@/lib/supabase/admin";

export const DEFAULT_BENCHMARK_TICKER = "SPY";
export const BENCHMARK_EMAIL = "benchmark@wizyrd.com";
export const BENCHMARK_DISPLAY_NAME = "S&P 500";
export const BENCHMARK_LOGO_URL = "/brand/sp500-logo.svg";

type AdminAuthClient = {
  admin?: {
    createUser?: (payload: {
      email: string;
      password?: string;
      email_confirm?: boolean;
      user_metadata?: Record<string, unknown>;
    }) => Promise<{
      data?: { user?: { id: string } };
      error?: { message: string };
    }>;
  };
};

export async function ensureBenchmarkUser(
  supabase: SupabaseClient
): Promise<{ userId: string | null; error?: string }> {
  const { userId, error } = await resolveUserIdByEmail(supabase, BENCHMARK_EMAIL);
  if (userId) {
    await supabase.from("profiles").upsert(
      {
        id: userId,
        display_name: BENCHMARK_DISPLAY_NAME,
        team_logo_url: BENCHMARK_LOGO_URL
      },
      { onConflict: "id" }
    );
    return { userId };
  }

  if (error && error !== "User not found.") {
    return { userId: null, error };
  }

  const authClient = supabase.auth as unknown as AdminAuthClient;
  if (!authClient.admin?.createUser) {
    return { userId: null, error: "Admin user creation not available." };
  }

  const password = crypto.randomBytes(16).toString("hex");
  const { data, error: createError } = await authClient.admin.createUser({
    email: BENCHMARK_EMAIL,
    password,
    email_confirm: true,
    user_metadata: { display_name: BENCHMARK_DISPLAY_NAME }
  });

  if (createError) {
    return { userId: null, error: createError.message };
  }

  const createdId = data?.user?.id ?? null;
  if (!createdId) {
    return { userId: null, error: "Unable to create benchmark user." };
  }

  await supabase.from("profiles").upsert(
    {
      id: createdId,
      display_name: BENCHMARK_DISPLAY_NAME,
      team_logo_url: BENCHMARK_LOGO_URL
    },
    { onConflict: "id" }
  );

  return { userId: createdId };
}

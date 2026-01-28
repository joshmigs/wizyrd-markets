import type { User } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

function deriveDisplayName(user: User) {
  const meta = user.user_metadata as { display_name?: string; full_name?: string };
  if (meta?.display_name) {
    return meta.display_name;
  }
  if (meta?.full_name) {
    return meta.full_name;
  }
  if (user.email) {
    return user.email.split("@")[0];
  }
  return "Player";
}

export async function ensureProfile(user: User) {
  const supabase = createSupabaseServiceClient();
  const displayName = deriveDisplayName(user);

  const { data: existing, error: existingError } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", user.id)
    .maybeSingle();

  if (existingError) {
    throw new Error(existingError.message);
  }

  if (existing?.display_name) {
    return;
  }

  const { error } = await supabase
    .from("profiles")
    .upsert({ id: user.id, display_name: displayName }, { onConflict: "id" });

  if (error) {
    throw new Error(error.message);
  }
}

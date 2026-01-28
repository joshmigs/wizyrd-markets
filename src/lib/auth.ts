import type { User } from "@supabase/supabase-js";
import {
  createSupabaseServerClient,
  createSupabaseServiceClient
} from "@/lib/supabase/server";
import { isEnvPowerUser, isOwnerUser } from "@/lib/power-users";

type AuthResult = {
  user: User | null;
  error: string | null;
  status: number;
  excludedUntil?: string | null;
  bannedUntil?: string | null;
  powerUser?: boolean;
  owner?: boolean;
  superAdmin?: boolean;
};

async function getActiveSelfExclusion(userId: string) {
  const serviceClient = createSupabaseServiceClient();
  const { data, error } = await serviceClient
    .from("self_exclusions")
    .select("ends_at")
    .eq("user_id", userId)
    .gt("ends_at", new Date().toISOString())
    .order("ends_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (
    error?.code === "42P01" ||
    error?.code === "PGRST205" ||
    error?.message?.includes("schema cache")
  ) {
    return null;
  }

  if (error) {
    throw new Error(error.message);
  }

  return data?.ends_at ?? null;
}

async function getActiveBan(userId: string) {
  const serviceClient = createSupabaseServiceClient();
  const now = new Date().toISOString();
  const { data, error } = await serviceClient
    .from("user_bans")
    .select("ends_at")
    .eq("user_id", userId)
    .or(`ends_at.is.null,ends_at.gt.${now}`)
    .order("ends_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (
    error?.code === "42P01" ||
    error?.code === "PGRST205" ||
    error?.message?.includes("schema cache")
  ) {
    return null;
  }

  if (error) {
    throw new Error(error.message);
  }

  return data?.ends_at ?? null;
}

async function getSuperAdminStatus(userId: string) {
  const serviceClient = createSupabaseServiceClient();
  const { data, error } = await serviceClient
    .from("admin_users")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (
    error?.code === "42P01" ||
    error?.code === "PGRST205" ||
    error?.message?.includes("schema cache")
  ) {
    return false;
  }

  if (error) {
    throw new Error(error.message);
  }

  return Boolean(data?.user_id);
}

export async function getAuthenticatedUser(
  request?: Request
): Promise<AuthResult> {
  const authHeader = request?.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (token) {
    const serviceClient = createSupabaseServiceClient();
    const { data: tokenData, error: tokenError } =
      await serviceClient.auth.getUser(token);

    if (tokenError || !tokenData?.user) {
      return {
        user: null,
        error: tokenError?.message ?? "Unauthorized",
        status: 401,
        excludedUntil: null,
        bannedUntil: null,
        powerUser: false,
        owner: false,
        superAdmin: false
      };
    }

    const owner = isOwnerUser(tokenData.user);
    const envPowerUser = isEnvPowerUser(tokenData.user);
    const superAdmin = owner ? true : await getSuperAdminStatus(tokenData.user.id);
    const powerUser = owner || superAdmin || envPowerUser;
    const bannedUntil = await getActiveBan(tokenData.user.id);
    if (bannedUntil !== null) {
      return {
        user: null,
        error: "Account suspended.",
        status: 403,
        excludedUntil: null,
        bannedUntil,
        powerUser,
        owner,
        superAdmin
      };
    }
    const excludedUntil = powerUser
      ? null
      : await getActiveSelfExclusion(tokenData.user.id);
    if (excludedUntil) {
      return {
        user: null,
        error: `Self-exclusion active until ${excludedUntil}.`,
        status: 403,
        excludedUntil,
        bannedUntil: null,
        powerUser,
        owner,
        superAdmin
      };
    }

    return {
      user: tokenData.user,
      error: null,
      status: 200,
      excludedUntil: null,
      bannedUntil: null,
      powerUser,
      owner,
      superAdmin
    };
  }

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();

  if (data?.user) {
    const owner = isOwnerUser(data.user);
    const envPowerUser = isEnvPowerUser(data.user);
    const superAdmin = owner ? true : await getSuperAdminStatus(data.user.id);
    const powerUser = owner || superAdmin || envPowerUser;
    const bannedUntil = await getActiveBan(data.user.id);
    if (bannedUntil !== null) {
      return {
        user: null,
        error: "Account suspended.",
        status: 403,
        excludedUntil: null,
        bannedUntil,
        powerUser,
        owner,
        superAdmin
      };
    }
    const excludedUntil = powerUser ? null : await getActiveSelfExclusion(data.user.id);
    if (excludedUntil) {
      return {
        user: null,
        error: `Self-exclusion active until ${excludedUntil}.`,
        status: 403,
        excludedUntil,
        bannedUntil: null,
        powerUser,
        owner,
        superAdmin
      };
    }
    return {
      user: data.user,
      error: null,
      status: 200,
      excludedUntil: null,
      bannedUntil: null,
      powerUser,
      owner,
      superAdmin
    };
  }

  const normalizedError =
    error?.message === "Auth session missing!" ? "Unauthorized" : error?.message;

  return {
    user: null,
    error: normalizedError ?? "Unauthorized",
    status: 401,
    excludedUntil: null,
    bannedUntil: null,
    powerUser: false,
    owner: false,
    superAdmin: false
  };
}

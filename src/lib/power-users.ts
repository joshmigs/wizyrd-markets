import type { User } from "@supabase/supabase-js";

const parseList = (value?: string) =>
  (value ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);

const readWithFallback = (primary?: string, fallback?: string) => {
  const primaryList = parseList(primary);
  return primaryList.length ? primaryList : parseList(fallback);
};

export function isOwnerUser(user: User | null) {
  if (!user) {
    return false;
  }

  const emails = readWithFallback(
    process.env.OWNER_EMAILS,
    process.env.POWER_USER_EMAILS
  );
  const ids = readWithFallback(
    process.env.OWNER_IDS,
    process.env.POWER_USER_IDS
  );

  const email = user.email?.toLowerCase();

  return (email ? emails.includes(email) : false) || ids.includes(user.id.toLowerCase());
}

export function isEnvPowerUser(user: User | null) {
  if (!user) {
    return false;
  }

  const emails = parseList(process.env.POWER_USER_EMAILS);
  const ids = parseList(process.env.POWER_USER_IDS);
  const email = user.email?.toLowerCase();

  return (email ? emails.includes(email) : false) || ids.includes(user.id.toLowerCase());
}

export function isPowerUser(user: User | null) {
  return isOwnerUser(user) || isEnvPowerUser(user);
}

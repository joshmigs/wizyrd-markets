import { ALLOWED_TICKERS } from "@/lib/assets";
import type { SupabaseClient } from "@supabase/supabase-js";

type SnapshotRow = {
  id: string;
  as_of: string;
};

type UniverseMemberRow = {
  ticker: string;
};

export async function loadAllowedTickers(
  supabase: SupabaseClient,
  snapshotId?: string | null
) {
  const fallback = {
    allowed: new Set([...ALLOWED_TICKERS].filter((ticker) => ticker !== "SPY")),
    snapshotId: null
  };

  try {
    let activeSnapshotId = snapshotId ?? null;

    if (!activeSnapshotId) {
      const { data: latest, error: latestError } = await supabase
        .from("asset_universe_snapshots")
        .select("id, as_of")
        .order("as_of", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (latestError) {
        return fallback;
      }

      activeSnapshotId = (latest as SnapshotRow | null)?.id ?? null;
    }

    if (!activeSnapshotId) {
      return fallback;
    }

    const { data: members, error: membersError } = await supabase
      .from("asset_universe_members")
      .select("ticker")
      .eq("snapshot_id", activeSnapshotId);

    if (membersError) {
      return fallback;
    }

    const allowed = new Set(
      (members as UniverseMemberRow[]).map((row) => row.ticker.toUpperCase())
    );

    allowed.delete("SPY");
    return allowed.size ? { allowed, snapshotId: activeSnapshotId } : fallback;
  } catch (error) {
    return fallback;
  }
}

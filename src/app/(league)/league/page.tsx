"use client";

export const dynamic = "force-dynamic";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  Suspense,
  useCallback,
  useEffect,
  useState,
  type FormEvent,
  type MouseEvent
} from "react";
import LogoMark from "@/app/components/LogoMark";
import TeamLogo from "@/app/components/TeamLogo";
import SelfExclusionNotice from "@/app/components/SelfExclusionNotice";
import BanNotice from "@/app/components/BanNotice";
import type { Session } from "@supabase/supabase-js";
import AuthGate from "@/app/components/AuthGate";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import AnalyticsPanel from "@/app/(league)/components/AnalyticsPanel";

type League = {
  id: string;
  name: string;
  invite_code: string;
  is_creator?: boolean;
  current_week?: {
    id: string;
    week_start: string;
    week_end: string;
    lock_time: string;
  } | null;
  next_week?: {
    id: string;
    week_start: string;
    week_end: string;
    lock_time: string;
  } | null;
  lineup_set?: boolean;
  current_lineup_set?: boolean;
  member_count?: number;
  locked_lineups?: number;
};

type StandingsRow = {
  user_id: string;
  display_name: string;
  team_logo_url?: string | null;
  wins: number;
  losses: number;
  ties: number;
  games: number;
  win_pct: number | null;
  loss_pct: number | null;
  tie_pct: number | null;
  avg_return: number | null;
  annualized_return: number | null;
  volatility: number | null;
  alpha: number | null;
  beta: number | null;
  is_benchmark?: boolean;
};

type LeagueInvite = {
  id: string;
  league_id: string;
  status: string;
  created_at: string;
  leagues?: {
    id: string;
    name: string;
    invite_code: string;
  } | null;
};

function LeagueHomePageInner() {
  const searchParams = useSearchParams();
  const requestedLeagueId = searchParams.get("leagueId");
  const [session, setSession] = useState<Session | null>(null);
  const [loadingSession, setLoadingSession] = useState(true);
  const [loadingLeagues, setLoadingLeagues] = useState(false);
  const [leagues, setLeagues] = useState<League[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [excludedUntil, setExcludedUntil] = useState<string | null>(null);
  const [bannedUntil, setBannedUntil] = useState<string | null>(null);
  const [isBanned, setIsBanned] = useState(false);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [standingsLeagueId, setStandingsLeagueId] = useState<string>("all");
  const [standings, setStandings] = useState<Record<string, StandingsRow[]>>({});
  const [loadingStandings, setLoadingStandings] = useState(false);
  const [standingsError, setStandingsError] = useState<string | null>(null);
  const [inviteEmails, setInviteEmails] = useState<Record<string, string>>({});
  const [inviteMessages, setInviteMessages] = useState<Record<string, string | null>>({});
  const [inviteLoading, setInviteLoading] = useState<Record<string, boolean>>({});
  const [deleteLoading, setDeleteLoading] = useState<Record<string, boolean>>({});
  const [deleteMessages, setDeleteMessages] = useState<Record<string, string | null>>({});
  const [leaveLoading, setLeaveLoading] = useState<Record<string, boolean>>({});
  const [leaveMessages, setLeaveMessages] = useState<Record<string, string | null>>({});
  const [knownUsernames, setKnownUsernames] = useState<string[]>([]);
  const [memberActionMessage, setMemberActionMessage] = useState<string | null>(null);
  const [memberActionLoading, setMemberActionLoading] = useState<Record<string, boolean>>({});
  const [pendingInvites, setPendingInvites] = useState<LeagueInvite[]>([]);
  const [expandedLeagues, setExpandedLeagues] = useState<Record<string, boolean>>({});
  const [loadingInvites, setLoadingInvites] = useState(false);
  const [inviteActionLoading, setInviteActionLoading] = useState<Record<string, boolean>>(
    {}
  );
  const [inviteActionMessage, setInviteActionMessage] = useState<string | null>(null);

  const formatLockTime = (lockTime?: string | null) => {
    if (!lockTime) {
      return null;
    }
    const date = new Date(lockTime);
    return date.toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short"
    });
  };

  const formatPercent = (value: number | null, digits = 2) => {
    if (value === null || Number.isNaN(value)) {
      return "—";
    }
    const normalized = Math.abs(value) < 0.00005 ? 0 : value;
    return `${(normalized * 100).toFixed(digits)}%`;
  };

  const formatNumber = (value: number | null, digits = 2) => {
    if (value === null || Number.isNaN(value)) {
      return "—";
    }
    const normalized = Math.abs(value) < 0.00005 ? 0 : value;
    return normalized.toFixed(digits);
  };

  const valueTone = (
    value: number | null,
    options?: { neutralClass?: string; scale?: number; digits?: number }
  ) => {
    const { neutralClass = "text-steel", scale = 1, digits = 2 } = options ?? {};
    if (value === null || Number.isNaN(value)) {
      return neutralClass;
    }
    const normalized = Math.abs(value) < 0.00005 ? 0 : value;
    const displayValue = Number((normalized * scale).toFixed(digits));
    if (displayValue < 0) {
      return "text-red-600";
    }
    if (displayValue > 0) {
      return "text-green-500";
    }
    return neutralClass;
  };

  const handleInviteSend = async (
    leagueId: string,
    event?: FormEvent<HTMLFormElement> | MouseEvent<HTMLButtonElement>
  ) => {
    event?.preventDefault();
    event?.stopPropagation();
    if (!session?.access_token) {
      return;
    }
    const emails = inviteEmails[leagueId] ?? "";
    if (!emails.trim()) {
      setInviteMessages((current) => ({
        ...current,
        [leagueId]: "Enter one or more emails or usernames."
      }));
      return;
    }

    setInviteLoading((current) => ({ ...current, [leagueId]: true }));
    setInviteMessages((current) => ({ ...current, [leagueId]: null }));

    const response = await fetch("/api/league/invite", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`
      },
      body: JSON.stringify({ leagueId, emails })
    });

    const result = await response.json().catch(() => ({}));
    setInviteLoading((current) => ({ ...current, [leagueId]: false }));

    if (!response.ok) {
      setInviteMessages((current) => ({
        ...current,
        [leagueId]: result.error ?? "Unable to send invites."
      }));
      return;
    }

    setInviteEmails((current) => ({ ...current, [leagueId]: "" }));
    const sentCount = Number(result.sent ?? 0);
    const missing = Array.isArray(result.notFound) ? result.notFound : [];
    const baseMessage =
      sentCount === 1 ? "Invite sent." : `Invites sent (${sentCount}).`;
    const suffix = missing.length
      ? ` Unable to find: ${missing.join(", ")}.`
      : "";
    setInviteMessages((current) => ({
      ...current,
      [leagueId]: `${baseMessage}${suffix}`
    }));
  };

  const handleInviteAction = async (inviteId: string, action: "accept" | "decline") => {
    if (!session?.access_token) {
      return;
    }

    setInviteActionLoading((current) => ({ ...current, [inviteId]: true }));
    setInviteActionMessage(null);

    const response = await fetch("/api/league/invites/respond", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`
      },
      body: JSON.stringify({ inviteId, action })
    });

    const result = await response.json().catch(() => ({}));
    setInviteActionLoading((current) => ({ ...current, [inviteId]: false }));

    if (!response.ok) {
      setInviteActionMessage(result.error ?? "Unable to update invite.");
      return;
    }

    setPendingInvites((current) => current.filter((invite) => invite.id !== inviteId));
    if (action === "accept") {
      await loadLeagues();
    }
    setInviteActionMessage(
      action === "accept" ? "Invite accepted." : "Invite declined."
    );
  };

  const handleMemberAction = async (
    leagueId: string,
    userId: string,
    action: "remove" | "ban"
  ) => {
    if (!session?.access_token) {
      return;
    }

    const confirmMessage =
      action === "ban"
        ? "Ban this user from the league? They will not be able to rejoin."
        : "Remove this user from the league?";

    if (typeof window !== "undefined" && !window.confirm(confirmMessage)) {
      return;
    }

    const actionKey = `${leagueId}:${userId}:${action}`;
    setMemberActionLoading((current) => ({ ...current, [actionKey]: true }));
    setMemberActionMessage(null);

    const response = await fetch("/api/league/members", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`
      },
      body: JSON.stringify({ leagueId, userId, action })
    });

    const result = await response.json().catch(() => ({}));
    setMemberActionLoading((current) => ({ ...current, [actionKey]: false }));

    if (!response.ok) {
      setMemberActionMessage(result.error ?? "Unable to update league member.");
      return;
    }

    setMemberActionMessage(
      action === "ban" ? "User banned from the league." : "User removed."
    );
    setStandings((current) => {
      const leagueRows = current[leagueId] ?? [];
      return {
        ...current,
        [leagueId]: leagueRows.filter((row) => row.user_id !== userId)
      };
    });
  };

  const handleDeleteLeague = async (leagueId: string, leagueName: string) => {
    if (!session?.access_token || !session.user.email) {
      return;
    }

    const confirmMessage = `Delete ${leagueName}? This removes all matchups, lineups, and league data.`;
    if (typeof window !== "undefined" && !window.confirm(confirmMessage)) {
      return;
    }

    const password =
      typeof window !== "undefined"
        ? window.prompt("Enter your password to delete this league.")
        : null;
    if (!password) {
      return;
    }

    setDeleteLoading((current) => ({ ...current, [leagueId]: true }));
    setDeleteMessages((current) => ({ ...current, [leagueId]: null }));

    const supabase = createSupabaseBrowserClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: session.user.email,
      password
    });

    if (signInError) {
      setDeleteLoading((current) => ({ ...current, [leagueId]: false }));
      setDeleteMessages((current) => ({
        ...current,
        [leagueId]: "Invalid password. League not deleted."
      }));
      return;
    }

    const response = await fetch("/api/league/delete", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`
      },
      body: JSON.stringify({ leagueId })
    });

    const result = await response.json().catch(() => ({}));
    setDeleteLoading((current) => ({ ...current, [leagueId]: false }));

    if (!response.ok) {
      setDeleteMessages((current) => ({
        ...current,
        [leagueId]: result.error ?? "Unable to delete league."
      }));
      return;
    }

    setDeleteMessages((current) => ({
      ...current,
      [leagueId]: "League deleted."
    }));
    await loadLeagues();
  };

  const handleLeaveLeague = async (leagueId: string, leagueName: string) => {
    if (!session?.access_token) {
      return;
    }

    const confirmMessage =
      `Leave ${leagueName}? ` +
      "You will forfeit all remaining games for the season.";
    if (typeof window !== "undefined" && !window.confirm(confirmMessage)) {
      return;
    }

    setLeaveLoading((current) => ({ ...current, [leagueId]: true }));
    setLeaveMessages((current) => ({ ...current, [leagueId]: null }));

    const response = await fetch("/api/league/leave", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`
      },
      body: JSON.stringify({ leagueId })
    });

    const result = await response.json().catch(() => ({}));
    setLeaveLoading((current) => ({ ...current, [leagueId]: false }));

    if (!response.ok) {
      setLeaveMessages((current) => ({
        ...current,
        [leagueId]: result.error ?? "Unable to leave league."
      }));
      return;
    }

    setLeaveMessages((current) => ({
      ...current,
      [leagueId]: "League left."
    }));
    await loadLeagues();
  };

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session ?? null);
      setLoadingSession(false);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange(
      (_event, newSession) => {
        setSession(newSession);
      }
    );

    return () => {
      subscription.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!session?.user) {
      setDisplayName(null);
      return;
    }

    const loadProfile = async () => {
      const supabase = createSupabaseBrowserClient();
      const { data } = await supabase
        .from("profiles")
        .select("display_name")
        .eq("id", session.user.id)
        .maybeSingle();

      const fallback = session.user.email?.split("@")[0] ?? "Player";
      setDisplayName(data?.display_name ?? fallback);
    };

    loadProfile();
  }, [session]);

  useEffect(() => {
    if (!session?.access_token) {
      setExcludedUntil(null);
      setBannedUntil(null);
      setIsBanned(false);
      return;
    }

    const checkExclusion = async () => {
      const response = await fetch("/api/account/status", {
        headers: {
          Authorization: `Bearer ${session.access_token}`
        }
      });
      const result = await response.json().catch(() => ({}));
      if (result?.excluded) {
        const supabase = createSupabaseBrowserClient();
        setExcludedUntil(result.endsAt ?? null);
        setIsBanned(false);
        await supabase.auth.signOut();
      }
      if (result?.banned) {
        const supabase = createSupabaseBrowserClient();
        setExcludedUntil(null);
        setBannedUntil(result.bannedUntil ?? null);
        setIsBanned(true);
        await supabase.auth.signOut();
        return;
      }
      setIsBanned(false);
      setBannedUntil(null);
    };

    checkExclusion();
  }, [session]);

  const loadLeagues = useCallback(async () => {
    if (!session?.access_token) {
      setLeagues([]);
      return;
    }

    setLoadingLeagues(true);
    setError(null);
    const response = await fetch("/api/league/list", {
      headers: {
        Authorization: `Bearer ${session.access_token}`
      }
    });

    const result = await response.json().catch(() => ({}));

    if (response.status === 401) {
      const supabase = createSupabaseBrowserClient();
      await supabase.auth.signOut();
      setSession(null);
      setLoadingLeagues(false);
      return;
    }

    if (!response.ok) {
      setError(result.error ?? "Failed to load leagues.");
      setLoadingLeagues(false);
      return;
    }

    setLeagues((result.leagues ?? []) as League[]);
    setLoadingLeagues(false);
  }, [session?.access_token]);

  useEffect(() => {
    loadLeagues();
  }, [loadLeagues]);

  useEffect(() => {
    if (!requestedLeagueId) {
      return;
    }
    if (!leagues.some((league) => league.id === requestedLeagueId)) {
      return;
    }
    if (standingsLeagueId !== requestedLeagueId) {
      setStandingsLeagueId(requestedLeagueId);
    }
    const targetId = `league-${requestedLeagueId}`;
    requestAnimationFrame(() => {
      const target = document.getElementById(targetId);
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  }, [requestedLeagueId, leagues, standingsLeagueId]);

  useEffect(() => {
    if (!session?.access_token) {
      setPendingInvites([]);
      return;
    }

    const loadInvites = async () => {
      setLoadingInvites(true);
      const response = await fetch("/api/league/invites", {
        headers: {
          Authorization: `Bearer ${session.access_token}`
        }
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setInviteActionMessage(result.error ?? "Unable to load invites.");
        setLoadingInvites(false);
        return;
      }
      setPendingInvites((result.invites ?? []) as LeagueInvite[]);
      setLoadingInvites(false);
    };

    loadInvites();
  }, [session?.access_token]);

  useEffect(() => {
    if (!session?.access_token) {
      setKnownUsernames([]);
      return;
    }

    const controller = new AbortController();
    const loadKnown = async () => {
      try {
        const response = await fetch("/api/league/known-usernames", {
          headers: {
            Authorization: `Bearer ${session.access_token}`
          },
          signal: controller.signal
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
          return;
        }
        const names = Array.isArray(result.usernames) ? result.usernames : [];
        setKnownUsernames(names);
      } catch (_error) {
        // ignore
      }
    };

    loadKnown();

    return () => {
      controller.abort();
    };
  }, [session?.access_token]);

  useEffect(() => {
    if (!session?.access_token || leagues.length === 0) {
      setStandings({});
      setStandingsLeagueId("all");
      return;
    }

    const loadStandings = async () => {
      setLoadingStandings(true);
      setStandingsError(null);
      const response = await fetch("/api/league/standings", {
        headers: {
          Authorization: `Bearer ${session.access_token}`
        }
      });
      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        setStandingsError(result.error ?? "Unable to load standings.");
        setLoadingStandings(false);
        return;
      }

      const byLeague: Record<string, StandingsRow[]> = {};
      (result.leagues ?? []).forEach((league: { id: string; standings: StandingsRow[] }) => {
        byLeague[league.id] = league.standings ?? [];
      });

      setStandings(byLeague);
      setStandingsLeagueId((current) => {
        if (current !== "all") {
          return current;
        }
        return leagues[0]?.id ?? "all";
      });
      setLoadingStandings(false);
    };

    loadStandings();
  }, [session, leagues]);

  useEffect(() => {
    if (standingsLeagueId === "all") {
      return;
    }
    if (leagues.some((league) => league.id === standingsLeagueId)) {
      return;
    }
    setStandingsLeagueId(leagues[0]?.id ?? "all");
  }, [leagues, standingsLeagueId]);

  const activeLeague = leagues.find((league) => league.id === standingsLeagueId);
  const canManageMembers = Boolean(activeLeague?.is_creator);
  const isLeagueFocused = Boolean(requestedLeagueId);
  const focusedLeague = isLeagueFocused
    ? leagues.find((league) => league.id === requestedLeagueId) ?? null
    : null;
  const leaguesForCards = focusedLeague ? [focusedLeague] : isLeagueFocused ? [] : leagues;

  const renderLeagueCard = (league: League) => {
    const isExpanded =
      expandedLeagues[league.id] ?? (focusedLeague?.id === league.id);
    const toggleExpanded = () => {
      setExpandedLeagues((current) => ({
        ...current,
        [league.id]: !isExpanded
      }));
    };
    const now = Date.now();
    const lockTime = league.current_week?.lock_time
      ? new Date(league.current_week.lock_time).getTime()
      : null;
    const hasCurrentWeek = Boolean(league.current_week);
    const hasNextWeek = !hasCurrentWeek && Boolean(league.next_week);
    const lineupSet = hasCurrentWeek
      ? Boolean(league.current_lineup_set)
      : hasNextWeek
        ? Boolean(league.lineup_set)
        : false;
    const lineupLabel = hasCurrentWeek
      ? lineupSet
        ? "Lineup set (current week)"
        : "Lineup not set (current week)"
      : hasNextWeek
        ? lineupSet
          ? "Lineup set (next week)"
          : "Lineup not set (next week)"
        : "Lineup not scheduled";
    const isLocked = lockTime ? lockTime <= now : false;

    return (
      <div
        key={league.id}
        id={`league-${league.id}`}
        className="rounded-2xl border border-amber-100 bg-white p-4"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-display text-xl text-ink">{league.name}</h3>
            <p className="mt-2 text-sm text-steel">
              Invite code:{" "}
              <span className="font-semibold text-navy">{league.invite_code}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={toggleExpanded}
            aria-expanded={isExpanded}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-navy/20 bg-white text-base font-semibold text-navy shadow-sm shadow-navy/10 transition hover:border-navy hover:bg-navy-soft hover:text-white"
          >
            {isExpanded ? "−" : "+"}
          </button>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs uppercase tracking-[0.2em] text-steel">
          <span
            className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold ${
              lineupSet
                ? "border border-emerald-200 bg-emerald-100 text-emerald-700"
                : "border border-red-200 bg-red-100 text-red-700"
            }`}
            aria-hidden
          >
            {lineupSet ? "✓" : "×"}
          </span>
          <span>{lineupLabel}</span>
          {hasCurrentWeek ? (
            <span className={isLocked ? "text-red-700" : "text-emerald-700"}>
              {isLocked ? "Locked" : "Open"}
            </span>
          ) : null}
        </div>
      {league.is_creator ? (
        <form
          className="mt-3 space-y-3"
          onSubmit={(event) => handleInviteSend(league.id, event)}
        >
          <div className="space-y-2">
            <label
              className="block text-sm font-semibold text-ink"
              htmlFor={`invite-${league.id}`}
            >
              Invite teammates
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <input
                className="w-full rounded-xl border border-amber-100 bg-white px-4 py-3 text-sm md:w-72"
                id={`invite-${league.id}`}
                type="text"
                placeholder="Emails or usernames, separated by commas"
                value={inviteEmails[league.id] ?? ""}
                list="league-usernames"
                onChange={(event) =>
                  setInviteEmails((current) => ({
                    ...current,
                    [league.id]: event.target.value
                  }))
                }
              />
              <button
                type="submit"
                className="rounded-full border border-navy/30 bg-white px-5 py-2 text-xs font-semibold text-navy shadow-sm shadow-navy/10 transition hover:border-navy hover:bg-navy-soft hover:text-white"
                disabled={inviteLoading[league.id]}
              >
                {inviteLoading[league.id] ? "Sending..." : "Send invites"}
              </button>
            </div>
          </div>
          {inviteMessages[league.id] ? (
            <p className="text-sm text-navy">{inviteMessages[league.id]}</p>
          ) : null}
          <p className="text-xs text-steel">
            Invites send from the league creator account.
          </p>
        </form>
      ) : null}
      {league.is_creator && isExpanded ? (
        <div className="mt-4 rounded-2xl border border-amber-100 bg-paper px-4 py-3 text-sm text-steel">
          <div className="flex items-center justify-between text-xs uppercase tracking-[0.2em] text-steel">
            <span>League status</span>
            <span>{league.member_count ?? 0} members</span>
          </div>
          <div className="mt-2 grid gap-2 text-sm text-ink sm:grid-cols-2">
            <div className="rounded-xl border border-amber-100 bg-white px-3 py-2">
              <p className="text-[10px] uppercase tracking-[0.2em] text-steel">
                Members
              </p>
              <p className="mt-1 font-semibold text-navy">
                {league.member_count ?? 0}
              </p>
            </div>
            <div className="rounded-xl border border-amber-100 bg-white px-3 py-2">
              <p className="text-[10px] uppercase tracking-[0.2em] text-steel">
                Locked lineups (current week)
              </p>
              <p className="mt-1 font-semibold text-navy">
                {league.locked_lineups ?? 0} / {league.member_count ?? 0}
              </p>
            </div>
          </div>
        </div>
      ) : null}
      {league.is_creator && isExpanded ? (
        <div className="mt-4 space-y-2">
          <button
            type="button"
            onClick={() => handleDeleteLeague(league.id, league.name)}
            disabled={deleteLoading[league.id]}
            className="rounded-full border border-red-200 bg-red-50 px-4 py-2 text-xs font-semibold text-red-700 shadow-sm shadow-navy/10 transition hover:border-red-300 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {deleteLoading[league.id] ? "Deleting..." : "Delete league"}
          </button>
          {deleteMessages[league.id] ? (
            <p className="text-xs text-red-700">{deleteMessages[league.id]}</p>
          ) : null}
        </div>
      ) : null}
      {!league.is_creator && isExpanded ? (
        <div className="mt-4 space-y-2">
          <button
            type="button"
            onClick={() => handleLeaveLeague(league.id, league.name)}
            disabled={leaveLoading[league.id]}
            className="rounded-full border border-red-200 bg-red-50 px-4 py-2 text-xs font-semibold text-red-700 shadow-sm shadow-navy/10 transition hover:border-red-300 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {leaveLoading[league.id] ? "Leaving..." : "Leave league"}
          </button>
          {leaveMessages[league.id] ? (
            <p className="text-xs text-red-700">{leaveMessages[league.id]}</p>
          ) : null}
        </div>
      ) : null}
      {isExpanded ? (
        <p className="mt-4 text-sm text-steel">
          {(() => {
            if (league.current_week) {
              const canEdit = lockTime ? lockTime > now : false;
              if (league.current_lineup_set) {
                return canEdit
                  ? `Your lineup is set for this week. You can update it until ${formatLockTime(
                      league.current_week.lock_time
                    )}.`
                  : "Your lineup is set for this week.";
              }
              return canEdit
                ? `Set your lineup for this week. You can update it until ${formatLockTime(
                    league.current_week.lock_time
                  )}.`
                : "This week is locked. No lineup submitted.";
            }
            if (league.next_week) {
              return league.lineup_set
                ? `Your lineup is set for the upcoming week. You can update it until ${formatLockTime(
                    league.next_week.lock_time
                  )}.`
                : "Set your lineup for the upcoming week.";
            }
            return "Season complete. Next week hasn’t been scheduled yet.";
          })()}
        </p>
      ) : null}
    </div>
    );
  };

  if (loadingSession) {
    return (
      <main className="px-6 py-8">
        <div className="mx-auto max-w-4xl text-sm text-steel">
          Checking session...
        </div>
      </main>
    );
  }

  if (excludedUntil) {
    return (
      <main className="px-6 py-8">
        <SelfExclusionNotice endsAt={excludedUntil} />
      </main>
    );
  }
  if (isBanned) {
    return (
      <main className="px-6 py-8">
        <BanNotice endsAt={bannedUntil} />
      </main>
    );
  }

  if (!session) {
    return (
      <main className="px-6 py-8">
        <AuthGate
          title="League hub"
          subtitle="Sign in or create an account to manage leagues."
          nextPath="/league"
        />
      </main>
    );
  }

  return (
    <main className="px-6 py-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="rounded-3xl border border-amber-200/70 bg-white/90 p-4 shadow-[0_20px_60px_rgba(20,20,20,0.12)]">
          <div className="grid gap-4 md:grid-cols-2 md:items-center">
            <div className="flex flex-col items-center gap-3 text-center md:flex-row md:items-center md:text-left md:justify-self-center">
              <LogoMark size={44} />
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.35em] text-navy">
                  League hub
                </p>
                <h1 className="mt-1 font-display text-3xl text-ink">
                  Welcome back
                </h1>
                <p className="mt-1 text-sm text-steel">
                  Signed in as {displayName ?? "Player"}{" "}
                  {session.user.email ? `(${session.user.email})` : ""}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-3 md:justify-self-center">
              <Link
                href="/league/create"
                className="rounded-full border border-navy/30 bg-white px-5 py-2 text-sm font-semibold text-navy shadow-sm shadow-navy/10 transition hover:border-navy hover:bg-navy-soft hover:text-white"
              >
                Create league
              </Link>
              <Link
                href="/league/join"
                className="rounded-full border border-navy/30 bg-white px-5 py-2 text-sm font-semibold text-navy shadow-sm shadow-navy/10 transition hover:border-navy hover:bg-navy-soft hover:text-white"
              >
                Join league
              </Link>
            </div>
          </div>
        </header>

        {isLeagueFocused ? (
          <section className="rounded-2xl border border-amber-100 bg-paper p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-display text-2xl text-ink">
                  {focusedLeague?.name ?? "League"}
                </h2>
                <p className="mt-1 text-sm text-steel">League overview</p>
              </div>
              <Link
                href="/league"
                className="rounded-full border border-navy/30 bg-white px-4 py-2 text-xs font-semibold text-navy shadow-sm shadow-navy/10 transition hover:border-navy hover:bg-navy-soft hover:text-white"
              >
                All leagues
              </Link>
            </div>

            {error ? <p className="mt-4 text-sm text-red-600">{error}</p> : null}

            {loadingLeagues ? (
              <p className="mt-4 text-sm text-steel">Loading league...</p>
            ) : null}

            {!loadingLeagues && !focusedLeague ? (
              <div className="mt-4 rounded-2xl border border-amber-100 bg-white p-5 text-sm text-steel">
                League not found. Choose a league from the menu.
              </div>
            ) : null}

            {focusedLeague ? (
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                {leaguesForCards.map(renderLeagueCard)}
              </div>
            ) : null}
          </section>
        ) : (
          <section className="rounded-2xl border border-amber-100 bg-paper p-5">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-2xl text-ink">Your leagues</h2>
              <span className="text-sm text-steel">
                {loadingLeagues ? "Loading..." : `${leagues.length} total`}
              </span>
            </div>

            {error ? (
              <p className="mt-4 text-sm text-red-600">{error}</p>
            ) : null}

            {loadingInvites ? (
              <p className="mt-4 text-sm text-steel">Loading invites...</p>
            ) : pendingInvites.length ? (
              <div className="mt-4 space-y-3">
                <p className="text-sm font-semibold text-ink">Pending invites</p>
                {pendingInvites.map((invite) => (
                  <div
                    key={invite.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-100 bg-white p-4 text-sm text-steel"
                  >
                    <div>
                      <p className="font-semibold text-ink">
                        {invite.leagues?.name ?? "League invite"}
                      </p>
                      <p className="text-xs text-steel">
                        Invite code: {invite.leagues?.invite_code ?? "—"}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        className="rounded-full border border-navy/30 bg-white px-4 py-2 text-xs font-semibold text-navy shadow-sm shadow-navy/10 transition hover:border-navy hover:bg-navy-soft hover:text-white"
                        onClick={() => handleInviteAction(invite.id, "accept")}
                        disabled={inviteActionLoading[invite.id]}
                      >
                        Join league
                      </button>
                      <button
                        type="button"
                        className="rounded-full border border-amber-200 bg-white px-4 py-2 text-xs font-semibold text-steel transition hover:border-amber-300 hover:text-ink"
                        onClick={() => handleInviteAction(invite.id, "decline")}
                        disabled={inviteActionLoading[invite.id]}
                      >
                        Decline
                      </button>
                    </div>
                  </div>
                ))}
                {inviteActionMessage ? (
                  <p className="text-sm text-navy">{inviteActionMessage}</p>
                ) : null}
              </div>
            ) : null}

            {!loadingLeagues && leagues.length === 0 ? (
              <div className="mt-4 rounded-2xl border border-amber-100 bg-white p-5 text-sm text-steel">
                You are not in a league yet. Create one or join with an invite
                code to get started.
              </div>
            ) : null}

            <div className="mt-3 grid gap-4 md:grid-cols-2">
              {leaguesForCards.map(renderLeagueCard)}
            </div>
          </section>
        )}

        <section className="rounded-2xl border border-amber-100 bg-paper p-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="font-display text-2xl text-ink">Season standings</h2>
              <p className="mt-1 text-sm text-steel">
                Rankings based on head-to-head results.
              </p>
              <p className="mt-2 text-xs uppercase tracking-[0.2em] text-steel">
                Returns exclude dividends
              </p>
            </div>
            <select
              className="rounded-full border border-amber-100 bg-white px-4 py-2 text-sm"
              value={standingsLeagueId}
              onChange={(event) => setStandingsLeagueId(event.target.value)}
            >
              {leagues.map((league) => (
                <option key={league.id} value={league.id}>
                  {league.name}
                </option>
              ))}
            </select>
          </div>

          {standingsError ? (
            <p className="mt-4 text-sm text-red-600">{standingsError}</p>
          ) : null}
          {memberActionMessage ? (
            <p className="mt-4 text-sm text-navy">{memberActionMessage}</p>
          ) : null}
          {loadingStandings ? (
            <p className="mt-4 text-sm text-steel">Loading standings...</p>
          ) : null}

          {!loadingStandings ? (
            <div className="mt-4 overflow-x-hidden rounded-2xl border border-amber-100 bg-white">
              <div>
                <div className="grid grid-cols-[1.3fr,0.4fr,0.4fr,0.4fr,0.55fr,0.55fr,0.55fr,0.7fr,0.7fr,0.6fr,0.5fr,0.5fr,0.7fr] gap-1 border-b border-amber-100 px-3 py-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-steel">
                  <span className="text-center">Team</span>
                  <span className="text-center">W</span>
                  <span className="text-center">L</span>
                  <span className="text-center">T</span>
                  <span className="text-center">Win %</span>
                  <span className="text-center">Loss %</span>
                  <span className="text-center">Tie %</span>
                  <span className="text-center">Avg</span>
                  <span className="text-center">Ann</span>
                  <span className="text-center">Vol</span>
                  <span className="text-center">Alpha</span>
                  <span className="text-center">Beta</span>
                  <span className="text-center">Actions</span>
                </div>
                {(standings[standingsLeagueId] ?? []).length === 0 ? (
                  <div className="px-4 py-6 text-sm text-steel">
                    No standings yet. Results appear after the first week is scored.
                  </div>
                ) : (
                  (standings[standingsLeagueId] ?? []).map((row) => (
                    <div
                      key={row.user_id}
                      className="grid grid-cols-[1.3fr,0.4fr,0.4fr,0.4fr,0.55fr,0.55fr,0.55fr,0.7fr,0.7fr,0.6fr,0.5fr,0.5fr,0.7fr] items-center gap-1 border-b border-amber-50 px-3 py-3 text-xs text-steel last:border-b-0"
                    >
                      <div className="flex items-center justify-center gap-3 text-center">
                        <TeamLogo src={row.team_logo_url} size={44} />
                        <div>
                          <p className="truncate text-center font-semibold text-ink">
                            {row.display_name}
                          </p>
                          <p
                            className={`text-[10px] uppercase tracking-[0.2em] ${
                              row.is_benchmark ? "text-navy" : "text-transparent"
                            }`}
                            aria-hidden={!row.is_benchmark}
                          >
                            Benchmark
                          </p>
                        </div>
                      </div>
                      <span className="text-center text-green-500">
                        {row.games > 0 ? row.wins : "—"}
                      </span>
                      <span className="text-center text-red-600">
                        {row.games > 0 ? row.losses : "—"}
                      </span>
                      <span className="text-center text-ink">
                        {row.games > 0 ? row.ties : "—"}
                      </span>
                      <span className="text-center text-green-500">
                        {formatPercent(row.win_pct, 1)}
                      </span>
                      <span className="text-center text-red-600">
                        {formatPercent(row.loss_pct, 1)}
                      </span>
                      <span className="text-center text-ink">
                        {formatPercent(row.tie_pct, 1)}
                      </span>
                      <span className={`text-center ${valueTone(row.avg_return, { scale: 100 })}`}>
                        {formatPercent(row.avg_return)}
                      </span>
                      <span
                        className={`text-center ${valueTone(row.annualized_return, {
                          scale: 100
                        })}`}
                      >
                        {formatPercent(row.annualized_return)}
                      </span>
                      <span className={`text-center ${valueTone(row.volatility, { scale: 100 })}`}>
                        {formatPercent(row.volatility)}
                      </span>
                      <span className={`text-center ${valueTone(row.alpha, { scale: 100 })}`}>
                        {formatPercent(row.alpha)}
                      </span>
                      <span className={`text-center ${valueTone(row.beta)}`}>
                        {formatNumber(row.beta)}
                      </span>
                      <div className="flex items-center justify-center gap-2 text-xs">
                        {canManageMembers && !row.is_benchmark ? (
                          row.user_id === session.user.id ? (
                            <span className="text-steel">—</span>
                          ) : (
                            <>
                              <button
                                type="button"
                                onClick={() =>
                                  handleMemberAction(standingsLeagueId, row.user_id, "remove")
                                }
                                disabled={
                                  memberActionLoading[
                                    `${standingsLeagueId}:${row.user_id}:remove`
                                  ]
                                }
                                title="Remove"
                                aria-label="Remove member"
                                className="relative inline-flex h-8 w-8 items-center justify-center rounded-full border border-red-200 bg-red-50 text-red-700 shadow-sm shadow-navy/10 transition hover:border-red-300 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                <span className="text-[11px] font-semibold">R</span>
                                <span className="absolute h-[2px] w-4 rotate-[-35deg] bg-current" />
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  handleMemberAction(standingsLeagueId, row.user_id, "ban")
                                }
                                disabled={
                                  memberActionLoading[
                                    `${standingsLeagueId}:${row.user_id}:ban`
                                  ]
                                }
                                title="Ban"
                                aria-label="Ban member"
                                className="relative inline-flex h-8 w-8 items-center justify-center rounded-full border border-amber-200 bg-amber-50 text-amber-700 shadow-sm shadow-navy/10 transition hover:border-amber-300 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                <span className="text-[11px] font-semibold">B</span>
                                <span className="absolute h-[2px] w-4 rotate-[-35deg] bg-current" />
                              </button>
                            </>
                          )
                        ) : (
                          <span className="text-steel">—</span>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          ) : null}
        </section>

        <AnalyticsPanel
          accessToken={session.access_token}
          leagues={leagues}
          selectedLeagueId={standingsLeagueId}
          onLeagueChange={setStandingsLeagueId}
        />

      </div>
      {knownUsernames.length ? (
        <datalist id="league-usernames">
          {knownUsernames.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
      ) : null}
    </main>
  );
}

export default function LeagueHomePage() {
  return (
    <Suspense fallback={<div className="px-6 py-8 text-sm text-steel">Loading league…</div>}>
      <LeagueHomePageInner />
    </Suspense>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import AuthGate from "@/app/components/AuthGate";
import LogoMark from "@/app/components/LogoMark";
import TeamLogo from "@/app/components/TeamLogo";
import TickerNewsButton from "@/app/components/TickerNewsButton";
import CompanyLogo from "@/app/components/CompanyLogo";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { getEtDayEnd } from "@/lib/time";

type League = {
  id: string;
  name: string;
};

type Profile = {
  id: string;
  display_name: string;
  team_logo_url?: string | null;
};

type Week = {
  id: string;
  week_start: string;
  week_end: string;
  lock_time: string;
};

type Matchup = {
  id: string;
  home_user_id: string;
  away_user_id: string;
  home_score: number | string | null;
  away_score: number | string | null;
};

type LineupPosition = {
  ticker: string;
  weight: number;
  last_price?: number | null;
  price_as_of?: string | null;
};

type MatchupLineups = {
  home: LineupPosition[];
  away: LineupPosition[];
  viewer_is_home: boolean;
  can_view_opponent: boolean;
};

type MatchupResponse = {
  league: League | null;
  week: Week | null;
  matchup: Matchup | null;
  weeks?: Week[];
  homeProfile?: Profile | null;
  awayProfile?: Profile | null;
  lineups?: MatchupLineups;
  price_as_of?: string | null;
  live_breakdown?: {
    home: {
      total: number | null;
      positions: { ticker: string; weight: number; wtd_return: number | null }[];
    };
    away: {
      total: number | null;
      positions: { ticker: string; weight: number; wtd_return: number | null }[];
    };
  } | null;
  live?: {
    home_score: number | null;
    away_score: number | null;
    updated_at: string | null;
    status: "delayed" | "unavailable" | "final";
  };
  error?: string;
};

type UniverseEntry = {
  ticker: string;
  company_name: string | null;
  sector?: string | null;
  industry?: string | null;
};


const LIVE_REFRESH_MS = 60000;

function formatScore(value: number | string | null | undefined) {
  if (value === null || value === undefined) {
    return "Pending";
  }
  const numberValue = typeof value === "string" ? Number(value) : value;
  if (Number.isNaN(numberValue)) {
    return "Pending";
  }
  return `${(numberValue * 100).toFixed(2)}%`;
}

function formatUpdatedAt(value: string | null | undefined) {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit"
  });
}

function formatWeight(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "—";
  }
  return `${(value * 100).toFixed(2)}%`;
}

function formatWtd(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "—";
  }
  return `${(value * 100).toFixed(2)}%`;
}

function formatPrice(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "—";
  }
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function formatAsOf(value: string | null | undefined) {
  if (!value) {
    return "—";
  }
  const datePart = value.includes("T") ? value.slice(0, 10) : value;
  const match = datePart.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const monthNames = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec"
    ];
    if (Number.isFinite(year) && Number.isFinite(month) && Number.isFinite(day)) {
      return `${monthNames[month - 1]} ${day}, ${year}`;
    }
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleDateString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    year: "numeric"
  });
}

export default function MatchupPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [loadingSession, setLoadingSession] = useState(true);
  const [leagues, setLeagues] = useState<League[]>([]);
  const [selectedLeagueId, setSelectedLeagueId] = useState<string | null>(null);
  const [weeks, setWeeks] = useState<Week[]>([]);
  const [selectedWeekId, setSelectedWeekId] = useState<string | null>(null);
  const [matchupData, setMatchupData] = useState<MatchupResponse | null>(null);
  const [loadingMatchup, setLoadingMatchup] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [universeMap, setUniverseMap] = useState<Record<string, UniverseEntry>>({});
  const lastMatchupKeyRef = useRef<string | null>(null);

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
    if (!session?.access_token) {
      setLeagues([]);
      setSelectedLeagueId(null);
      return;
    }

    const loadLeagues = async () => {
      setError(null);
      const response = await fetch("/api/league/list", {
        headers: {
          Authorization: `Bearer ${session.access_token}`
        }
      });

      const result = await response.json();
      if (response.status === 401) {
        const supabase = createSupabaseBrowserClient();
        await supabase.auth.signOut();
        setSession(null);
        return;
      }
      if (!response.ok) {
        setError(result.error ?? "Unable to load leagues.");
        return;
      }

      const list = (result.leagues ?? []) as League[];
      setLeagues(list);
      if (!selectedLeagueId && list.length > 0) {
        setSelectedLeagueId(list[0].id);
      }
      if (selectedLeagueId && list.every((league) => league.id !== selectedLeagueId)) {
        setSelectedLeagueId(list[0]?.id ?? null);
      }
    };

    loadLeagues();
  }, [session, selectedLeagueId]);


  const loadMatchup = useCallback(async (force = false) => {
    if (!session?.access_token || !selectedLeagueId) {
      setMatchupData(null);
      return;
    }

    const requestKey = `${selectedLeagueId}:${selectedWeekId ?? "auto"}`;
    if (!force && lastMatchupKeyRef.current === requestKey) {
      return;
    }
    lastMatchupKeyRef.current = requestKey;

    setLoadingMatchup(true);
    setError(null);
    try {
      const params = new URLSearchParams({ leagueId: selectedLeagueId });
      if (selectedWeekId) {
        params.set("weekId", selectedWeekId);
      }
      const response = await fetch(`/api/matchup/current?${params.toString()}`, {
        headers: {
          Authorization: `Bearer ${session.access_token}`
        }
      });
      const result = (await response.json()) as MatchupResponse;

      if (!response.ok) {
        setError(result.error ?? "Unable to load matchup.");
        return;
      }

      setMatchupData(result);
      setWeeks(result.weeks ?? []);
      if (!selectedWeekId && result.week?.id) {
        const resolvedKey = `${selectedLeagueId}:${result.week.id}`;
        lastMatchupKeyRef.current = resolvedKey;
        setSelectedWeekId(result.week.id);
      }
    } finally {
      setLoadingMatchup(false);
    }
  }, [session?.access_token, selectedLeagueId, selectedWeekId]);

  useEffect(() => {
    loadMatchup();
  }, [loadMatchup]);

  useEffect(() => {
    if (!session?.access_token || !selectedLeagueId) {
      return;
    }

    const intervalId = window.setInterval(() => {
      loadMatchup(true);
    }, LIVE_REFRESH_MS);

    return () => window.clearInterval(intervalId);
  }, [session?.access_token, selectedLeagueId, loadMatchup]);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        loadMatchup(true);
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [loadMatchup]);

  useEffect(() => {
    const loadUniverse = async () => {
      const response = await fetch("/api/universe/list");
      const result = await response.json().catch(() => ({}));
      const list = (result.results ?? []) as UniverseEntry[];
      const map: Record<string, UniverseEntry> = {};
      list.forEach((entry) => {
        map[entry.ticker.toUpperCase()] = entry;
      });
      setUniverseMap(map);
    };
    loadUniverse();
  }, []);

  const weekLabel = useMemo(() => {
    if (!matchupData?.week) {
      return null;
    }
    const start = new Date(matchupData.week.week_start);
    const end = new Date(matchupData.week.week_end);
    const startLabel = start.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric"
    });
    const endLabel = end.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric"
    });
    return `${startLabel} - ${endLabel}`;
  }, [matchupData?.week]);

  const lineupData = matchupData?.lineups ?? null;
  const viewerIsHome = lineupData?.viewer_is_home ?? false;
  const canViewOpponent = lineupData?.can_view_opponent ?? false;
  const isFinalWeek = matchupData?.live?.status === "final";
  const homeLineup = lineupData?.home ?? [];
  const awayLineup = lineupData?.away ?? [];
  const homeWtdByTicker = useMemo(() => {
    const entries = matchupData?.live_breakdown?.home.positions ?? [];
    return new Map(entries.map((entry) => [entry.ticker.toUpperCase(), entry.wtd_return]));
  }, [matchupData?.live_breakdown?.home.positions]);
  const awayWtdByTicker = useMemo(() => {
    const entries = matchupData?.live_breakdown?.away.positions ?? [];
    return new Map(entries.map((entry) => [entry.ticker.toUpperCase(), entry.wtd_return]));
  }, [matchupData?.live_breakdown?.away.positions]);
  const homePortfolioWtd = matchupData?.live_breakdown?.home.total ?? null;
  const awayPortfolioWtd = matchupData?.live_breakdown?.away.total ?? null;
  const leftProfile = viewerIsHome ? matchupData?.homeProfile : matchupData?.awayProfile;
  const rightProfile = viewerIsHome ? matchupData?.awayProfile : matchupData?.homeProfile;
  const leftLineup = viewerIsHome ? homeLineup : awayLineup;
  const rightLineup = viewerIsHome ? awayLineup : homeLineup;
  const leftWtdByTicker = viewerIsHome ? homeWtdByTicker : awayWtdByTicker;
  const rightWtdByTicker = viewerIsHome ? awayWtdByTicker : homeWtdByTicker;
  const leftPortfolioWtd = viewerIsHome ? homePortfolioWtd : awayPortfolioWtd;
  const rightPortfolioWtd = viewerIsHome ? awayPortfolioWtd : homePortfolioWtd;
  const leftScore =
    matchupData?.live?.status === "delayed"
      ? viewerIsHome
        ? matchupData.live.home_score
        : matchupData.live.away_score
      : viewerIsHome
        ? matchupData?.matchup?.home_score
        : matchupData?.matchup?.away_score;
  const rightScore =
    matchupData?.live?.status === "delayed"
      ? viewerIsHome
        ? matchupData.live.away_score
        : matchupData.live.home_score
      : viewerIsHome
        ? matchupData?.matchup?.away_score
        : matchupData?.matchup?.home_score;

  const priceAsOfLabel = useMemo(() => {
    if (!matchupData?.week) {
      return null;
    }
    const weekEnd = getEtDayEnd(matchupData.week.week_end);
    if (weekEnd !== null && weekEnd < Date.now()) {
      return matchupData.week.lock_time ?? null;
    }
    return matchupData.price_as_of ?? null;
  }, [matchupData?.week, matchupData?.price_as_of]);

  if (loadingSession) {
    return (
      <main className="px-6 py-8">
        <div className="mx-auto max-w-4xl text-sm text-steel">
          Checking session...
        </div>
      </main>
    );
  }

  if (!session) {
    return (
      <main className="px-6 py-8">
        <AuthGate
          title="Live matchup center"
          subtitle="Sign in to see your live matchup performance."
          nextPath="/matchup"
        />
      </main>
    );
  }

  return (
    <main className="px-6 py-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="rounded-3xl border border-amber-200/70 bg-white/90 p-4 shadow-[0_20px_60px_rgba(20,20,20,0.12)]">
          <div className="flex flex-col items-center gap-3 text-center md:flex-row md:items-center md:text-left">
            <LogoMark size={44} />
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.35em] text-navy">
                Live matchup center
              </p>
              <h1 className="mt-1 font-display text-3xl text-ink">Live matchup</h1>
              <p className="mt-1 text-sm text-steel">
                Track your head-to-head score as lineups move this week.
              </p>
            </div>
          </div>
        </header>

        <section className="rounded-2xl border border-amber-100 bg-paper p-6">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="text-sm font-semibold text-ink">
              League
              <select
                className="mt-2 w-full rounded-xl border border-amber-100 bg-white px-4 py-3 text-sm"
                value={selectedLeagueId ?? ""}
                onChange={(event) => {
                  setSelectedLeagueId(event.target.value);
                  setSelectedWeekId(null);
                }}
              >
                {leagues.map((league) => (
                  <option key={league.id} value={league.id}>
                    {league.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm font-semibold text-ink">
              Week
              <select
                className="mt-2 w-full rounded-xl border border-amber-100 bg-white px-4 py-3 text-sm"
                value={selectedWeekId ?? ""}
                onChange={(event) => setSelectedWeekId(event.target.value)}
                disabled={weeks.length === 0}
              >
                {weeks.length === 0 ? (
                  <option value="">No weeks yet</option>
                ) : (
                  weeks.map((week) => {
                    const start = new Date(week.week_start).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric"
                    });
                    const end = new Date(week.week_end).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric"
                    });
                    return (
                      <option key={week.id} value={week.id}>
                        {start} - {end}
                      </option>
                    );
                  })
                )}
              </select>
            </label>
          </div>
        </section>

        <section
          id="matchup-live"
          className="rounded-2xl border border-amber-100 bg-paper p-6"
        >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-display text-2xl text-ink">Live matchup</h2>
              <div className="flex items-center gap-3">
                {weekLabel ? (
                  <span className="text-sm text-steel">{weekLabel}</span>
                ) : null}
                <button
                  type="button"
                  onClick={() => loadMatchup(true)}
                  className="flex h-9 w-9 items-center justify-center rounded-full border border-navy/20 bg-white text-navy shadow-sm shadow-navy/10 transition hover:border-navy hover:bg-navy-soft hover:text-white"
                  aria-label="Refresh live matchup"
                >
                  <svg
                    viewBox="0 0 24 24"
                    className="h-4 w-4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M20 12a8 8 0 1 1-2.34-5.66" />
                    <path d="M20 4v6h-6" />
                  </svg>
                </button>
              </div>
            </div>

            {error ? <p className="mt-4 text-sm text-red-600">{error}</p> : null}

            {matchupData?.live?.status === "unavailable" ? (
              <p className="mt-3 text-xs text-steel">
                Live prices unavailable. Showing saved returns until data is available.
              </p>
            ) : null}

            {loadingMatchup ? (
              <p className="mt-4 text-sm text-steel">Loading matchup...</p>
            ) : matchupData?.matchup ? (
              <div className="mt-6 space-y-6">
                <div className="rounded-2xl border border-white/40 bg-white p-6">
                  <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
                    <div className="flex items-center gap-4">
                      <TeamLogo src={leftProfile?.team_logo_url} size={110} />
                      <div>
                        <p className="text-xs uppercase tracking-[0.2em] text-steel">
                          You
                        </p>
                        <p className="mt-1 text-[10px] uppercase tracking-[0.2em] text-steel">
                          {viewerIsHome ? "Home" : "Away"}
                        </p>
                        <p className="mt-1 font-display text-2xl text-ink">
                          {leftProfile?.display_name ?? "Your team"}
                        </p>
                        <p className="mt-2 text-sm text-steel">
                          {matchupData.live?.status === "delayed"
                            ? `Live (delayed): ${formatScore(leftScore)}`
                            : `Return: ${formatScore(leftScore)}`}
                        </p>
                        {matchupData.live?.status === "delayed" &&
                        matchupData.live.updated_at ? (
                          <p className="mt-1 text-xs text-steel">
                            Updated {formatUpdatedAt(matchupData.live.updated_at)}
                          </p>
                        ) : null}
                      </div>
                    </div>

                    <div className="flex flex-col items-center gap-3 text-center">
                      <span className="rounded-full border border-navy/20 bg-navy/10 px-4 py-1 text-xs uppercase tracking-[0.3em] text-navy">
                        Head to head
                      </span>
                      <span className="font-display text-3xl text-ink">VS</span>
                      <div className="grid grid-cols-2 gap-3 text-sm text-steel">
                        <div className="rounded-xl bg-navy/10 px-4 py-3">
                          <p>You</p>
                          <p className="mt-1 text-lg font-semibold text-navy">
                            {formatScore(leftScore)}
                          </p>
                        </div>
                        <div className="rounded-xl bg-amber-50 px-4 py-3">
                          <p>Opponent</p>
                          <p className="mt-1 text-lg font-semibold text-ink">
                            {formatScore(rightScore)}
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-4 md:justify-end">
                      <div className="text-right">
                        <p className="text-xs uppercase tracking-[0.2em] text-steel">
                          Opponent
                        </p>
                        <p className="mt-1 text-[10px] uppercase tracking-[0.2em] text-steel">
                          {viewerIsHome ? "Away" : "Home"}
                        </p>
                        <p className="mt-1 font-display text-2xl text-ink">
                          {rightProfile?.display_name ?? "Opponent"}
                        </p>
                        <p className="mt-2 text-sm text-steel">
                          {matchupData.live?.status === "delayed"
                            ? `Live (delayed): ${formatScore(rightScore)}`
                            : `Return: ${formatScore(rightScore)}`}
                        </p>
                        {matchupData.live?.status === "delayed" &&
                        matchupData.live.updated_at ? (
                          <p className="mt-1 text-xs text-steel">
                            Updated {formatUpdatedAt(matchupData.live.updated_at)}
                          </p>
                        ) : null}
                      </div>
                      <TeamLogo src={rightProfile?.team_logo_url} size={110} />
                    </div>
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="rounded-2xl border border-amber-100 bg-white p-5">
                    <div className="flex items-center justify-between">
                      <p className="text-xs uppercase tracking-[0.2em] text-steel">
                        Your lineup
                      </p>
                      <span className="rounded-full bg-navy/10 px-2 py-0.5 text-xs font-semibold text-navy">
                        You
                      </span>
                    </div>
                    <p className="mt-2 font-semibold text-ink">
                      {leftProfile?.display_name ?? "Your team"}
                    </p>
                    {leftLineup.length === 0 ? (
                      <p className="mt-3 text-sm text-steel">
                        {isFinalWeek
                          ? "No lineup submitted this week."
                          : "No lineup submitted for this week yet."}
                      </p>
                    ) : (
                      <div className="mt-3 space-y-2 text-sm text-steel">
                        <p className="text-xs uppercase tracking-[0.2em] text-steel">
                          Last price as of {formatAsOf(priceAsOfLabel)}
                        </p>
                        <div className="grid grid-cols-[1.6fr_0.7fr_0.7fr_0.7fr] items-center gap-2 text-xs uppercase tracking-[0.2em] text-steel">
                          <span>Ticker</span>
                          <span className="text-right">Last price</span>
                          <span className="text-right">Weight</span>
                          <span className="text-right">WTD</span>
                        </div>
                        {leftLineup.map((position) => {
                          const info =
                            universeMap[position.ticker.toUpperCase()] ?? null;
                          const wtd = leftWtdByTicker.get(
                            position.ticker.toUpperCase()
                          );
                          return (
                            <div
                              key={`${position.ticker}-left`}
                              className="grid grid-cols-[1.6fr_0.7fr_0.7fr_0.7fr] items-center gap-2 rounded-xl border border-amber-100 bg-white px-3 py-2"
                            >
                              <div>
                                <p className="flex items-center gap-2 font-semibold text-ink">
                                  <CompanyLogo ticker={position.ticker} size={26} />
                                  <span>{position.ticker}</span>
                                  <TickerNewsButton
                                    ticker={position.ticker}
                                    className="h-4 w-4"
                                  />
                                </p>
                                <p className="text-xs text-steel">
                                  {info?.company_name ?? "Company"}
                                </p>
                              </div>
                              <span className="text-right font-semibold text-ink">
                                {formatPrice(position.last_price)}
                              </span>
                              <span className="text-right font-semibold text-navy">
                                {formatWeight(position.weight)}
                              </span>
                              <span className="text-right font-semibold text-ink">
                                {formatWtd(wtd)}
                              </span>
                            </div>
                          );
                        })}
                        <div className="flex items-center justify-between border-t border-amber-100 pt-2 text-sm font-semibold text-ink">
                          <span>Portfolio WTD return</span>
                          <span>{formatWtd(leftPortfolioWtd)}</span>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="rounded-2xl border border-amber-100 bg-white p-5">
                    <div className="flex items-center justify-between">
                      <p className="text-xs uppercase tracking-[0.2em] text-steel">
                        Opponent lineup
                      </p>
                    </div>
                    <p className="mt-2 font-semibold text-ink">
                      {rightProfile?.display_name ?? "Opponent"}
                    </p>
                    {!canViewOpponent ? (
                      <p className="mt-3 text-sm text-steel">
                        Opponent lineups are revealed after Sunday&apos;s lock.
                      </p>
                    ) : rightLineup.length === 0 ? (
                      <p className="mt-3 text-sm text-steel">
                        {isFinalWeek
                          ? "No lineup submitted this week."
                          : "Opponent lineup not submitted yet."}
                      </p>
                    ) : (
                      <div className="mt-3 space-y-2 text-sm text-steel">
                        <p className="text-xs uppercase tracking-[0.2em] text-steel">
                          Last price as of {formatAsOf(priceAsOfLabel)}
                        </p>
                        <div className="grid grid-cols-[1.6fr_0.7fr_0.7fr_0.7fr] items-center gap-2 text-xs uppercase tracking-[0.2em] text-steel">
                          <span>Ticker</span>
                          <span className="text-right">Last price</span>
                          <span className="text-right">Weight</span>
                          <span className="text-right">WTD</span>
                        </div>
                        {rightLineup.map((position) => {
                          const info =
                            universeMap[position.ticker.toUpperCase()] ?? null;
                          const wtd = rightWtdByTicker.get(
                            position.ticker.toUpperCase()
                          );
                          return (
                            <div
                              key={`${position.ticker}-right`}
                              className="grid grid-cols-[1.6fr_0.7fr_0.7fr_0.7fr] items-center gap-2 rounded-xl border border-amber-100 bg-white px-3 py-2"
                            >
                              <div>
                                <p className="flex items-center gap-2 font-semibold text-ink">
                                  <CompanyLogo ticker={position.ticker} size={26} />
                                  <span>{position.ticker}</span>
                                  <TickerNewsButton
                                    ticker={position.ticker}
                                    className="h-4 w-4"
                                  />
                                </p>
                                <p className="text-xs text-steel">
                                  {info?.company_name ?? "Company"}
                                </p>
                              </div>
                              <span className="text-right font-semibold text-ink">
                                {formatPrice(position.last_price)}
                              </span>
                              <span className="text-right font-semibold text-navy">
                                {formatWeight(position.weight)}
                              </span>
                              <span className="text-right font-semibold text-ink">
                                {formatWtd(wtd)}
                              </span>
                            </div>
                          );
                        })}
                        <div className="flex items-center justify-between border-t border-amber-100 pt-2 text-sm font-semibold text-ink">
                          <span>Portfolio WTD return</span>
                          <span>{formatWtd(rightPortfolioWtd)}</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="mt-4 rounded-2xl border border-amber-100 bg-white p-5 text-sm text-steel">
                No matchup scheduled for this week yet. Check back before lock
                time.
              </div>
            )}
        </section>
      </div>
    </main>
  );
}

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import TickerNewsButton from "@/app/components/TickerNewsButton";
import CompanyLogo from "@/app/components/CompanyLogo";
import { isLineupLocked } from "@/lib/lineup";
import {
  readWatchlist,
  writeWatchlist,
  WATCHLIST_EVENT,
  type WatchlistItem
} from "@/lib/watchlist";

type League = {
  id: string;
  name: string;
};

type Week = {
  id: string;
  week_start: string;
  week_end: string;
  lock_time: string;
};

type LineupPosition = {
  ticker: string;
  weight: number;
  company_name?: string | null;
  sector?: string | null;
  industry?: string | null;
  last_price?: number | null;
  price_as_of?: string | null;
};

type LineupData = {
  id: string;
  submitted_at: string;
  user_locked_at: string | null;
  positions: LineupPosition[];
};

type TickerSuggestion = {
  ticker: string;
  company_name: string | null;
  sector?: string | null;
  industry?: string | null;
};

const emptyPositions = Array.from({ length: 5 }, () => ({
  ticker: "",
  weight: 0
}));

const BENCHMARK_TICKER = "SPY";

const formatSectorIndustry = (entry?: {
  sector?: string | null;
  industry?: string | null;
}) => {
  if (!entry) {
    return "";
  }
  const sector = entry.sector?.trim() ?? "";
  const industry = entry.industry?.trim() ?? "";
  if (sector && industry) {
    return `${sector} / ${industry}`;
  }
  return sector || industry;
};

const formatPrice = (value?: number | null) => {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "—";
  }
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
};

const formatAsOf = (value?: string | null) => {
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
};

const splitSectorIndustry = (value: string) => {
  if (!value) {
    return { sector: "", industry: "" };
  }
  const [sector, industry] = value.split(" / ").map((entry) => entry.trim());
  return { sector: sector ?? "", industry: industry ?? "" };
};

const CHART_COLORS = [
  "#1b3d63",
  "#0d8b6a",
  "#f6c44f",
  "#64748b",
  "#0b1f3b",
  "#e76f51",
  "#2a9d8f",
  "#e9c46a"
];

const DonutChart = ({
  title,
  entries
}: {
  title: string;
  entries: { label: string; value: number }[];
}) => {
  const total = entries.reduce((sum, entry) => sum + entry.value, 0);
  const slices = entries
    .filter((entry) => entry.value > 0)
    .sort((a, b) => b.value - a.value)
    .map((entry, index) => ({
      ...entry,
      color: CHART_COLORS[index % CHART_COLORS.length]
    }));

  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <div className="rounded-2xl border border-amber-100 bg-white p-5">
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      {total <= 0 ? (
        <p className="mt-4 text-sm text-steel">Add weights to see the breakdown.</p>
      ) : (
        <div className="mt-4 flex flex-wrap items-center gap-6">
          <svg width="120" height="120" viewBox="0 0 120 120">
            <circle cx="60" cy="60" r={radius} fill="transparent" stroke="#e2e8f0" strokeWidth="16" />
            {slices.map((slice) => {
              const dash = (slice.value / total) * circumference;
              const circle = (
                <circle
                  key={slice.label}
                  cx="60"
                  cy="60"
                  r={radius}
                  fill="transparent"
                  stroke={slice.color}
                  strokeWidth="16"
                  strokeDasharray={`${dash} ${circumference - dash}`}
                  strokeDashoffset={-offset}
                  transform="rotate(-90 60 60)"
                />
              );
              offset += dash;
              return circle;
            })}
            <text x="60" y="64" textAnchor="middle" className="fill-ink text-xs font-semibold">
              {`${(total * 100).toFixed(1)}%`}
            </text>
          </svg>
          <div className="space-y-2 text-xs text-steel">
            {slices.map((slice) => (
              <div key={slice.label} className="flex items-center gap-3">
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: slice.color }} />
                <span className="text-ink">{slice.label}</span>
                <span>{`${(slice.value * 100).toFixed(1)}%`}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

const filterUniverseList = (query: string, list: TickerSuggestion[]) => {
  const trimmed = query.trim();
  if (!trimmed) {
    return list.filter((item) => item.ticker.toUpperCase() !== BENCHMARK_TICKER);
  }
  const normalized = trimmed.toUpperCase();
  const lower = trimmed.toLowerCase();
  return list.filter((item) => {
    if (item.ticker.toUpperCase() === BENCHMARK_TICKER) {
      return false;
    }
    const tickerMatch = item.ticker.toUpperCase().includes(normalized);
    const nameMatch = (item.company_name ?? "").toLowerCase().includes(lower);
    return tickerMatch || nameMatch;
  });
};

const hydratePositions = (positions: LineupPosition[] | null) => {
  if (!positions?.length) {
    return [...emptyPositions];
  }
  const normalized = positions.map((position) => ({
    ticker: position.ticker ?? "",
    weight: Number(position.weight ?? 0),
    last_price: position.last_price ?? null,
    price_as_of: position.price_as_of ?? null
  }));
  while (normalized.length < 5) {
    normalized.push({ ticker: "", weight: 0 });
  }
  return normalized.slice(0, 5);
};

export default function LineupForm() {
  const [leagues, setLeagues] = useState<League[]>([]);
  const [leagueId, setLeagueId] = useState("");
  const [week, setWeek] = useState<Week | null>(null);
  const [weeks, setWeeks] = useState<Week[]>([]);
  const [selectedWeekId, setSelectedWeekId] = useState("");
  const [lineup, setLineup] = useState<LineupData | null>(null);
  const [positions, setPositions] = useState(emptyPositions);
  const [priceAsOf, setPriceAsOf] = useState<string | null>(null);
  const [companyNames, setCompanyNames] = useState<string[]>(
    Array.from({ length: 5 }, () => "")
  );
  const [sectorNames, setSectorNames] = useState<string[]>(
    Array.from({ length: 5 }, () => "")
  );
  const [weightInputs, setWeightInputs] = useState<string[]>(
    Array.from({ length: 5 }, () => "")
  );
  const [universeOptions, setUniverseOptions] = useState<TickerSuggestion[]>([]);
  const [universeLoading, setUniverseLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<
    Record<number, TickerSuggestion[]>
  >({});
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [loadingContext, setLoadingContext] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [hasSaved, setHasSaved] = useState(false);
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);
  const searchTimers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});
  const positionsRef = useRef(positions);
  const activeIndexRef = useRef<number | null>(null);
  const lastLeagueIdRef = useRef<string>("");

  useEffect(() => {
    positionsRef.current = positions;
  }, [positions]);

  useEffect(() => {
    activeIndexRef.current = activeIndex;
  }, [activeIndex]);

  useEffect(() => {
    setWatchlist(readWatchlist());
    const handleUpdate = () => setWatchlist(readWatchlist());
    window.addEventListener(WATCHLIST_EVENT, handleUpdate);
    window.addEventListener("storage", handleUpdate);
    return () => {
      window.removeEventListener(WATCHLIST_EVENT, handleUpdate);
      window.removeEventListener("storage", handleUpdate);
    };
  }, []);

  const totalWeight = useMemo(
    () => positions.reduce((sum, position) => sum + Number(position.weight || 0), 0),
    [positions]
  );
  const usedTickers = useMemo(() => {
    const counts: Record<string, number> = {};
    positions.forEach((position) => {
      const ticker = position.ticker.trim().toUpperCase();
      if (!ticker) {
        return;
      }
      counts[ticker] = (counts[ticker] ?? 0) + 1;
    });
    return counts;
  }, [positions]);

  const hasDuplicateTickers = useMemo(
    () => Object.values(usedTickers).some((count) => count > 1),
    [usedTickers]
  );

  const weightValid = Math.abs(totalWeight - 1) <= 0.0001;

  const timeLocked = week ? isLineupLocked(week.lock_time) : false;
  const noLeague = leagues.length === 0;
  const noWeek = !week;
  const inputsDisabled = loading || loadingContext || timeLocked || noWeek;

  const weekLabel = useMemo(() => {
    if (!week) {
      return "No scheduled week yet";
    }
    const start = new Date(week.week_start).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric"
    });
    const end = new Date(week.week_end).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric"
    });
    return `${start} - ${end}`;
  }, [week]);

  const lockLabel = useMemo(() => {
    if (!week) {
      return "Awaiting league schedule";
    }
    return new Date(week.lock_time).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit"
    });
  }, [week]);

  const priceAsOfLabel = useMemo(() => {
    if (!week) {
      return null;
    }
    const weekEndTime = new Date(week.week_end).getTime();
    const historical =
      Number.isFinite(weekEndTime) && weekEndTime < Date.now();
    const asOfValue = historical ? week.lock_time : priceAsOf;
    return asOfValue ?? null;
  }, [week, priceAsOf]);

  const weekIndex = useMemo(() => {
    if (!week) {
      return -1;
    }
    return weeks.findIndex((entry) => entry.id === week.id);
  }, [week, weeks]);

  const hasPrevWeek = weekIndex > 0;
  const hasNextWeek = weekIndex >= 0 && weekIndex < weeks.length - 1;

  const sectorBreakdown = useMemo(() => {
    const totals = new Map<string, number>();
    positions.forEach((position, index) => {
      const ticker = position.ticker.trim().toUpperCase();
      const weight = Number(position.weight || 0);
      if (!ticker || weight <= 0) {
        return;
      }
      const match = universeOptions.find(
        (item) => item.ticker.toUpperCase() === ticker
      );
      const fallback = splitSectorIndustry(sectorNames[index] ?? "");
      const sector =
        match?.sector?.trim() ||
        fallback.sector ||
        "Unknown sector";
      totals.set(sector, (totals.get(sector) ?? 0) + weight);
    });
    return [...totals.entries()].map(([label, value]) => ({ label, value }));
  }, [positions, universeOptions, sectorNames]);

  const industryBreakdown = useMemo(() => {
    const totals = new Map<string, number>();
    positions.forEach((position, index) => {
      const ticker = position.ticker.trim().toUpperCase();
      const weight = Number(position.weight || 0);
      if (!ticker || weight <= 0) {
        return;
      }
      const match = universeOptions.find(
        (item) => item.ticker.toUpperCase() === ticker
      );
      const fallback = splitSectorIndustry(sectorNames[index] ?? "");
      const industry =
        match?.industry?.trim() ||
        fallback.industry ||
        "Unknown industry";
      totals.set(industry, (totals.get(industry) ?? 0) + weight);
    });
    return [...totals.entries()].map(([label, value]) => ({ label, value }));
  }, [positions, universeOptions, sectorNames]);

  const handleRemoveWatchlist = (ticker: string) => {
    const next = watchlist.filter((item) => item.ticker !== ticker);
    writeWatchlist(next);
    setWatchlist(next);
  };

  const handlePrevWeek = () => {
    if (!hasPrevWeek) {
      return;
    }
    setSelectedWeekId(weeks[weekIndex - 1].id);
  };

  const handleNextWeek = () => {
    if (!hasNextWeek) {
      return;
    }
    setSelectedWeekId(weeks[weekIndex + 1].id);
  };

  const resolveMetadata = async (nextPositions: LineupPosition[]) => {
    const metadata = await Promise.all(
      nextPositions.map(async (position) => {
        const ticker = position.ticker.trim();
        if (!ticker) {
          return { company: "", sector: "" };
        }
        try {
          const response = await fetch(
            `/api/universe/search?query=${encodeURIComponent(ticker)}`
          );
          if (!response.ok) {
            return { company: "", sector: "" };
          }
          const result = await response.json();
          const match = (result.results ?? []).find(
            (item: TickerSuggestion) =>
              item.ticker.toUpperCase() === ticker.toUpperCase()
          );
          return {
            company: match?.company_name ?? "",
            sector: formatSectorIndustry(match)
          };
        } catch (_error) {
          return { company: "", sector: "" };
        }
      })
    );

    setCompanyNames(
      metadata
        .map((entry) => entry.company)
        .concat(Array(5).fill(""))
        .slice(0, 5)
    );
    setSectorNames(
      metadata
        .map((entry) => entry.sector)
        .concat(Array(5).fill(""))
        .slice(0, 5)
    );
  };

  const loadUniverseOptions = async () => {
    if (universeOptions.length) {
      return universeOptions;
    }
    setUniverseLoading(true);
    try {
      const response = await fetch("/api/universe/list");
      if (!response.ok) {
        return [];
      }
      const result = await response.json();
      const list = (result.results ?? []) as TickerSuggestion[];
      const filtered = list.filter(
        (item) => item.ticker.toUpperCase() !== BENCHMARK_TICKER
      );
      setUniverseOptions(filtered);
      return filtered;
    } catch (_error) {
      return [];
    } finally {
      setUniverseLoading(false);
    }
  };

  const handleBrowseAll = async (index: number) => {
    const list = await loadUniverseOptions();
    setSuggestions((current) => ({ ...current, [index]: list }));
    setActiveIndex(index);
  };

  useEffect(() => {
    if (universeOptions.length || universeLoading) {
      return;
    }
    const hasTickers = positions.some((position) => position.ticker.trim());
    if (hasTickers) {
      void loadUniverseOptions();
    }
  }, [positions, universeOptions.length, universeLoading]);

  useEffect(() => {
    const loadContext = async () => {
      setLoadingContext(true);
      setError(null);

      try {
        const supabase = createSupabaseBrowserClient();
        const { data: sessionData } = await supabase.auth.getSession();
        const accessToken = sessionData.session?.access_token;

        const params = new URLSearchParams();
        if (leagueId) {
          params.set("leagueId", leagueId);
        }
        const canUseWeekId =
          leagueId &&
          selectedWeekId &&
          lastLeagueIdRef.current &&
          lastLeagueIdRef.current === leagueId;
        if (canUseWeekId) {
          params.set("weekId", selectedWeekId);
        }
        const query = params.toString();
        const response = await fetch(`/api/lineup/context${query ? `?${query}` : ""}`, {
          headers: {
            ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {})
          }
        });

        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
          setError(result.error ?? "Unable to load lineup context.");
          return;
        }

        const nextLeagues = (result.leagues ?? []) as League[];
        setLeagues(nextLeagues);

        if (!leagueId && nextLeagues.length) {
          setLeagueId(nextLeagues[0].id);
        }

        const resolvedLeagueId = leagueId || nextLeagues[0]?.id || "";
        if (resolvedLeagueId) {
          lastLeagueIdRef.current = resolvedLeagueId;
        }

        const nextWeeks = (result.weeks ?? []) as Week[];
        setWeeks(nextWeeks);
        setPriceAsOf(result.price_as_of ?? null);

        const lineupPositions = (result.lineup?.positions ?? []) as LineupPosition[];
        const hydratedPositions = hydratePositions(lineupPositions);
        const nextWeek = (result.week ?? null) as Week | null;
        setWeek(nextWeek);
        if (nextWeek?.id && nextWeek.id !== selectedWeekId) {
          setSelectedWeekId(nextWeek.id);
        }
        if (!nextWeek && selectedWeekId) {
          setSelectedWeekId("");
        }
        setLineup(result.lineup ?? null);
        setHasSaved(Boolean(result.lineup?.submitted_at));
        setPositions(hydratedPositions);
        const metaByTicker = new Map(
          lineupPositions.map((position) => [
            position.ticker.toUpperCase(),
            position
          ])
        );
        setCompanyNames(
          hydratedPositions.map((position) => {
            const meta = metaByTicker.get(position.ticker.toUpperCase());
            return meta?.company_name ?? "";
          })
        );
        setSectorNames(
          hydratedPositions.map((position) => {
            const meta = metaByTicker.get(position.ticker.toUpperCase());
            return formatSectorIndustry(meta);
          })
        );
        setWeightInputs(
          hydratedPositions.map((position) =>
            position.weight ? (position.weight * 100).toFixed(2) : ""
          )
        );
        const missingMetadata = hydratedPositions.some((position) => {
          if (!position.ticker.trim()) {
            return false;
          }
          const meta = metaByTicker.get(position.ticker.toUpperCase());
          return !meta?.company_name && !meta?.sector && !meta?.industry;
        });
        if (missingMetadata) {
          void resolveMetadata(hydratedPositions);
        }
      } catch (_error) {
        setError("Unable to load lineup context.");
      } finally {
        setLoadingContext(false);
      }
    };

    loadContext();
  }, [leagueId, selectedWeekId]);

  const queueSearch = (index: number, query: string) => {
    if (searchTimers.current[index]) {
      clearTimeout(searchTimers.current[index]);
    }

    if (!query.trim()) {
      setSuggestions((current) => ({ ...current, [index]: [] }));
      setCompanyNames((current) => {
        const next = [...current];
        next[index] = "";
        return next;
      });
      setSectorNames((current) => {
        const next = [...current];
        next[index] = "";
        return next;
      });
      return;
    }

    searchTimers.current[index] = setTimeout(async () => {
      if (universeOptions.length) {
        const filtered = filterUniverseList(query, universeOptions).slice(0, 20);
        setSuggestions((current) => ({ ...current, [index]: filtered }));

        const exact = universeOptions.find(
          (item) => item.ticker.toUpperCase() === query.toUpperCase()
        );
        setCompanyNames((current) => {
          const next = [...current];
          next[index] = exact?.company_name ?? "";
          return next;
        });
        setSectorNames((current) => {
          const next = [...current];
          next[index] = formatSectorIndustry(exact);
          return next;
        });
        return;
      }

      if (!universeLoading) {
        void loadUniverseOptions();
      }
      try {
        const response = await fetch(
          `/api/universe/search?query=${encodeURIComponent(query)}`
        );
        if (!response.ok) {
          setSuggestions((current) => ({ ...current, [index]: [] }));
          return;
        }
        const result = await response.json();
        const list = (result.results ?? []) as TickerSuggestion[];
        const filtered = list.filter(
          (item) => item.ticker.toUpperCase() !== BENCHMARK_TICKER
        );
        setSuggestions((current) => ({ ...current, [index]: filtered }));

        const exact = filtered.find(
          (item) => item.ticker.toUpperCase() === query.toUpperCase()
        );
        setCompanyNames((current) => {
          const next = [...current];
          next[index] = exact?.company_name ?? "";
          return next;
        });
        setSectorNames((current) => {
          const next = [...current];
          next[index] = formatSectorIndustry(exact);
          return next;
        });
      } catch (_error) {
        setSuggestions((current) => ({ ...current, [index]: [] }));
      }
    }, 200);
  };

  const handleSelectSuggestion = (index: number, suggestion: TickerSuggestion) => {
    if (suggestion.ticker.toUpperCase() === BENCHMARK_TICKER) {
      setSuggestions((current) => ({ ...current, [index]: [] }));
      return;
    }
    setHasSaved(false);
    setPositions((current) =>
      current.map((position, idx) =>
        idx === index
          ? {
              ...position,
              ticker: suggestion.ticker,
              last_price: null,
              price_as_of: null
            }
          : position
      )
    );
    setCompanyNames((current) => {
      const next = [...current];
      next[index] = suggestion.company_name ?? "";
      return next;
    });
    setSectorNames((current) => {
      const next = [...current];
      next[index] = formatSectorIndustry(suggestion);
      return next;
    });
    setSuggestions((current) => ({ ...current, [index]: [] }));
  };

  const handleChange = (index: number, field: "ticker" | "weight", value: string) => {
    setHasSaved(false);
    if (field === "weight") {
      setWeightInputs((current) => {
        const next = [...current];
        next[index] = value;
        return next;
      });
      const parsed = value.trim() === "" ? 0 : Number(value);
      setPositions((current) =>
        current.map((position, idx) =>
          idx === index
            ? {
                ...position,
                weight: Number.isFinite(parsed) ? parsed / 100 : 0
              }
            : position
        )
      );
      return;
    }

    setPositions((current) =>
      current.map((position, idx) =>
        idx === index
          ? {
              ...position,
              ticker: value.toUpperCase(),
              last_price: null,
              price_as_of: null
            }
          : position
      )
    );

    queueSearch(index, value);
  };

  const handleWeightBlur = (index: number) => {
    setWeightInputs((current) => {
      const next = [...current];
      const value = next[index];
      if (!value.trim()) {
        return next;
      }
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) {
        return next;
      }
      next[index] = parsed.toFixed(2);
      return next;
    });
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!leagueId) {
      setError("Select a league to submit your lineup.");
      return;
    }
    if (!week) {
      setError("No active week yet. Lineups open when a week is scheduled.");
      return;
    }
    if (hasDuplicateTickers) {
      setError("Duplicate tickers are not allowed.");
      return;
    }
    if (!weightValid) {
      setError("Weights must sum to 100%.");
      return;
    }

    setError(null);
    setSuccess(null);
    setLoading(true);

    const supabase = createSupabaseBrowserClient();
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token;

    const response = await fetch("/api/lineup/submit", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {})
      },
      credentials: "include",
      body: JSON.stringify({ leagueId, weekId: week.id, positions })
    });

    const result = await response.json();
    setLoading(false);

    if (!response.ok) {
      setError(result.error ?? "Failed to submit lineup.");
      return;
    }

    setSuccess("Lineup saved. You can update it until lock.");
    setHasSaved(true);
    setLineup((current) =>
      current
        ? { ...current, submitted_at: new Date().toISOString() }
        : { id: result.lineupId, submitted_at: new Date().toISOString(), user_locked_at: null, positions }
    );
  };

  return (
    <form className="space-y-6" onSubmit={handleSubmit}>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="text-sm font-semibold text-ink">
          League
          <select
            className="mt-2 w-full rounded-xl border border-amber-100 bg-white px-4 py-3 text-sm"
            value={leagueId}
            onChange={(event) => setLeagueId(event.target.value)}
            disabled={loadingContext || leagues.length <= 1}
          >
            {leagues.length === 0 ? (
              <option value="">No leagues yet</option>
            ) : (
              leagues.map((league) => (
                <option key={league.id} value={league.id}>
                  {league.name}
                </option>
              ))
            )}
          </select>
        </label>
        <label id="lineup-history" className="text-sm font-semibold text-ink">
          Week
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={handlePrevWeek}
              disabled={loadingContext || !hasPrevWeek}
              className="flex h-11 w-11 items-center justify-center rounded-full border border-amber-100 bg-white text-lg text-steel transition hover:bg-amber-50 disabled:cursor-not-allowed disabled:text-steel/40"
              aria-label="Previous week"
            >
              {"<"}
            </button>
            <input
              className="flex-1 rounded-xl border border-amber-100 bg-white px-4 py-3 text-sm text-steel"
              value={weekLabel}
              readOnly
            />
            <button
              type="button"
              onClick={handleNextWeek}
              disabled={loadingContext || !hasNextWeek}
              className="flex h-11 w-11 items-center justify-center rounded-full border border-amber-100 bg-white text-lg text-steel transition hover:bg-amber-50 disabled:cursor-not-allowed disabled:text-steel/40"
              aria-label="Next week"
            >
              {">"}
            </button>
          </div>
        </label>
      </div>

      <div className="rounded-xl border border-amber-100 bg-white px-4 py-3 text-sm text-steel">
        Lock deadline: {lockLabel}
      </div>
      <p className="text-xs uppercase tracking-[0.2em] text-steel">
        Last price as of {formatAsOf(priceAsOfLabel)}
      </p>
      <p className="text-xs uppercase tracking-[0.2em] text-steel">
        Stock universe: S&P 500 index
      </p>
      <p className="text-xs uppercase tracking-[0.2em] text-steel">
        Returns exclude dividends
      </p>
      {noLeague ? (
        <p className="text-sm text-steel">
          Create or join a league to unlock weekly lineups.
        </p>
      ) : null}
      {!noLeague && noWeek ? (
        <p className="text-sm text-steel">
          Weeks appear after the league schedule starts. Ask the commissioner to
          set the season timeline.
        </p>
      ) : null}

      <div className="space-y-3">
        {positions.map((position, index) => (
          <div
            key={index}
            className="grid items-stretch gap-3 md:grid-cols-[0.35fr_0.7fr_1.3fr_1.1fr_0.9fr_0.9fr]"
          >
            <div className="flex items-center justify-center">
              <CompanyLogo
                ticker={position.ticker || null}
                size={36}
                muted={!position.ticker}
              />
            </div>
            <div className="relative">
              <input
                className="h-[64px] w-full rounded-xl border border-amber-100 bg-white px-4 py-3 text-sm disabled:cursor-not-allowed disabled:bg-slate-100"
                placeholder="Ticker"
                value={position.ticker}
                maxLength={6}
                disabled={inputsDisabled}
                onFocus={() => {
                  setActiveIndex(index);
                  void handleBrowseAll(index);
                }}
                onBlur={() => {
                  const blurIndex = index;
                  setTimeout(() => {
                    if (activeIndexRef.current === blurIndex) {
                      setActiveIndex(null);
                    }
                  }, 150);
                }}
                onChange={(event) =>
                  handleChange(index, "ticker", event.target.value)
                }
              />
              {activeIndex === index &&
              (suggestions[index]?.length ?? 0) > 0 ? (
                <div
                  className="absolute left-0 z-10 mt-2 max-h-64 overflow-y-auto rounded-xl border border-amber-100 bg-white shadow-lg"
                  style={{ width: "min(520px, 90vw)" }}
                  onMouseDown={(event) => event.preventDefault()}
                >
                  {suggestions[index].map((item) => {
                    const sectorLabel = formatSectorIndustry(item);
                    const currentTicker = position.ticker.trim().toUpperCase();
                    const itemTicker = item.ticker.toUpperCase();
                    const usedElsewhere =
                      usedTickers[itemTicker] && itemTicker !== currentTicker;
                    return (
                      <button
                        key={`${item.ticker}-${item.company_name ?? ""}`}
                        type="button"
                        onMouseDown={() =>
                          usedElsewhere ? null : handleSelectSuggestion(index, item)
                        }
                        disabled={usedElsewhere}
                        className={`flex w-full items-center justify-between gap-2 px-4 py-2 text-left text-sm ${
                          usedElsewhere
                            ? "cursor-not-allowed text-steel/60"
                            : "text-ink hover:bg-amber-50"
                        }`}
                      >
                        <span className="flex flex-col">
                          <span className="flex items-center gap-2 font-semibold text-navy">
                            {item.ticker}
                            <TickerNewsButton
                              ticker={item.ticker}
                              className="h-4 w-4"
                              as="span"
                            />
                          </span>
                          <span className="text-xs text-steel">
                            {item.company_name ?? "Company"}
                          </span>
                        </span>
                        <span className="text-[10px] uppercase tracking-[0.2em] text-steel/70">
                          {usedElsewhere ? "Selected" : sectorLabel || "Sector"}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : null}
              {activeIndex === index && universeLoading ? (
                <div className="absolute z-10 mt-2 w-full rounded-xl border border-amber-100 bg-white px-4 py-3 text-xs text-steel shadow-lg">
                  Loading universe...
                </div>
              ) : null}
            </div>
            <div className="min-h-[64px] rounded-xl border border-amber-100 bg-slate-100 px-4 py-3 text-sm leading-snug text-steel">
              {companyNames[index] ? (
                companyNames[index]
              ) : (
                <span className="text-steel/60">Company Name</span>
              )}
            </div>
            <div className="min-h-[64px] rounded-xl border border-amber-100 bg-slate-100 px-4 py-3 text-sm leading-snug text-steel break-words">
              {sectorNames[index] ? (
                sectorNames[index]
              ) : (
                <span className="text-steel/60">Sector / Industry</span>
              )}
            </div>
            <div className="min-h-[64px] rounded-xl border border-amber-100 bg-slate-100 px-4 py-3 text-sm leading-snug text-steel">
              {position.last_price !== null && position.last_price !== undefined ? (
                formatPrice(position.last_price)
              ) : (
                <span className="text-steel/60">Last price</span>
              )}
            </div>
            <div className="relative">
              <input
                className="h-[64px] w-full rounded-xl border border-amber-100 bg-white px-4 py-3 pr-10 text-sm disabled:cursor-not-allowed disabled:bg-slate-100"
                type="number"
                step="1"
                placeholder="Weight"
                value={weightInputs[index] ?? ""}
                disabled={inputsDisabled}
                onChange={(event) => handleChange(index, "weight", event.target.value)}
                onBlur={() => handleWeightBlur(index)}
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-steel">
                %
              </span>
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between rounded-xl bg-amber-50 px-4 py-3 text-sm">
        <span>Total weight</span>
        <span className="font-semibold">{(totalWeight * 100).toFixed(2)}%</span>
      </div>
      {hasDuplicateTickers ? (
        <p className="text-sm text-red-600">Duplicate tickers are not allowed.</p>
      ) : null}
      {!weightValid ? (
        <p className="text-sm text-red-600">Weights must sum to 100%.</p>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <DonutChart title="Sector diversification" entries={sectorBreakdown} />
        <DonutChart title="Industry diversification" entries={industryBreakdown} />
      </div>

      <div className="rounded-2xl border border-amber-100 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-ink">Watch list</h3>
            <p className="text-xs text-steel">Saved from Playground.</p>
          </div>
        </div>
        {watchlist.length ? (
          <div className="mt-4 space-y-3">
            {watchlist.map((item) => (
              <div
                key={item.ticker}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-100 bg-white px-4 py-3 text-sm text-steel"
              >
                <div>
                  <p className="flex items-center gap-2 font-semibold text-ink">
                    <span>{item.ticker}</span>
                    <TickerNewsButton ticker={item.ticker} className="h-4 w-4" />
                  </p>
                  <p className="text-xs text-steel">
                    {item.company_name ?? "Company name"}
                  </p>
                  <p className="text-[10px] uppercase tracking-[0.2em] text-steel/70">
                    {formatSectorIndustry(item) || "Sector / Industry"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleRemoveWatchlist(item.ticker)}
                  className="rounded-full border border-navy/30 bg-white px-3 py-1 text-xs font-semibold text-navy transition hover:border-navy hover:bg-navy-soft hover:text-white"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-4 text-sm text-steel">
            No watch list items yet. Add stocks from the Playground screener.
          </p>
        )}
      </div>

      {timeLocked ? (
        <p className="text-sm text-red-600">
          Lineups are locked for this week.
        </p>
      ) : null}

      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {success ? <p className="text-sm text-navy">{success}</p> : null}

      <div className="flex flex-col gap-3 md:flex-row">
        <button
          className="mx-auto w-full max-w-[240px] rounded-full border border-navy bg-navy-soft px-6 py-3 text-sm font-semibold text-white shadow-sm shadow-navy/10 transition hover:bg-white hover:text-navy disabled:cursor-not-allowed disabled:bg-navy-soft disabled:text-white disabled:opacity-100 disabled:hover:bg-navy-soft disabled:hover:text-white"
          disabled={
            loading ||
            loadingContext ||
            timeLocked ||
            noLeague ||
            noWeek ||
            hasDuplicateTickers ||
            !weightValid
          }
          type="submit"
        >
          {loading ? "Saving..." : hasSaved || timeLocked ? "Locked" : "Save Lineup"}
        </button>
      </div>
    </form>
  );
}

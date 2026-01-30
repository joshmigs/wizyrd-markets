"use client";

export const dynamic = "force-dynamic";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import LogoMark from "@/app/components/LogoMark";
import TickerNewsButton from "@/app/components/TickerNewsButton";
import CompanyLogo from "@/app/components/CompanyLogo";
import {
  readWatchlist,
  toggleWatchlistItem,
  WATCHLIST_EVENT,
  type WatchlistItem
} from "@/lib/watchlist";

type UniverseMember = {
  ticker: string;
  company_name?: string | null;
  sector?: string | null;
  industry?: string | null;
};

type MonthlyYear = {
  year: number;
  months: (number | null)[];
};

type StockMetrics = {
  version: number;
  ticker: string;
  name: string | null;
  description: string | null;
  marketCap: string | null;
  pe: string | null;
  beta: number | null;
  annualReturn: number | null;
  oneYearReturn: number | null;
  lastPrice: number | null;
  asOf: string | null;
  revenue?: number | null;
  netIncome?: number | null;
  eps?: number | null;
  sharesOutstanding?: number | null;
  assets?: number | null;
  liabilities?: number | null;
  equity?: number | null;
  yearlyReturns: { year: number; value: number }[];
  monthlyByYear: MonthlyYear[];
};

type OptimalResult = {
  ticker: string;
  name: string | null;
  annualReturn: number | null;
  volatility: number | null;
  sharpe: number | null;
  beta: number | null;
  alpha: number | null;
  lastPrice: number | null;
  score: number;
};
type OptimalPortfolio = {
  annualReturn: number | null;
  volatility: number | null;
  sharpe: number | null;
  beta: number | null;
  alpha: number | null;
};

const MONTH_LABELS = [
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

const COLORS = ["#1b3d63", "#0d8b6a", "#2563eb", "#64748b", "#0b1f3b"];
const PORTFOLIO_COLOR = "#1b3d63";
const BENCHMARK_COLOR = "#f6c44f";

const formatPercent = (value?: number | null) =>
  value === null || value === undefined ? "—" : `${(value * 100).toFixed(2)}%`;
const formatAxisPercent = (value?: number | null) =>
  value === null || value === undefined ? "—" : `${(value * 100).toFixed(0)}%`;
const formatRatio = (value?: number | null) =>
  value === null || value === undefined || Number.isNaN(value) ? "—" : value.toFixed(2);
const formatNumber = (value?: number | null) =>
  value === null || value === undefined || Number.isNaN(value) ? "—" : value.toFixed(2);
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
const buildFallbackDescription = (
  name: string,
  sector?: string | null,
  industry?: string | null
) => {
  const core = industry
    ? `operates in the ${industry} segment${sector ? ` within the ${sector} sector` : ""}`
    : sector
      ? `operates within the ${sector} sector`
      : "is a publicly traded company in the S&P 500";
  return `${name} ${core}.`;
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

const CHART_WIDTH = 420;
const CHART_HEIGHT = 360;
const CHART_PADDING = 60;
const CHART_LABEL_OFFSET = 16;

const buildLinePath = (
  values: number[],
  width: number,
  height: number,
  min: number,
  max: number
) => {
  if (values.length < 2) {
    return "";
  }
  const padding = CHART_PADDING;
  const spread = max - min || 1;
  const xStep = (width - padding * 2) / (values.length - 1);
  return values
    .map((value, index) => {
      const x = padding + index * xStep;
      const y = height - padding - ((value - min) / spread) * (height - padding * 2);
      return `${index === 0 ? "M" : "L"} ${x} ${y}`;
    })
    .join(" ");
};

const buildChartPoints = (
  values: number[],
  width: number,
  height: number,
  min: number,
  max: number
) => {
  if (values.length < 2) {
    return [];
  }
  const padding = CHART_PADDING;
  const spread = max - min || 1;
  const xStep = (width - padding * 2) / (values.length - 1);
  return values.map((value, index) => {
    const x = padding + index * xStep;
    const y = height - padding - ((value - min) / spread) * (height - padding * 2);
    return { x, y };
  });
};

const buildAxis = (values: number[], step?: number, maxTicks = 6) => {
  if (!values.length) {
    const fallbackStep = step ?? 0.1;
    return {
      min: -fallbackStep,
      max: fallbackStep,
      ticks: [-fallbackStep, 0, fallbackStep]
    };
  }
  const rawMin = Math.min(0, ...values);
  const rawMax = Math.max(0, ...values);
  const span = rawMax - rawMin || 1;
  const computeNiceStep = (rough: number) => {
    const power = Math.pow(10, Math.floor(Math.log10(Math.max(rough, 0.0001))));
    const normalized = rough / power;
    const factor = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
    return factor * power;
  };
  let tickStep = step ?? computeNiceStep(span / Math.max(1, maxTicks - 1));
  let min = Math.floor(rawMin / tickStep) * tickStep;
  let max = Math.ceil(rawMax / tickStep) * tickStep;
  if (min === max) {
    min -= tickStep;
    max += tickStep;
  }
  let ticks = Array.from(
    { length: Math.round((max - min) / tickStep) + 1 },
    (_value, index) => Number((min + index * tickStep).toFixed(4))
  );
  let guard = 0;
  while (ticks.length > maxTicks + 1 && guard < 6) {
    tickStep = computeNiceStep(tickStep * 2);
    min = Math.floor(rawMin / tickStep) * tickStep;
    max = Math.ceil(rawMax / tickStep) * tickStep;
    if (min === max) {
      min -= tickStep;
      max += tickStep;
    }
    ticks = Array.from(
      { length: Math.round((max - min) / tickStep) + 1 },
      (_value, index) => Number((min + index * tickStep).toFixed(4))
    );
    guard += 1;
  }
  return { min, max, ticks };
};

const areTickerListsEqual = (left: string[], right: string[]) =>
  left.length === right.length && left.every((value, index) => value === right[index]);

const calculateStdDev = (values: number[]) => {
  if (values.length < 2) {
    return null;
  }
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
};

const mean = (values: number[]) =>
  values.reduce((sum, value) => sum + value, 0) / values.length;

const calculateBetaFromMaps = (
  stockMap: Map<string, number>,
  benchmarkMap: Map<string, number>
) => {
  const paired: { stock: number; benchmark: number }[] = [];
  stockMap.forEach((value, key) => {
    const benchmark = benchmarkMap.get(key);
    if (benchmark === undefined) {
      return;
    }
    paired.push({ stock: value, benchmark });
  });
  if (paired.length < 6) {
    return null;
  }
  const stockMean = paired.reduce((sum, entry) => sum + entry.stock, 0) / paired.length;
  const benchmarkMean =
    paired.reduce((sum, entry) => sum + entry.benchmark, 0) / paired.length;
  const covariance =
    paired.reduce(
      (sum, entry) => sum + (entry.stock - stockMean) * (entry.benchmark - benchmarkMean),
      0
    ) / paired.length;
  const variance =
    paired.reduce((sum, entry) => sum + (entry.benchmark - benchmarkMean) ** 2, 0) /
    paired.length;
  if (!Number.isFinite(covariance) || !Number.isFinite(variance) || variance === 0) {
    return null;
  }
  const beta = covariance / variance;
  return Number.isFinite(beta) ? beta : null;
};

const calculateAlphaFromMaps = (
  stockMap: Map<string, number>,
  benchmarkMap: Map<string, number>
) => {
  const paired: { stock: number; benchmark: number }[] = [];
  stockMap.forEach((value, key) => {
    const benchmark = benchmarkMap.get(key);
    if (benchmark === undefined) {
      return;
    }
    paired.push({ stock: value, benchmark });
  });
  if (paired.length < 6) {
    return null;
  }
  const stockMean = paired.reduce((sum, entry) => sum + entry.stock, 0) / paired.length;
  const benchmarkMean =
    paired.reduce((sum, entry) => sum + entry.benchmark, 0) / paired.length;
  const covariance =
    paired.reduce(
      (sum, entry) => sum + (entry.stock - stockMean) * (entry.benchmark - benchmarkMean),
      0
    ) / paired.length;
  const variance =
    paired.reduce((sum, entry) => sum + (entry.benchmark - benchmarkMean) ** 2, 0) /
    paired.length;
  if (!Number.isFinite(covariance) || !Number.isFinite(variance) || variance === 0) {
    return null;
  }
  const beta = covariance / variance;
  const alpha = stockMean - beta * benchmarkMean;
  return Number.isFinite(alpha) ? alpha : null;
};

const reorderTickersByStride = (tickers: string[], stride: number) => {
  if (stride <= 1 || tickers.length < 2) {
    return tickers;
  }
  const ordered: string[] = [];
  for (let offset = 0; offset < stride; offset += 1) {
    for (let index = offset; index < tickers.length; index += stride) {
      ordered.push(tickers[index]);
    }
  }
  return ordered;
};

const buildMonthlyReturnMap = (
  metrics: StockMetrics,
  startYear: number | null
) => {
  const map = new Map<string, number>();
  const years = [...metrics.monthlyByYear].sort((a, b) => a.year - b.year);
  years.forEach((row) => {
    if (startYear && row.year < startYear) {
      return;
    }
    row.months.forEach((value, index) => {
      if (value === null || value === undefined) {
        return;
      }
      const month = String(index + 1).padStart(2, "0");
      map.set(`${row.year}-${month}`, value);
    });
  });
  return map;
};

const computeAnnualizedReturn = (returns: number[]) => {
  if (!returns.length) {
    return null;
  }
  const compounded = returns.reduce((total, value) => total * (1 + value), 1);
  return Math.pow(compounded, 12 / returns.length) - 1;
};

const computeAnnualizedVolatility = (returns: number[]) => {
  const stdDev = calculateStdDev(returns);
  return stdDev === null ? null : stdDev * Math.sqrt(12);
};

const extractMonthlySeries = (
  metrics: StockMetrics,
  startYear: number | null = null
) => {
  if (!metrics.monthlyByYear?.length) {
    return [];
  }
  const ordered = [...metrics.monthlyByYear].sort((a, b) => a.year - b.year);
  const values: number[] = [];
  ordered.forEach((row) => {
    if (startYear && row.year < startYear) {
      return;
    }
    row.months.forEach((value) => {
      if (value === null || value === undefined) {
        return;
      }
      values.push(value);
    });
  });
  return values;
};

function PlaygroundPageInner() {
  const searchParams = useSearchParams();
  const [universe, setUniverse] = useState<UniverseMember[]>([]);
  const [loadingUniverse, setLoadingUniverse] = useState(true);
  const [query, setQuery] = useState("");
  const [selectedSectors, setSelectedSectors] = useState<string[]>([]);
  const [selectedIndustries, setSelectedIndustries] = useState<string[]>([]);
  const [selectedTickers, setSelectedTickers] = useState<string[]>([]);
  const [undoStack, setUndoStack] = useState<string[][]>([]);
  const [optimalObjective, setOptimalObjective] = useState("sharpe");
  const [optimalCount, setOptimalCount] = useState(5);
  const [optimalStartYear, setOptimalStartYear] = useState("inception");
  const [optimalResults, setOptimalResults] = useState<OptimalResult[] | null>(null);
  const [optimalError, setOptimalError] = useState<string | null>(null);
  const [optimalWarning, setOptimalWarning] = useState<string | null>(null);
  const [optimalLoading, setOptimalLoading] = useState(false);
  const [optimalPortfolio, setOptimalPortfolio] = useState<OptimalPortfolio | null>(null);
  const [optimalCoverage, setOptimalCoverage] = useState<{
    available: number;
    total: number;
  } | null>(null);
  const [activeTicker, setActiveTicker] = useState("");
  const [snapshotQuery, setSnapshotQuery] = useState("");
  const [monthlyQuery, setMonthlyQuery] = useState("");
  const [monthlyTicker, setMonthlyTicker] = useState("");
  const [monthlyOpen, setMonthlyOpen] = useState(false);
  const [monthlyStartYear, setMonthlyStartYear] = useState("2020");
  const [overlayQuery, setOverlayQuery] = useState("");
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [overlayStartYear, setOverlayStartYear] = useState("2020");
  const [overlayHideStocks, setOverlayHideStocks] = useState(false);
  const [snapshotOpen, setSnapshotOpen] = useState(false);
  const snapshotListRef = useRef<HTMLDivElement | null>(null);
  const monthlyListRef = useRef<HTMLDivElement | null>(null);
  const screenerListRef = useRef<HTMLDivElement | null>(null);
  const screenerInputRef = useRef<HTMLInputElement | null>(null);
  const snapshotScrollTopRef = useRef(0);
  const monthlyScrollTopRef = useRef(0);
  const screenerScrollTopRef = useRef(0);
  const [metricsByTicker, setMetricsByTicker] = useState<Record<string, StockMetrics>>({});
  const [metricsErrorsByTicker, setMetricsErrorsByTicker] = useState<
    Record<string, string>
  >({});
  const [metricsError, setMetricsError] = useState<string | null>(null);
  const [screenerFocus, setScreenerFocus] = useState(false);
  const [screenerTicker, setScreenerTicker] = useState("");
  const [weights, setWeights] = useState<Record<string, number>>({});
  const [weightInputs, setWeightInputs] = useState<Record<string, string>>({});
  const [activeWeightTicker, setActiveWeightTicker] = useState<string | null>(null);
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);
  const metricsLoadingRef = useRef(false);
  const lastMetricsFetchRef = useRef(0);
  const overlayRequestRef = useRef<AbortController | null>(null);
  const defaultsAppliedRef = useRef(false);
  const lastDeepLinkRef = useRef<string | null>(null);
  const selectedTickersRef = useRef<string[]>([]);

  const viewValue = (searchParams.get("view") ?? "all").toLowerCase();
  const playgroundView = [
    "all",
    "track-record",
    "optimal",
    "overlay",
    "snapshot",
    "screener"
  ].includes(viewValue)
    ? viewValue
    : "all";
  const showTrackRecord =
    playgroundView === "all" || playgroundView === "track-record";
  const showOptimalSection = playgroundView === "all" || playgroundView === "optimal";
  const showOverlaySection =
    playgroundView === "all" ||
    playgroundView === "optimal" ||
    playgroundView === "overlay";
  const showSnapshotSection =
    playgroundView === "all" || playgroundView === "snapshot";
  const showScreenerSection =
    playgroundView === "all" ||
    playgroundView === "screener" ||
    playgroundView === "overlay";
  const showDualPanels = showOptimalSection && showOverlaySection;

  const pushUndo = (previous: string[]) => {
    setUndoStack((current) => {
      const next = [...current, previous];
      return next.length > 25 ? next.slice(next.length - 25) : next;
    });
  };

  const applySelection = (
    next: string[],
    options?: { skipHistory?: boolean }
  ) => {
    const previous = selectedTickersRef.current;
    if (!options?.skipHistory && !areTickerListsEqual(previous, next)) {
      pushUndo(previous);
    }
    setSelectedTickers(next);
  };

  const applySelectionUpdate = (
    updater: (current: string[]) => string[],
    options?: { skipHistory?: boolean }
  ) => {
    const next = updater(selectedTickersRef.current);
    applySelection(next, options);
  };
  const benchmarkTicker = "SPY";
  const buildDefaultOverlayTickers = (list: UniverseMember[]) =>
    list
      .filter((item) => item.ticker !== benchmarkTicker)
      .slice(0, 3)
      .map((item) => item.ticker);

  const handleUndoSelection = () => {
    setUndoStack((current) => {
      if (!current.length) {
        return current;
      }
      const previous = current[current.length - 1];
      setSelectedTickers(previous);
      return current.slice(0, -1);
    });
  };
  const handleResetOverlaySelection = () => {
    const defaults = buildDefaultOverlayTickers(universe);
    if (!defaults.length) {
      return;
    }
    applySelection(defaults);
    setOverlayQuery("");
    setOverlayOpen(false);
  };

  const formatWeightInput = (value: number) => `${value.toFixed(2)}%`;
  const parseWeightInput = (value: string) => {
    const cleaned = value.replace(/[^0-9.]/g, "");
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : 0;
  };

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

  useEffect(() => {
    selectedTickersRef.current = selectedTickers;
  }, [selectedTickers]);

  useEffect(() => {
    const rawTicker = searchParams.get("ticker");
    if (!rawTicker) {
      lastDeepLinkRef.current = null;
      return;
    }
    const normalized = rawTicker.replace(/[^a-zA-Z0-9.]/g, "").toUpperCase();
    if (!normalized) {
      return;
    }
    const match = universe.find((stock) => stock.ticker === normalized);
    const nextQuery = match
      ? `${match.ticker} · ${match.company_name ?? ""}`.trim()
      : normalized;
    const alreadyApplied =
      lastDeepLinkRef.current === normalized &&
      activeTicker === normalized &&
      snapshotQuery === nextQuery;
    if (alreadyApplied) {
      return;
    }
    if (match) {
      setActiveTicker(match.ticker);
      setSnapshotQuery(nextQuery);
    } else {
      setActiveTicker(normalized);
      setSnapshotQuery(normalized);
    }
    setSnapshotOpen(false);
    lastDeepLinkRef.current = normalized;
  }, [searchParams, universe, activeTicker, snapshotQuery]);

  useEffect(() => {
    const loadUniverse = async () => {
      const cached =
        typeof window !== "undefined"
          ? window.sessionStorage.getItem("wizyrd-universe-cache")
          : null;
      const applyDefaults = (list: UniverseMember[]) => {
        if (defaultsAppliedRef.current) {
          return;
        }
        if (selectedTickersRef.current.length) {
          defaultsAppliedRef.current = true;
          return;
        }
        const defaults = buildDefaultOverlayTickers(list);
        if (defaults.length) {
          applySelection(defaults, { skipHistory: true });
          defaultsAppliedRef.current = true;
        }
      };

      if (cached) {
        try {
          const parsed = JSON.parse(cached) as {
            timestamp: number;
            results: UniverseMember[];
          };
          if (Date.now() - parsed.timestamp < 1000 * 60 * 60 * 6) {
            setUniverse(parsed.results);
            setLoadingUniverse(false);
            applyDefaults(parsed.results);
          }
        } catch {
          // ignore cache errors
        }
      }

      setLoadingUniverse(true);
      const response = await fetch("/api/universe/list");
      const result = await response.json().catch(() => ({}));
      const list = (result.results ?? []) as UniverseMember[];
      setUniverse(list);
      setLoadingUniverse(false);
      if (typeof window !== "undefined") {
        window.sessionStorage.setItem(
          "wizyrd-universe-cache",
          JSON.stringify({ timestamp: Date.now(), results: list })
        );
      }
      applyDefaults(list);
      if (!activeTicker) {
        setSnapshotQuery("");
      }
    };

    loadUniverse();
  }, []);

  useEffect(() => {
    if (!selectedTickers.length) {
      setWeights({});
      return;
    }
    if (selectedTickers.includes(benchmarkTicker)) {
      applySelectionUpdate(
        (current) => current.filter((ticker) => ticker !== benchmarkTicker),
        { skipHistory: true }
      );
      return;
    }
    const evenWeight = Number((100 / selectedTickers.length).toFixed(2));
    const next: Record<string, number> = {};
    selectedTickers.forEach((ticker, index) => {
      next[ticker] = evenWeight;
      if (index === selectedTickers.length - 1) {
        const total = evenWeight * selectedTickers.length;
        next[ticker] = Number((evenWeight + (100 - total)).toFixed(2));
      }
    });
    setWeights(next);
  }, [selectedTickers]);

  useEffect(() => {
    setWeightInputs((current) => {
      const next: Record<string, string> = {};
      selectedTickers.forEach((ticker) => {
        if (ticker === activeWeightTicker && current[ticker] !== undefined) {
          next[ticker] = current[ticker];
          return;
        }
        const weight = weights[ticker] ?? 0;
        next[ticker] = formatWeightInput(weight);
      });
      return next;
    });
  }, [selectedTickers, weights, activeWeightTicker]);

  const sectorOptions = useMemo(() => {
    const options = Array.from(
      new Set(universe.map((stock) => stock.sector).filter(Boolean) as string[])
    );
    return options.sort((a, b) => a.localeCompare(b));
  }, [universe]);

  const industryOptions = useMemo(() => {
    const filteredUniverse =
      selectedSectors.length === 0
        ? universe
        : universe.filter((stock) => stock.sector && selectedSectors.includes(stock.sector));
    const options = Array.from(
      new Set(filteredUniverse.map((stock) => stock.industry).filter(Boolean) as string[])
    );
    return options.sort((a, b) => a.localeCompare(b));
  }, [universe, selectedSectors]);

  useEffect(() => {
    setSelectedIndustries((current) =>
      current.filter((industry) => industryOptions.includes(industry))
    );
  }, [industryOptions]);

  const filteredStocks = useMemo(() => {
    const baseQuery = screenerTicker || query;
    const normalizedQuery = baseQuery.split(" · ")[0].trim().toLowerCase();
    const tokens = normalizedQuery.split(/\s+/).filter(Boolean);
    return universe.filter((stock) => {
      const matchesQuery =
        !normalizedQuery ||
        stock.ticker.toLowerCase().startsWith(normalizedQuery) ||
        (() => {
          const companyLower = (stock.company_name ?? "").toLowerCase();
          const words = companyLower.split(/[^a-z0-9]+/).filter(Boolean);
          if (!words.length) {
            return false;
          }
          return tokens.length
            ? tokens.every((token) => words.some((word) => word.startsWith(token)))
            : words.some((word) => word.startsWith(normalizedQuery));
        })();
      const matchesSector =
        selectedSectors.length === 0 ||
        (stock.sector && selectedSectors.includes(stock.sector));
      const matchesIndustry =
        selectedIndustries.length === 0 ||
        (stock.industry && selectedIndustries.includes(stock.industry));
      return matchesQuery && matchesSector && matchesIndustry;
    });
  }, [universe, query, screenerTicker, selectedSectors, selectedIndustries]);

  useEffect(() => {
    if (!showScreenerSection || metricsLoadingRef.current || !filteredStocks.length) {
      return;
    }

    const missing = filteredStocks
      .map((stock) => stock.ticker)
      .filter((ticker) => !metricsByTicker[ticker])
      .slice(0, 1);

    if (!missing.length) {
      return;
    }

    const now = Date.now();
    if (now - lastMetricsFetchRef.current < 20000) {
      return;
    }

    const loadBatch = async () => {
      metricsLoadingRef.current = true;
      lastMetricsFetchRef.current = Date.now();
      try {
        const response = await fetch(
          `/api/playground/stock?tickers=${encodeURIComponent(
            missing.join(",")
          )}&includeOverview=0&useDaily=0`
        );
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
          setMetricsErrorsByTicker((current) => {
            const next = { ...current };
            missing.forEach((ticker) => {
              next[ticker] = result.error ?? "Unable to load market data.";
            });
            return next;
          });
          return;
        }
        applyMetricsResult(result, { overwriteExisting: false });
      } finally {
        metricsLoadingRef.current = false;
      }
    };

    loadBatch();
  }, [showScreenerSection, filteredStocks, metricsByTicker]);

  const buildOptions = (value: string, limit = 20) => {
    const queryValue = value.trim().toLowerCase();
    if (!queryValue) {
      return universe;
    }
    const tokens = queryValue.split(/\s+/).filter(Boolean);
    const filtered = universe
      .map((stock) => {
        const tickerLower = stock.ticker.toLowerCase();
        const companyLower = (stock.company_name ?? "").toLowerCase();
        const words = companyLower.split(/[^a-z0-9]+/).filter(Boolean);
        let score: number | null = null;
        if (tickerLower === queryValue) {
          score = 0;
        } else if (tickerLower.startsWith(queryValue)) {
          score = 1;
        } else if (tokens.length && words.length) {
          const matchesAll = tokens.every((token) =>
            words.some((word) => word.startsWith(token))
          );
          if (matchesAll) {
            score = 2;
          }
        } else if (words.some((word) => word.startsWith(queryValue))) {
          score = 3;
        }
        return score === null ? null : { stock, score };
      })
      .filter((entry): entry is { stock: UniverseMember; score: number } =>
        Boolean(entry)
      )
      .sort((left, right) => {
        if (left.score !== right.score) {
          return left.score - right.score;
        }
        return left.stock.ticker.localeCompare(right.stock.ticker);
      })
      .map((entry) => entry.stock);
    return filtered.slice(0, limit);
  };

  const buildScreenerOptions = (value: string, limit = 20) => {
    const queryValue = value.trim().toLowerCase();
    if (!queryValue) {
      return universe;
    }
    const rawTokens = queryValue
      .split(/\s+/)
      .map((token) => token.trim())
      .filter(Boolean);
    const tokens = rawTokens.filter(
      (token) => token.length > 1 && !["of", "the", "and"].includes(token)
    );
    const useTokens = tokens.length ? tokens : rawTokens;
    const filtered = universe.filter((stock) => {
      const tickerLower = stock.ticker.toLowerCase();
      const companyLower = (stock.company_name ?? "").toLowerCase();
      if (tickerLower.startsWith(queryValue)) {
        return true;
      }
      const words = companyLower.split(/[^a-z0-9]+/).filter(Boolean);
      if (!words.length) {
        return false;
      }
      return useTokens.every((token) =>
        words.some((word) => word.startsWith(token))
      );
    });
    return filtered.slice(0, limit);
  };

  const toSearchValue = (value: string, open: boolean) => {
    if (!open) {
      return value;
    }
    if (!value) {
      return "";
    }
    const parts = value.split(" · ");
    return parts.length > 1 ? "" : value;
  };

  const snapshotSearchValue = toSearchValue(snapshotQuery, snapshotOpen);
  const snapshotLimit =
    snapshotOpen && activeTicker ? universe.length : 20;
  const snapshotOptions = useMemo(
    () => buildOptions(snapshotSearchValue, snapshotLimit),
    [snapshotSearchValue, snapshotLimit, universe]
  );

  const monthlySearchValue = toSearchValue(monthlyQuery, monthlyOpen);
  const monthlyLimit =
    monthlyOpen && monthlyTicker ? universe.length : 20;
  const monthlyOptions = useMemo(
    () => buildOptions(monthlySearchValue, monthlyLimit),
    [monthlySearchValue, monthlyLimit, universe]
  );

  const overlayOptions = useMemo(() => {
    if (!overlayOpen) {
      return [];
    }
    const queryValue = overlayQuery.trim().toLowerCase();
    if (!queryValue) {
      return universe.filter((stock) => stock.ticker !== benchmarkTicker);
    }
    return universe.filter(
      (stock) =>
        stock.ticker !== benchmarkTicker &&
        (stock.ticker.toLowerCase().includes(queryValue) ||
          (stock.company_name ?? "").toLowerCase().includes(queryValue))
    );
  }, [overlayOpen, overlayQuery, universe, benchmarkTicker]);
  const benchmarkMetrics = metricsByTicker[benchmarkTicker] ?? null;
  const activeStock = activeTicker
    ? universe.find((stock) => stock.ticker === activeTicker) ?? null
    : null;
  const monthlyStock = monthlyTicker
    ? universe.find((stock) => stock.ticker === monthlyTicker) ?? null
    : null;

  const activeMetrics = activeTicker ? metricsByTicker[activeTicker] : null;
  const activeError = activeTicker ? metricsErrorsByTicker[activeTicker] : null;
  const monthlyMetrics = monthlyTicker ? metricsByTicker[monthlyTicker] : null;
  const activeInWatchlist = activeTicker
    ? watchlist.some((item) => item.ticker === activeTicker)
    : false;
  const activeInOverlay = activeTicker
    ? selectedTickers.includes(activeTicker)
    : false;
  const monthlyInWatchlist = monthlyTicker
    ? watchlist.some((item) => item.ticker === monthlyTicker)
    : false;
  const monthlyInOverlay = monthlyTicker
    ? selectedTickers.includes(monthlyTicker)
    : false;
  const monthlyHasData = monthlyMetrics?.monthlyByYear?.length ?? 0;
  const monthlyError = monthlyTicker ? metricsErrorsByTicker[monthlyTicker] : null;
  const snapshotLoading = Boolean(activeTicker && !activeMetrics && !activeError);
  const snapshotPlaceholder = snapshotLoading ? "Loading..." : "—";
  useEffect(() => {
    if (!snapshotOpen || !snapshotListRef.current) {
      return;
    }
    if (snapshotScrollTopRef.current > 0) {
      snapshotListRef.current.scrollTop = snapshotScrollTopRef.current;
      return;
    }
    if (!activeTicker) {
      return;
    }
    const target = snapshotListRef.current.querySelector(
      `[data-ticker="${activeTicker}"]`
    );
    if (target instanceof HTMLElement) {
      target.scrollIntoView({ block: "nearest" });
    }
  }, [snapshotOpen, activeTicker, snapshotOptions.length]);

  useEffect(() => {
    if (!monthlyOpen || !monthlyListRef.current) {
      return;
    }
    if (monthlyScrollTopRef.current > 0) {
      monthlyListRef.current.scrollTop = monthlyScrollTopRef.current;
      return;
    }
    if (!monthlyTicker) {
      return;
    }
    const target = monthlyListRef.current.querySelector(
      `[data-ticker="${monthlyTicker}"]`
    );
    if (target instanceof HTMLElement) {
      target.scrollIntoView({ block: "nearest" });
    }
  }, [monthlyOpen, monthlyTicker, monthlyOptions.length]);
  const fallbackDescription = useMemo(() => {
    if (!activeTicker) {
      return null;
    }
    const name =
      activeMetrics?.name ?? activeStock?.company_name ?? activeStock?.ticker ?? activeTicker;
    return buildFallbackDescription(
      name,
      activeStock?.sector ?? null,
      activeStock?.industry ?? null
    );
  }, [
    activeTicker,
    activeMetrics?.name,
    activeStock?.company_name,
    activeStock?.industry,
    activeStock?.sector,
    activeStock?.ticker
  ]);
  const snapshotVolatility = useMemo(() => {
    if (!activeMetrics?.monthlyByYear?.length) {
      return null;
    }
    const values = activeMetrics.monthlyByYear
      .flatMap((year) => year.months)
      .filter((value): value is number => value !== null);
    const stdDev = calculateStdDev(values);
    return stdDev ? stdDev * Math.sqrt(12) : null;
  }, [activeMetrics]);
  const monthlyYearOptions = useMemo(() => {
    const years = monthlyMetrics?.monthlyByYear?.map((row) => row.year) ?? [];
    return Array.from(new Set(years)).sort((a, b) => b - a);
  }, [monthlyMetrics]);

  useEffect(() => {
    if (!monthlyYearOptions.length) {
      return;
    }
    if (monthlyStartYear === "inception") {
      return;
    }
    const parsed = Number(monthlyStartYear);
    if (Number.isNaN(parsed)) {
      setMonthlyStartYear("inception");
      return;
    }
    if (!monthlyYearOptions.includes(parsed)) {
      setMonthlyStartYear(monthlyYearOptions.includes(2020) ? "2020" : "inception");
    }
  }, [monthlyYearOptions, monthlyStartYear]);

  const monthlyRows = useMemo(() => {
    if (!monthlyMetrics?.monthlyByYear?.length) {
      return [];
    }
    const startYear =
      monthlyStartYear === "inception" ? null : Number(monthlyStartYear);
    const filtered = monthlyMetrics.monthlyByYear.filter((row) =>
      startYear ? row.year >= startYear : true
    );
    return filtered.sort((a, b) => b.year - a.year);
  }, [monthlyMetrics, monthlyStartYear]);

  const monthlyReturnSeries = useMemo(() => {
    if (!monthlyMetrics?.monthlyByYear?.length) {
      return [];
    }
    const startYear =
      monthlyStartYear === "inception" ? null : Number(monthlyStartYear);
    const ordered = monthlyMetrics.monthlyByYear
      .filter((row) => (startYear ? row.year >= startYear : true))
      .sort((a, b) => a.year - b.year);
    return ordered
      .flatMap((row) => row.months)
      .filter((value): value is number => value !== null);
  }, [monthlyMetrics, monthlyStartYear]);

  const monthlyAnnualized = useMemo(() => {
    if (!monthlyReturnSeries.length) {
      return { annualReturn: null, annualVolatility: null, sharpe: null };
    }
    const compounded = monthlyReturnSeries.reduce(
      (total, value) => total * (1 + value),
      1
    );
    const annualReturn = Math.pow(
      compounded,
      12 / monthlyReturnSeries.length
    ) - 1;
    const monthlyStdDev = calculateStdDev(monthlyReturnSeries);
    const annualVolatility =
      monthlyStdDev !== null ? monthlyStdDev * Math.sqrt(12) : null;
    const sharpe =
      annualVolatility && annualVolatility !== 0 ? annualReturn / annualVolatility : null;
    return { annualReturn, annualVolatility, sharpe };
  }, [monthlyReturnSeries]);

  const monthlyWinLoss = useMemo(() => {
    if (!monthlyReturnSeries.length) {
      return { winPct: null, lossPct: null };
    }
    const wins = monthlyReturnSeries.filter((value) => value > 0).length;
    const losses = monthlyReturnSeries.filter((value) => value < 0).length;
    const total = monthlyReturnSeries.length;
    return {
      winPct: total ? wins / total : null,
      lossPct: total ? losses / total : null
    };
  }, [monthlyReturnSeries]);
  const isScreenerVisible = showScreenerSection;
  const screenerSearchValue = toSearchValue(query, screenerFocus);
  const screenerLimit = screenerFocus ? universe.length : 20;
  const screenerOptions = useMemo(
    () =>
      screenerFocus
        ? buildScreenerOptions(screenerSearchValue, screenerLimit)
        : [],
    [screenerFocus, screenerSearchValue, screenerLimit, universe]
  );
  const screenerSelectedTicker = useMemo(() => {
    if (screenerTicker) {
      return screenerTicker;
    }
    const parts = query.split(" · ");
    if (parts.length > 1) {
      return parts[0]?.trim().toUpperCase() ?? "";
    }
    return "";
  }, [query, screenerTicker]);
  useEffect(() => {
    if (!screenerFocus || !screenerListRef.current) {
      return;
    }
    if (screenerScrollTopRef.current > 0) {
      screenerListRef.current.scrollTop = screenerScrollTopRef.current;
      return;
    }
    if (!screenerSelectedTicker) {
      return;
    }
    const target = screenerListRef.current.querySelector(
      `[data-ticker="${screenerSelectedTicker}"]`
    );
    if (target instanceof HTMLElement) {
      target.scrollIntoView({ block: "nearest" });
    }
  }, [screenerFocus, screenerSelectedTicker, screenerOptions.length]);

  const screenerAsOf = useMemo(() => {
    const dates = filteredStocks
      .map((stock) => metricsByTicker[stock.ticker]?.asOf)
      .filter(Boolean) as string[];
    if (!dates.length) {
      return null;
    }
    return dates.sort().pop() ?? null;
  }, [filteredStocks, metricsByTicker]);

  const applyMetricsResult = (
    result: {
      data?: Record<string, StockMetrics>;
      errors?: Record<string, string>;
    },
    options?: { overwriteExisting?: boolean; suppressErrors?: boolean }
  ) => {
    if (result.data) {
      const overwriteExisting = options?.overwriteExisting ?? true;
      setMetricsByTicker((current) => {
        if (overwriteExisting) {
          return { ...current, ...result.data };
        }
        const next = { ...current };
        Object.entries(result.data).forEach(([ticker, payload]) => {
          if (!next[ticker]) {
            next[ticker] = payload;
          }
        });
        return next;
      });
    }
    if (result.errors || result.data) {
      if (options?.suppressErrors) {
        if (result.data) {
          setMetricsErrorsByTicker((current) => {
            const next = { ...current };
            Object.keys(result.data ?? {}).forEach((ticker) => {
              delete next[ticker];
            });
            return next;
          });
        }
        return;
      }
      setMetricsErrorsByTicker((current) => {
        const next = { ...current, ...(result.errors ?? {}) };
        if (result.data) {
          Object.keys(result.data).forEach((ticker) => {
            delete next[ticker];
          });
        }
        return next;
      });
    }
  };

  const handleSelectSnapshot = (option: UniverseMember) => {
    setActiveTicker(option.ticker);
    setSnapshotQuery(`${option.ticker} · ${option.company_name ?? ""}`.trim());
  };

  const handleSelectMonthly = (option: UniverseMember) => {
    setMonthlyTicker(option.ticker);
    setMonthlyQuery(`${option.ticker} · ${option.company_name ?? ""}`.trim());
    setMonthlyOpen(false);
  };

  const overlayTickers = Array.from(new Set(selectedTickers)).filter(
    (ticker) => ticker !== benchmarkTicker
  );

  useEffect(() => {
    const loadMetrics = async () => {
      const primaryTickers = Array.from(
        new Set(
          [activeTicker, monthlyTicker, activeTicker ? "SPY" : ""].filter(Boolean)
        )
      );
      if (!primaryTickers.length) {
        return;
      }

      setMetricsError(null);
      setMetricsErrorsByTicker((current) => {
        const next = { ...current };
        primaryTickers.forEach((ticker) => {
          delete next[ticker];
        });
        return next;
      });
      const response = await fetch(
        `/api/playground/stock?tickers=${encodeURIComponent(primaryTickers.join(","))}&includeOverview=1`
      );
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMetricsError(result.error ?? "Unable to load market data.");
        setMetricsErrorsByTicker((current) => {
          const next = { ...current };
          primaryTickers.forEach((ticker) => {
            next[ticker] = result.error ?? "Unable to load market data.";
          });
          return next;
        });
        return;
      }
      applyMetricsResult(result, { overwriteExisting: true });
    };

    loadMetrics();
  }, [activeTicker, monthlyTicker]);

  useEffect(() => {
    const loadOverlayMetrics = async () => {
      const extraTickers = overlayTickers
        .filter((ticker) => ticker !== activeTicker && ticker !== monthlyTicker)
        .filter((ticker) => !metricsByTicker[ticker]);
      const needsBenchmark = !metricsByTicker[benchmarkTicker];
      if (needsBenchmark) {
        extraTickers.push(benchmarkTicker);
      }
      const requested = Array.from(new Set(extraTickers));
      if (!requested.length) {
        return;
      }

      overlayRequestRef.current?.abort();
      const controller = new AbortController();
      overlayRequestRef.current = controller;
      try {
        const response = await fetch(
          `/api/playground/stock?tickers=${encodeURIComponent(
            requested.join(",")
          )}&includeOverview=0&useDaily=0&cacheOnly=1`,
          { signal: controller.signal }
        );
        const result = await response.json().catch(() => ({}));
        if (controller.signal.aborted) {
          return;
        }
        if (!response.ok) {
          setMetricsErrorsByTicker((current) => {
            const next = { ...current };
            requested.forEach((ticker) => {
              next[ticker] = result.error ?? "Unable to load market data.";
            });
            return next;
          });
          return;
        }
        applyMetricsResult(result, { overwriteExisting: false, suppressErrors: true });
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          return;
        }
        setMetricsErrorsByTicker((current) => {
          const next = { ...current };
          requested.forEach((ticker) => {
            next[ticker] = "Unable to load market data.";
          });
          return next;
        });
      }
    };

    loadOverlayMetrics();
  }, [overlayTickers, activeTicker, monthlyTicker, metricsByTicker]);

  const overlayMetrics = overlayTickers
    .map((ticker) => metricsByTicker[ticker])
    .filter(Boolean) as StockMetrics[];
  const overlayYearOptions = useMemo(() => {
    const years = new Set<number>();
    overlayMetrics.forEach((metrics) => {
      metrics.monthlyByYear.forEach((row) => years.add(row.year));
    });
    if (benchmarkMetrics?.monthlyByYear?.length) {
      benchmarkMetrics.monthlyByYear.forEach((row) => years.add(row.year));
    }
    return Array.from(years).sort((a, b) => b - a);
  }, [overlayMetrics, benchmarkMetrics]);

  const optimalYearOptions = useMemo(() => {
    const years = new Set<number>();
    const candidateUniverse = filteredStocks.length ? filteredStocks : universe;
    candidateUniverse.forEach((stock) => {
      const metrics = metricsByTicker[stock.ticker];
      metrics?.monthlyByYear?.forEach((row) => years.add(row.year));
    });
    if (!years.size && benchmarkMetrics?.monthlyByYear?.length) {
      benchmarkMetrics.monthlyByYear.forEach((row) => years.add(row.year));
    }
    return Array.from(years).sort((a, b) => b - a);
  }, [filteredStocks, universe, metricsByTicker, benchmarkMetrics]);

  const overlayStartYearValue =
    overlayStartYear === "inception" ? null : Number(overlayStartYear);

  useEffect(() => {
    if (!overlayYearOptions.length) {
      return;
    }
    if (overlayStartYear === "inception") {
      return;
    }
    const parsed = Number(overlayStartYear);
    if (Number.isNaN(parsed)) {
      setOverlayStartYear("inception");
      return;
    }
    if (!overlayYearOptions.includes(parsed)) {
      setOverlayStartYear(overlayYearOptions.includes(2020) ? "2020" : "inception");
    }
  }, [overlayYearOptions, overlayStartYear]);

  useEffect(() => {
    if (!optimalYearOptions.length) {
      return;
    }
    if (optimalStartYear === "inception") {
      return;
    }
    const parsed = Number(optimalStartYear);
    if (Number.isNaN(parsed)) {
      setOptimalStartYear("inception");
      return;
    }
    if (!optimalYearOptions.includes(parsed)) {
      setOptimalStartYear(optimalYearOptions.includes(2020) ? "2020" : "inception");
    }
  }, [optimalYearOptions, optimalStartYear]);

  const parsedOptimalStartYear =
    optimalStartYear === "inception" ? null : Number(optimalStartYear);
  const optimalStartYearValue =
    parsedOptimalStartYear === null || Number.isNaN(parsedOptimalStartYear)
      ? null
      : parsedOptimalStartYear;

  const chartYears = useMemo(() => {
    const yearLists: number[][] = [];
    if (overlayMetrics.length) {
      yearLists.push(
        ...overlayMetrics.map((metrics) =>
          metrics.yearlyReturns.map((entry) => entry.year)
        )
      );
    } else if (benchmarkMetrics?.yearlyReturns?.length) {
      yearLists.push(benchmarkMetrics.yearlyReturns.map((entry) => entry.year));
    }
    if (benchmarkMetrics?.yearlyReturns?.length) {
      yearLists.push(benchmarkMetrics.yearlyReturns.map((entry) => entry.year));
    }
    if (!yearLists.length) {
      return [];
    }
    let commonYears = yearLists.reduce((acc, list) =>
      acc.filter((year) => list.includes(year))
    );
    if (overlayStartYearValue) {
      commonYears = commonYears.filter((year) => year >= overlayStartYearValue);
    } else if (commonYears.length > 6) {
      commonYears = commonYears.slice(-6);
    }
    return commonYears.sort((a, b) => a - b);
  }, [overlayMetrics, benchmarkMetrics, overlayStartYearValue]);
  const chartYearLabels = useMemo(() => {
    const currentYear = new Date().getFullYear();
    return chartYears.map((year) =>
      year === currentYear ? `${year} YTD` : `${year}`
    );
  }, [chartYears]);

  const overlaySeries = overlayMetrics.map((metrics) => {
    const values = new Map(metrics.yearlyReturns.map((entry) => [entry.year, entry.value]));
    return {
      ticker: metrics.ticker,
      series: chartYears.map((year) => values.get(year) ?? 0)
    };
  });
  const benchmarkSeries = benchmarkMetrics
    ? (() => {
        const values = new Map(
          benchmarkMetrics.yearlyReturns.map((entry) => [entry.year, entry.value])
        );
        return chartYears.map((year) => values.get(year) ?? 0);
      })()
    : [];

  const chartSeries = overlaySeries.map((entry) => entry.series);
  const chartValues = chartSeries.flat();
  const leftAxis = buildAxis(chartValues);
  const visibleSeries = overlayHideStocks ? [] : chartSeries;

  const overlayReturnMaps = useMemo(
    () =>
      overlayMetrics.map((metrics) => ({
        ticker: metrics.ticker,
        map: buildMonthlyReturnMap(metrics, overlayStartYearValue)
      })),
    [overlayMetrics, overlayStartYearValue]
  );
  const overlayMonthKeys = useMemo(() => {
    if (!overlayReturnMaps.length) {
      return [];
    }
    const lists = overlayReturnMaps.map((entry) => Array.from(entry.map.keys()));
    let common = lists.reduce((acc, list) => acc.filter((key) => list.includes(key)));
    common = common.sort();
    return common;
  }, [overlayReturnMaps]);
  const portfolioMonthlySeries = useMemo(() => {
    if (!overlayMonthKeys.length || !overlayReturnMaps.length) {
      return [];
    }
    const weightTotal = overlayReturnMaps.reduce(
      (sum, entry) => sum + (weights[entry.ticker] ?? 0),
      0
    );
    return overlayMonthKeys.map((_key, index) => {
      const key = overlayMonthKeys[index];
      const total = overlayReturnMaps.reduce((sum, entry) => {
        const weight = (weights[entry.ticker] ?? 0) / 100;
        const value = entry.map.get(key) ?? 0;
        return sum + weight * value;
      }, 0);
      if (weightTotal <= 0) {
        return total;
      }
      return total / (weightTotal / 100);
    });
  }, [overlayMonthKeys, overlayReturnMaps, weights]);

  const totalWeight = Object.values(weights).reduce((sum, value) => sum + value, 0);
  const portfolioAnnualReturn = computeAnnualizedReturn(portfolioMonthlySeries);
  const portfolioVolatility = computeAnnualizedVolatility(portfolioMonthlySeries);
  const portfolioSharpe =
    portfolioVolatility && portfolioVolatility !== 0
      ? (portfolioAnnualReturn ?? 0) / portfolioVolatility
      : null;

  const weightTotal = overlaySeries.reduce(
    (sum, entry) => sum + (weights[entry.ticker] ?? 0),
    0
  );
  const portfolioSeries = chartYears.map((_year, index) => {
    if (!overlaySeries.length) {
      return 0;
    }
    const total = overlaySeries.reduce((sum, entry) => {
      const weight = (weights[entry.ticker] ?? 0) / 100;
      return sum + weight * (entry.series[index] ?? 0);
    }, 0);
    if (weightTotal <= 0) {
      return total;
    }
    return total / (weightTotal / 100);
  });
  const portfolioAxisValues = [...portfolioSeries, ...benchmarkSeries];
  const portfolioAxis = buildAxis(portfolioAxisValues);
  const benchmarkPoints = buildChartPoints(
    benchmarkSeries,
    CHART_WIDTH,
    CHART_HEIGHT,
    portfolioAxis.min,
    portfolioAxis.max
  );
  const overlayAsOf = useMemo(() => {
    const dates = overlayMetrics
      .map((metrics) => metrics.asOf)
      .concat(benchmarkMetrics?.asOf ?? null)
      .filter(Boolean) as string[];
    if (!dates.length) {
      return null;
    }
    return dates.sort().pop() ?? null;
  }, [overlayMetrics, benchmarkMetrics]);
  const nowAsOf = new Date().toISOString();
  const overlayAsOfDisplay = overlayAsOf ?? nowAsOf;
  const screenerAsOfDisplay = screenerAsOf ?? nowAsOf;
  const fallbackAsOf = overlayAsOf ?? screenerAsOf ?? nowAsOf;
  const snapshotAsOf = activeMetrics?.asOf ?? fallbackAsOf;
  const monthlyAsOf = monthlyMetrics?.asOf ?? fallbackAsOf;
  const optimalAsOf = overlayAsOf ?? screenerAsOf ?? fallbackAsOf;
  const optimalTimeframeLabel =
    optimalStartYear === "inception" ? "Since inception" : `Since ${optimalStartYear}`;

  const handleGenerateOptimal = async () => {
    setOptimalError(null);
    setOptimalWarning(null);
    setOptimalResults(null);
    setOptimalPortfolio(null);
    setOptimalCoverage(null);
    setOptimalLoading(true);
    type OptimalCandidate = {
      ticker: string;
      name: string | null;
      annualReturn: number | null;
      volatility: number | null;
      sharpe: number | null;
      beta: number | null;
      alpha: number | null;
      lastPrice: number | null;
      monthlyMap: Map<string, number>;
    };
    const candidateUniverse = filteredStocks.length ? filteredStocks : universe;
    if (candidateUniverse.length < optimalCount) {
      setOptimalResults([]);
      setOptimalError(
        `Only ${candidateUniverse.length} tickers match your filters. Increase the universe or reduce the lineup size.`
      );
      setOptimalLoading(false);
      return;
    }
    const buildCandidates = (
      source: Record<string, StockMetrics>,
      benchmarkContext: { monthlyMap: Map<string, number> | null; annualReturn: number | null }
    ) => {
      const benchmarkMonthlyMap = benchmarkContext.monthlyMap;
      const benchmarkAnnualReturn = benchmarkContext.annualReturn;
      return candidateUniverse
        .filter((stock) => stock.ticker !== benchmarkTicker)
        .map((stock) => {
          const metrics = source[stock.ticker];
          if (!metrics) {
            return null;
          }
          const monthlyMap = buildMonthlyReturnMap(metrics, optimalStartYearValue);
          const series = extractMonthlySeries(metrics, optimalStartYearValue);
          if (!series.length && optimalStartYearValue !== null) {
            return null;
          }
          const annualReturn = series.length
            ? computeAnnualizedReturn(series)
            : metrics.oneYearReturn ?? metrics.annualReturn;
          if (!monthlyMap.size && annualReturn === null) {
            return null;
          }
          const volatility = series.length ? computeAnnualizedVolatility(series) : null;
          const sharpe =
            annualReturn !== null && volatility ? annualReturn / volatility : null;
          const beta =
            benchmarkMonthlyMap && benchmarkMonthlyMap.size && monthlyMap.size
              ? calculateBetaFromMaps(monthlyMap, benchmarkMonthlyMap)
              : metrics.beta ?? null;
          const alpha =
            benchmarkMonthlyMap && benchmarkMonthlyMap.size && monthlyMap.size
              ? calculateAlphaFromMaps(monthlyMap, benchmarkMonthlyMap)
              : benchmarkAnnualReturn !== null && annualReturn !== null
                ? annualReturn - benchmarkAnnualReturn
                : null;
          return {
            ticker: metrics.ticker,
            name: metrics.name ?? stock.company_name ?? null,
            annualReturn,
            volatility,
            sharpe,
            beta,
            alpha,
            lastPrice: metrics.lastPrice ?? null,
            monthlyMap
          };
        })
        .filter((candidate): candidate is OptimalCandidate => Boolean(candidate));
    };

    let metricsSource: Record<string, StockMetrics> = metricsByTicker;
    const candidateTickers = candidateUniverse
      .map((stock) => stock.ticker)
      .filter((ticker) => ticker !== benchmarkTicker);
    const requiredTickers = new Set([...candidateTickers, benchmarkTicker]);
    let missingTickers = Array.from(requiredTickers).filter(
      (ticker) => !metricsSource[ticker]
    );
    const batchSize = Math.min(80, Math.max(optimalCount * 8, 40));

    const loadTickerMetrics = async (tickers: string[]) => {
      if (!tickers.length) {
        return;
      }
      const stride = Math.ceil(tickers.length / batchSize);
      let remaining = reorderTickersByStride(tickers, stride);
      let attempts = 0;
      const maxAttempts = Math.ceil(remaining.length / batchSize);
      while (remaining.length && attempts < maxAttempts) {
        const batch = remaining.slice(0, batchSize);
        remaining = remaining.slice(batch.length);
        try {
          const response = await fetch(
            `/api/playground/stock?tickers=${encodeURIComponent(
              batch.join(",")
            )}&includeOverview=0&useDaily=0&cacheOnly=1`
          );
          const result = await response.json().catch(() => ({}));
          if (response.ok && result.data) {
            applyMetricsResult(result, {
              overwriteExisting: false,
              suppressErrors: true
            });
            metricsSource = {
              ...metricsSource,
              ...(result.data as Record<string, StockMetrics>)
            };
          }
        } catch (_error) {
          // Skip failed batches so the rest can still load.
        }
        attempts += 1;
      }
    };

    if (missingTickers.length) {
      await loadTickerMetrics(missingTickers);
      missingTickers = Array.from(requiredTickers).filter(
        (ticker) => !metricsSource[ticker]
      );
    }

    const benchmarkSource = metricsSource[benchmarkTicker] ?? benchmarkMetrics ?? null;
    const benchmarkMonthlyMap = benchmarkSource
      ? buildMonthlyReturnMap(benchmarkSource, optimalStartYearValue)
      : null;
    const benchmarkSeries = benchmarkSource
      ? extractMonthlySeries(benchmarkSource, optimalStartYearValue)
      : [];
    const benchmarkAnnualReturn = benchmarkSeries.length
      ? computeAnnualizedReturn(benchmarkSeries)
      : benchmarkSource?.oneYearReturn ?? benchmarkSource?.annualReturn ?? null;
    const benchmarkContext = {
      monthlyMap: benchmarkMonthlyMap,
      annualReturn: benchmarkAnnualReturn
    };

    let candidates = buildCandidates(metricsSource, benchmarkContext);
    const coverage = {
      available: candidates.length,
      total: candidateTickers.length
    };
    setOptimalCoverage(coverage);

    if (!candidates.length) {
      setOptimalResults([]);
      setOptimalError("Market data is not ready yet for the optimal lineup.");
      setOptimalLoading(false);
      return;
    }
    if (candidates.length < optimalCount) {
      setOptimalResults([]);
      setOptimalError(
        `Not enough market data to build a ${optimalCount}-stock lineup. ` +
          "Try again after more tickers are available or broaden your filters."
      );
      setOptimalLoading(false);
      return;
    }

    const candidateByTicker = new Map(
      candidates.map((candidate) => [candidate.ticker, candidate])
    );
    const buildRange = (values: number[]) => {
      if (!values.length) {
        return null;
      }
      return { min: Math.min(...values), max: Math.max(...values) };
    };
    const clampScore = (value: number) => Math.min(1, Math.max(0, value));
    const scaleScore = (
      value: number | null | undefined,
      range: { min: number; max: number } | null
    ) => {
      if (value === null || value === undefined || !range) {
        return null;
      }
      if (range.max === range.min) {
        return 0.5;
      }
      return clampScore((value - range.min) / (range.max - range.min));
    };
    const scaleScoreInverted = (
      value: number | null | undefined,
      range: { min: number; max: number } | null
    ) => {
      const scaled = scaleScore(value, range);
      return scaled === null ? null : 1 - scaled;
    };
    const returnRange = buildRange(
      candidates
        .map((candidate) => candidate.annualReturn)
        .filter((value): value is number => value !== null && value !== undefined)
    );
    const volatilityRange = buildRange(
      candidates
        .map((candidate) => candidate.volatility)
        .filter((value): value is number => value !== null && value !== undefined)
    );
    const sharpeRange = buildRange(
      candidates
        .map((candidate) => candidate.sharpe)
        .filter((value): value is number => value !== null && value !== undefined)
    );
    const betaDeviationMax = (() => {
      const values = candidates
        .map((candidate) => candidate.beta)
        .filter((value): value is number => value !== null && value !== undefined);
      if (!values.length) {
        return null;
      }
      return Math.max(...values.map((value) => Math.abs(value - 1)));
    })();
    const scoreBetaBalance = (value: number | null | undefined) => {
      if (value === null || value === undefined) {
        return null;
      }
      if (!betaDeviationMax || betaDeviationMax === 0) {
        return 1;
      }
      return 1 - Math.min(1, Math.abs(value - 1) / betaDeviationMax);
    };
    const getPortfolioMetrics = (tickers: string[]) => {
      const entries = tickers
        .map((ticker) => candidateByTicker.get(ticker))
        .filter(Boolean) as OptimalCandidate[];
      if (!entries.length) {
        return {
          annualReturn: null,
          volatility: null,
          sharpe: null,
          beta: null,
          alpha: null
        };
      }
      let commonKeys = Array.from(entries[0].monthlyMap.keys());
      entries.slice(1).forEach((entry) => {
        const entryKeys = new Set(entry.monthlyMap.keys());
        commonKeys = commonKeys.filter((key) => entryKeys.has(key));
      });
      let annualReturn: number | null = null;
      let volatility: number | null = null;
      let portfolioMonthlyMap: Map<string, number> | null = null;
      if (commonKeys.length) {
        const monthlyReturns = commonKeys.map((key) => {
          const total = entries.reduce((sum, entry) => {
            const value = entry.monthlyMap.get(key);
            return sum + (value ?? 0);
          }, 0);
          return total / entries.length;
        });
        annualReturn = computeAnnualizedReturn(monthlyReturns);
        volatility = computeAnnualizedVolatility(monthlyReturns);
        portfolioMonthlyMap = new Map(
          commonKeys.map((key, index) => [key, monthlyReturns[index] ?? 0])
        );
      } else {
        const returnValues = entries
          .map((entry) => entry.annualReturn)
          .filter((value): value is number => value !== null && value !== undefined);
        const volValues = entries
          .map((entry) => entry.volatility)
          .filter((value): value is number => value !== null && value !== undefined);
        annualReturn = returnValues.length ? mean(returnValues) : null;
        volatility = volValues.length ? mean(volValues) : null;
      }
      const sharpe =
        annualReturn !== null && volatility ? annualReturn / volatility : null;
      const betaValues = entries
        .map((entry) => entry.beta)
        .filter((value): value is number => value !== null && value !== undefined);
      const beta = betaValues.length
        ? betaValues.reduce((sum, value) => sum + value, 0) / betaValues.length
        : null;
      let alpha: number | null = null;
      if (
        benchmarkContext.monthlyMap &&
        benchmarkContext.monthlyMap.size &&
        portfolioMonthlyMap &&
        portfolioMonthlyMap.size
      ) {
        alpha = calculateAlphaFromMaps(portfolioMonthlyMap, benchmarkContext.monthlyMap);
      } else if (benchmarkContext.annualReturn !== null && annualReturn !== null) {
        alpha = annualReturn - benchmarkContext.annualReturn;
      }
      return { annualReturn, volatility, sharpe, beta, alpha };
    };
    const scoreCandidate = (candidate: OptimalCandidate) => {
      if (optimalObjective === "sharpe") {
        return candidate.sharpe ?? -Infinity;
      }
      if (optimalObjective === "return") {
        return candidate.annualReturn ?? -Infinity;
      }
      if (optimalObjective === "alpha") {
        return candidate.alpha ?? -Infinity;
      }
      if (optimalObjective === "volatility") {
        return candidate.volatility === null || candidate.volatility === undefined
          ? -Infinity
          : -candidate.volatility;
      }
      if (optimalObjective === "beta_high") {
        return candidate.beta === null || candidate.beta === undefined
          ? -Infinity
          : candidate.beta;
      }
      if (optimalObjective === "beta_low") {
        return candidate.beta === null || candidate.beta === undefined
          ? -Infinity
          : -candidate.beta;
      }
      if (optimalObjective === "balanced") {
        const scores = [
          scaleScore(candidate.annualReturn, returnRange),
          scaleScore(candidate.sharpe, sharpeRange),
          scaleScoreInverted(candidate.volatility, volatilityRange),
          scoreBetaBalance(candidate.beta)
        ].filter((value): value is number => value !== null);
        if (!scores.length) {
          return -Infinity;
        }
        return scores.reduce((sum, value) => sum + value, 0) / scores.length;
      }
      return -Infinity;
    };

    const rankedCandidates = candidates
      .map((candidate) => ({
        ...candidate,
        score: scoreCandidate(candidate)
      }))
      .filter((candidate) => Number.isFinite(candidate.score));

    rankedCandidates.sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      const returnDiff =
        (right.annualReturn ?? Number.NEGATIVE_INFINITY) -
        (left.annualReturn ?? Number.NEGATIVE_INFINITY);
      if (returnDiff !== 0) {
        return returnDiff;
      }
      const sharpeDiff =
        (right.sharpe ?? Number.NEGATIVE_INFINITY) -
        (left.sharpe ?? Number.NEGATIVE_INFINITY);
      if (sharpeDiff !== 0) {
        return sharpeDiff;
      }
      return left.ticker.localeCompare(right.ticker);
    });

    const selected = rankedCandidates.slice(0, optimalCount);
    if (selected.length < optimalCount) {
      setOptimalResults([]);
      setOptimalWarning(null);
      setOptimalError(
        "Not enough tickers have data for the selected objective. Try again shortly or broaden your filters."
      );
      setOptimalLoading(false);
      return;
    }

    const selectedTickers = selected.map((candidate) => candidate.ticker);
    setOptimalPortfolio(getPortfolioMetrics(selectedTickers));
    setOptimalResults(
      selected.map((candidate) => ({
        ticker: candidate.ticker,
        name: candidate.name,
        annualReturn: candidate.annualReturn,
        volatility: candidate.volatility,
        sharpe: candidate.sharpe,
        beta: candidate.beta,
        alpha: candidate.alpha,
        lastPrice: candidate.lastPrice ?? null,
        score: candidate.score
      }))
    );
    setOptimalLoading(false);
  };

  return (
    <main className="px-6 py-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="rounded-3xl border border-amber-200/70 bg-white/90 p-4 shadow-[0_20px_60px_rgba(20,20,20,0.12)]">
          <div className="flex flex-col items-center gap-3 text-center md:flex-row md:items-center md:text-left">
            <LogoMark size={44} />
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.35em] text-navy">
                Playground
              </p>
              <h1 className="mt-1 font-display text-3xl text-ink">
                Research the Market
              </h1>
              <p className="mt-1 text-sm text-steel">
                Explore the full S&amp;P 500 universe, compare performance, and build
                a hypothetical lineup.
              </p>
            </div>
          </div>
        </header>

        {showTrackRecord ? (
          <section
            id="track-record"
            className="relative rounded-2xl border border-amber-100 bg-paper p-6 pr-24 sm:pr-32 lg:pr-40"
          >
          {monthlyTicker ? (
            <a
              href={`?view=snapshot&ticker=${encodeURIComponent(monthlyTicker)}#company-snapshot`}
              className="absolute right-6 top-6 inline-flex"
            >
              <CompanyLogo ticker={monthlyTicker} size={104} />
            </a>
          ) : null}
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h2 className="font-display text-2xl text-ink">Monthly Track Record</h2>
              <p className="mt-1 text-sm text-steel">
                Actual monthly returns by year for your selected ticker.
              </p>
              <p className="mt-2 text-xs uppercase tracking-[0.2em] text-steel">
                As of {formatAsOf(monthlyAsOf)}
              </p>
              <p className="mt-2 text-xs uppercase tracking-[0.2em] text-steel">
                Returns exclude dividends
              </p>
            </div>
            {monthlyTicker ? (
              <div className="flex flex-wrap gap-2 lg:justify-end">
                <button
                  type="button"
                  onClick={() => {
                    if (!monthlyTicker) {
                      return;
                    }
                    setWatchlist(
                      toggleWatchlistItem({
                        ticker: monthlyTicker,
                        company_name: monthlyStock?.company_name ?? null,
                        sector: monthlyStock?.sector ?? null,
                        industry: monthlyStock?.industry ?? null
                      })
                    );
                  }}
                  className="rounded-full border border-navy/20 bg-white px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-navy shadow-sm shadow-navy/10 transition hover:border-navy hover:bg-navy-soft hover:text-white"
                >
                  {monthlyInWatchlist ? "In watchlist" : "Add to watchlist"}
                </button>
                <button
                  type="button"
                  disabled={!monthlyTicker || monthlyInOverlay}
                  onClick={() => {
                    if (!monthlyTicker || monthlyInOverlay) {
                      return;
                    }
                    applySelectionUpdate((current) =>
                      current.includes(monthlyTicker)
                        ? current
                        : [...current, monthlyTicker]
                    );
                  }}
                  className="rounded-full border border-navy/20 bg-white px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-navy shadow-sm shadow-navy/10 transition hover:border-navy hover:bg-navy-soft hover:text-white disabled:cursor-not-allowed disabled:border-navy/10 disabled:text-navy/40"
                >
                  {monthlyInOverlay ? "IN OVERLAY CHART" : "ADD TO OVERLAY CHART"}
                </button>
              </div>
            ) : null}
            <div className="flex w-full max-w-2xl flex-col gap-3 sm:flex-row sm:items-end">
              <div className="relative w-full sm:flex-1">
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-steel">
                  Ticker / Company
                <input
                  className="mt-2 w-full rounded-xl border border-amber-100 bg-white px-4 py-3 text-sm"
                  placeholder="Search a ticker or company"
                  value={monthlyQuery}
                  onChange={(event) => {
                    const value = event.target.value;
                    setMonthlyQuery(value);
                    monthlyScrollTopRef.current = 0;
                    setMonthlyTicker("");
                    setMonthlyOpen(true);
                  }}
                  onFocus={(event) => {
                    event.target.select();
                    setMonthlyOpen(true);
                  }}
                  onBlur={() => {
                    setTimeout(() => setMonthlyOpen(false), 120);
                  }}
                  onClick={(event) => {
                    event.currentTarget.select();
                    setMonthlyOpen(true);
                  }}
                />
              </label>
              {monthlyOpen && monthlyOptions.length ? (
                <div
                  ref={monthlyListRef}
                  className="absolute z-10 mt-2 max-h-64 w-full overflow-y-auto rounded-xl border border-amber-100 bg-white text-sm text-steel shadow-lg"
                  onMouseDown={(event) => event.preventDefault()}
                  onScroll={(event) => {
                    monthlyScrollTopRef.current = event.currentTarget.scrollTop;
                  }}
                >
                  {monthlyOptions.map((option) => (
                    <button
                      key={option.ticker}
                      data-ticker={option.ticker}
                      type="button"
                      className="flex w-full items-center justify-between px-4 py-2 text-left hover:bg-amber-50"
                      onClick={() => {
                        handleSelectMonthly(option);
                        setMonthlyOpen(false);
                      }}
                    >
                      <span className="flex items-center gap-2">
                        <span className="font-semibold text-ink">{option.ticker}</span>
                        <TickerNewsButton
                          ticker={option.ticker}
                          className="h-4 w-4"
                          as="span"
                        />
                      </span>
                      <span className="text-xs text-steel">
                        {option.company_name ?? option.sector ?? "S&P 500"}
                      </span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              <label className="text-xs font-semibold uppercase tracking-[0.2em] text-steel sm:w-48">
                Start year
                <select
                  className="mt-2 w-full rounded-xl border border-amber-100 bg-white px-4 py-3 text-sm"
                  value={monthlyStartYear}
                  onChange={(event) => setMonthlyStartYear(event.target.value)}
                >
                  <option value="inception">Since inception</option>
                  {monthlyYearOptions.map((year) => (
                    <option key={year} value={year}>
                      {year}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-amber-100 bg-white px-4 py-3 text-sm text-steel">
              <p className="text-xs uppercase tracking-[0.2em] text-steel">Last price</p>
              <p className="mt-1 font-semibold text-ink">
                {formatPrice(monthlyMetrics?.lastPrice ?? null)}
              </p>
            </div>
            <div className="rounded-xl border border-amber-100 bg-white px-4 py-3 text-sm text-steel">
              <p className="text-xs uppercase tracking-[0.2em] text-steel">Annualized return</p>
              <p className="mt-1 font-semibold text-ink">
                {formatPercent(monthlyAnnualized.annualReturn)}
              </p>
            </div>
            <div className="rounded-xl border border-amber-100 bg-white px-4 py-3 text-sm text-steel">
              <p className="text-xs uppercase tracking-[0.2em] text-steel">
                Annualized volatility
              </p>
              <p className="mt-1 font-semibold text-ink">
                {monthlyAnnualized.annualVolatility === null
                  ? "—"
                  : formatPercent(monthlyAnnualized.annualVolatility)}
              </p>
            </div>
            <div className="rounded-xl border border-amber-100 bg-white px-4 py-3 text-sm text-steel">
              <p className="text-xs uppercase tracking-[0.2em] text-steel">Win month %</p>
              <p className="mt-1 font-semibold text-ink">
                {formatPercent(monthlyWinLoss.winPct)}
              </p>
            </div>
            <div className="rounded-xl border border-amber-100 bg-white px-4 py-3 text-sm text-steel">
              <p className="text-xs uppercase tracking-[0.2em] text-steel">Loss month %</p>
              <p className="mt-1 font-semibold text-ink">
                {formatPercent(monthlyWinLoss.lossPct)}
              </p>
            </div>
          </div>
          <div className="mt-5 rounded-xl border border-amber-100 bg-white">
            <table className="w-full table-fixed text-[11px] text-steel">
              <thead className="border-b border-amber-100 bg-amber-50/60">
                <tr>
                  <th className="bg-slate-200/70 px-2 py-2 text-center font-semibold uppercase tracking-[0.2em] text-ink">
                    Year
                  </th>
                  {MONTH_LABELS.map((label) => (
                    <th
                      key={label}
                      className="px-1 py-2 text-center font-semibold uppercase tracking-[0.2em] text-ink"
                    >
                      {label}
                    </th>
                  ))}
                  <th className="bg-slate-200/70 px-2 py-2 text-center font-semibold uppercase tracking-[0.2em] text-ink">
                    YTD
                  </th>
                </tr>
              </thead>
              <tbody>
                {monthlyRows.length ? (
                  monthlyRows.map((yearRow) => {
                    const hasValues = yearRow.months.some(
                      (value) => value !== null && value !== undefined
                    );
                    const ytd = yearRow.months.reduce((acc, value) => {
                      if (value === null || value === undefined) {
                        return acc;
                      }
                      return acc * (1 + value);
                    }, 1);
                    const ytdValue = hasValues ? ytd - 1 : null;
                    return (
                      <tr key={yearRow.year} className="border-b border-amber-50">
                        <td className="bg-slate-100/70 px-2 py-2 text-center font-semibold text-ink">
                          {yearRow.year}
                        </td>
                        {yearRow.months.map((value, index) => {
                          const toneClass = value === null ? "text-steel" : "text-ink";
                          const toneStyle =
                            value === null
                              ? undefined
                              : value > 0
                                ? { color: "#22c55e" }
                                : value < 0
                                  ? { color: "#dc2626" }
                                  : undefined;
                          return (
                            <td
                              key={`${yearRow.year}-${index}`}
                              className={`px-1 py-2 text-center ${toneClass}`}
                              style={toneStyle}
                            >
                              {formatPercent(value)}
                            </td>
                          );
                        })}
                        <td
                          className={`bg-slate-100/70 px-2 py-2 text-center font-semibold ${
                            ytdValue === null ? "text-steel" : "text-ink"
                          }`}
                          style={
                            ytdValue === null
                              ? undefined
                              : ytdValue > 0
                                ? { color: "#22c55e" }
                                : ytdValue < 0
                                  ? { color: "#dc2626" }
                                  : undefined
                          }
                        >
                          {formatPercent(ytdValue)}
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={14} className="px-3 py-6 text-center text-xs text-steel">
                      {metricsError
                        ? metricsError
                        : monthlyError
                          ? monthlyError
                          : monthlyTicker
                            ? monthlyHasData
                              ? "No data for the selected start year."
                              : "Loading monthly returns..."
                            : "Select a ticker to load monthly returns."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          </section>
        ) : null}

        {showOptimalSection || showOverlaySection ? (
          <section
            className={`grid items-start gap-6 ${
              showDualPanels ? "lg:grid-cols-2" : ""
            }`}
          >
            {showOptimalSection ? (
              <section
                id="optimal-lineup"
                className="rounded-2xl border border-amber-100 bg-paper p-6"
              >
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="font-display text-2xl text-ink">Optimal Lineup</h2>
                <p className="mt-1 text-sm text-steel">
                  Build a best-in-class hypothetical lineup based on your chosen objective.
                </p>
                <p className="mt-2 text-xs uppercase tracking-[0.2em] text-steel">
                  As of {formatAsOf(optimalAsOf)}
                </p>
                <p className="mt-2 text-xs uppercase tracking-[0.2em] text-steel">
                  Timeframe: {optimalTimeframeLabel}
                </p>
                <p className="mt-2 text-xs uppercase tracking-[0.2em] text-steel">
                  Uses loaded metrics and active screener filters
                </p>
                <p className="mt-2 text-xs text-steel">
                  Optimal lineups assume equal weights by default.
                </p>
                {optimalCoverage ? (
                  <p className="mt-2 text-xs uppercase tracking-[0.2em] text-steel">
                    Coverage: {optimalCoverage.available} / {optimalCoverage.total} tickers
                  </p>
                ) : null}
                {optimalWarning ? (
                  <p className="mt-2 text-xs text-amber-700">{optimalWarning}</p>
                ) : null}
              </div>
            </div>
            <div className="mt-4 flex flex-wrap items-end gap-3">
              <label className="text-[10px] font-semibold uppercase tracking-[0.2em] text-steel">
                Objective
                <select
                  className="mt-2 w-full min-w-[160px] rounded-xl border border-amber-100 bg-white px-3 py-2 text-xs"
                  value={optimalObjective}
                  onChange={(event) => setOptimalObjective(event.target.value)}
                >
                  <option value="balanced">Best objective</option>
                  <option value="sharpe">Sharpe ratio</option>
                  <option value="return">Annual return</option>
                  <option value="alpha">Highest alpha</option>
                  <option value="beta_high">Highest beta</option>
                  <option value="beta_low">Lowest beta</option>
                  <option value="volatility">Lowest volatility</option>
                </select>
              </label>
              <label className="text-[10px] font-semibold uppercase tracking-[0.2em] text-steel">
                Timeframe
                <select
                  className="mt-2 w-full min-w-[140px] rounded-xl border border-amber-100 bg-white px-3 py-2 text-xs"
                  value={optimalStartYear}
                  onChange={(event) => setOptimalStartYear(event.target.value)}
                >
                  <option value="inception">Since inception</option>
                  {optimalYearOptions.map((year) => (
                    <option key={year} value={year}>
                      {year}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-[10px] font-semibold uppercase tracking-[0.2em] text-steel">
                Number of stocks
                <select
                  className="mt-2 w-full min-w-[120px] rounded-xl border border-amber-100 bg-white px-3 py-2 text-xs"
                  value={optimalCount}
                  onChange={(event) => setOptimalCount(Number(event.target.value))}
                >
                  {[3, 4, 5, 6, 7, 8, 9, 10].map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                onClick={handleGenerateOptimal}
                disabled={optimalLoading}
                className="rounded-full border border-navy/30 bg-white px-4 py-2 text-xs font-semibold text-navy shadow-sm shadow-navy/10 transition hover:border-navy hover:bg-navy hover:text-white focus-visible:border-navy focus-visible:bg-navy focus-visible:text-white active:bg-navy active:text-white disabled:cursor-wait disabled:border-navy/10 disabled:text-navy/40 disabled:hover:text-ink"
              >
                {optimalLoading ? "Generating..." : "Generate"}
              </button>
              <button
                type="button"
                disabled={!optimalResults?.length}
                onClick={() => {
                  if (!optimalResults?.length) {
                    return;
                  }
                  applySelection(optimalResults.map((item) => item.ticker));
                  setOverlayOpen(false);
                }}
                className="rounded-full border border-navy/30 bg-white px-4 py-2 text-xs font-semibold text-navy shadow-sm shadow-navy/10 transition hover:border-navy hover:bg-navy hover:text-white focus-visible:border-navy focus-visible:bg-navy focus-visible:text-white active:bg-navy active:text-white disabled:cursor-not-allowed disabled:border-navy/10 disabled:text-navy/40"
              >
                Add to overlay chart
              </button>
            </div>
            {optimalPortfolio ? (
              <div className="mt-4 grid gap-3 text-sm text-steel sm:grid-cols-5">
                <div className="rounded-xl border border-amber-100 bg-white px-4 py-3">
                  <p className="text-[10px] uppercase tracking-[0.2em] text-steel leading-snug">
                    <span className="block whitespace-nowrap">Portfolio</span>
                    <span className="block whitespace-nowrap">Return</span>
                  </p>
                  <p className="mt-1 font-semibold text-ink">
                    {formatPercent(optimalPortfolio.annualReturn)}
                  </p>
                </div>
                <div className="rounded-xl border border-amber-100 bg-white px-4 py-3">
                  <p className="text-[10px] uppercase tracking-[0.2em] text-steel leading-snug">
                    <span className="block whitespace-nowrap">Portfolio</span>
                    <span className="block whitespace-nowrap">Volatility</span>
                  </p>
                  <p className="mt-1 font-semibold text-ink">
                    {formatPercent(optimalPortfolio.volatility)}
                  </p>
                </div>
                <div className="rounded-xl border border-amber-100 bg-white px-4 py-3">
                  <p className="text-[10px] uppercase tracking-[0.2em] text-steel leading-snug">
                    <span className="block whitespace-nowrap">Portfolio</span>
                    <span className="block whitespace-nowrap">Sharpe</span>
                  </p>
                  <p className="mt-1 font-semibold text-ink">
                    {formatRatio(optimalPortfolio.sharpe)}
                  </p>
                </div>
                <div className="rounded-xl border border-amber-100 bg-white px-4 py-3">
                  <p className="text-[10px] uppercase tracking-[0.2em] text-steel leading-snug">
                    <span className="block whitespace-nowrap">Portfolio</span>
                    <span className="block whitespace-nowrap">Beta</span>
                  </p>
                  <p className="mt-1 font-semibold text-ink">
                    {formatNumber(optimalPortfolio.beta)}
                  </p>
                </div>
                <div className="rounded-xl border border-amber-100 bg-white px-4 py-3">
                  <p className="text-[10px] uppercase tracking-[0.2em] text-steel leading-snug">
                    <span className="block whitespace-nowrap">Portfolio</span>
                    <span className="block whitespace-nowrap">Alpha</span>
                  </p>
                  <p className="mt-1 font-semibold text-ink">
                    {formatPercent(optimalPortfolio.alpha)}
                  </p>
                </div>
              </div>
            ) : null}
            {optimalError ? (
              <div className="mt-4 rounded-2xl border border-amber-100 bg-white px-4 py-4 text-sm text-red-600">
                {optimalError}
              </div>
            ) : optimalResults && optimalResults.length ? (
              <div className="mt-4 rounded-2xl border border-amber-100 bg-white">
                <div className="min-w-0">
                  <div className="grid grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)_minmax(0,0.5fr)_repeat(5,minmax(0,1fr))] gap-3 border-b border-amber-100 px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-steel">
                    <span>Ticker</span>
                    <span className="text-center">Last price</span>
                    <span className="text-center">News</span>
                    <span className="text-center">Annual return</span>
                    <span className="text-center">Volatility</span>
                    <span className="text-center">Sharpe</span>
                    <span className="text-center">Beta</span>
                    <span className="text-center">Alpha</span>
                  </div>
                  {optimalResults.map((result) => (
                    <div
                      key={result.ticker}
                      className="grid grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)_minmax(0,0.5fr)_repeat(5,minmax(0,1fr))] items-center gap-3 border-b border-amber-50 px-4 py-3 text-sm text-steel"
                    >
                      <div className="flex items-center gap-2 font-semibold text-ink">
                        <span>{result.ticker}</span>
                      </div>
                      <div className="text-center">{formatPrice(result.lastPrice)}</div>
                      <div className="flex items-center justify-center">
                        <TickerNewsButton ticker={result.ticker} className="h-4 w-4" />
                      </div>
                      <div className="text-center">{formatPercent(result.annualReturn)}</div>
                      <div className="text-center">{formatPercent(result.volatility)}</div>
                      <div className="text-center">{formatRatio(result.sharpe)}</div>
                      <div className="text-center">
                        {result.beta === null || result.beta === undefined
                          ? "—"
                          : result.beta.toFixed(2)}
                      </div>
                      <div className="text-center">{formatPercent(result.alpha)}</div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="mt-4 rounded-2xl border border-amber-100 bg-white px-4 py-4 text-sm text-steel">
                Choose an objective and generate an optimal lineup.
              </div>
            )}
              </section>
            ) : null}

            {showOverlaySection ? (
              <section
                id="overlay-chart"
                className="rounded-2xl border border-amber-100 bg-paper p-6 self-start"
              >
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-display text-2xl text-ink">Overlay Chart</h2>
            </div>
            <p className="mt-1 text-sm text-steel">
              Compare multiple tickers on the same trendline.
            </p>
            <p className="mt-2 text-xs uppercase tracking-[0.2em] text-steel">
              As of {formatAsOf(overlayAsOfDisplay)}
            </p>
            <p className="mt-2 text-xs uppercase tracking-[0.2em] text-steel">
              Returns exclude dividends
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <label className="text-[10px] font-semibold uppercase tracking-[0.2em] text-steel">
                Start year
                <select
                  className="mt-2 w-full min-w-[140px] rounded-xl border border-amber-100 bg-white px-3 py-2 text-xs"
                  value={overlayStartYear}
                  onChange={(event) => setOverlayStartYear(event.target.value)}
                >
                  <option value="inception">Since inception</option>
                  {overlayYearOptions.map((year) => (
                    <option key={year} value={year}>
                      {year}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                onClick={() => setOverlayOpen((value) => !value)}
                className="rounded-full border border-navy/30 bg-white px-4 py-2 text-xs font-semibold text-navy shadow-sm shadow-navy/10 transition hover:border-navy hover:bg-navy-soft hover:text-white"
              >
                {overlayOpen ? "Close selector" : "Add tickers"}
              </button>
              <button
                type="button"
                onClick={() => setOverlayHideStocks((value) => !value)}
                disabled={!overlayTickers.length}
                className="rounded-full border border-navy/30 bg-white px-4 py-2 text-xs font-semibold text-navy shadow-sm shadow-navy/10 transition hover:border-navy hover:bg-navy-soft hover:text-white disabled:cursor-not-allowed disabled:border-navy/10 disabled:text-navy/30"
              >
                {overlayHideStocks ? "Unhide stocks" : "Hide stocks"}
              </button>
              <button
                type="button"
                onClick={handleUndoSelection}
                disabled={!undoStack.length}
                className="rounded-full border border-navy/30 bg-white px-4 py-2 text-xs font-semibold text-navy shadow-sm shadow-navy/10 transition hover:border-navy hover:bg-navy-soft hover:text-white disabled:cursor-not-allowed disabled:border-navy/10 disabled:text-navy/30"
              >
                Undo
              </button>
              <button
                type="button"
                onClick={() => {
                  applySelection([]);
                  setOverlayQuery("");
                }}
                disabled={!selectedTickers.length}
                className="rounded-full border border-navy/30 bg-white px-4 py-2 text-xs font-semibold text-navy shadow-sm shadow-navy/10 transition hover:border-navy hover:bg-navy-soft hover:text-white disabled:cursor-not-allowed disabled:border-navy/10 disabled:text-navy/30"
              >
                Clear tickers
              </button>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-steel">
              {chartYears.length >= 2 ? (
                <span className="flex items-center gap-2">
                  <span className="flex items-center gap-1">
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: PORTFOLIO_COLOR }}
                    />
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: PORTFOLIO_COLOR }}
                    />
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: PORTFOLIO_COLOR }}
                    />
                  </span>
                  Hypothetical portfolio
                </span>
              ) : null}
              {benchmarkSeries.length ? (
                <span className="flex items-center gap-2">
                  <span
                    className="h-2.5 w-2.5"
                    style={{ backgroundColor: BENCHMARK_COLOR }}
                  />
                  S&amp;P 500 benchmark
                </span>
              ) : null}
              {overlayTickers.length ? (
                overlayHideStocks ? (
                  <span>Stocks hidden.</span>
                ) : (
                  overlayTickers.map((ticker, index) => (
                    <span key={ticker} className="flex items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: COLORS[index % COLORS.length] }}
                      />
                      <span className="font-semibold text-ink">{ticker}</span>
                      <TickerNewsButton ticker={ticker} className="h-4 w-4" />
                    </span>
                  ))
                )
              ) : (
                <span>No tickers selected yet.</span>
              )}
            </div>
            {overlayOpen ? (
              <div className="mt-4 rounded-2xl border border-amber-100 bg-white p-4">
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-steel">
                  Search tickers
                  <input
                    className="mt-2 w-full rounded-xl border border-amber-100 bg-white px-3 py-2 text-sm"
                    placeholder="Type a ticker or company"
                    value={overlayQuery}
                    onChange={(event) => setOverlayQuery(event.target.value)}
                  />
                </label>
                <div className="mt-3 max-h-72 overflow-y-auto text-sm text-steel">
                  {overlayOptions.map((stock) => {
                    const isSelected = selectedTickers.includes(stock.ticker);
                    const isBenchmark = stock.ticker === benchmarkTicker;
                    return (
                      <label
                        key={stock.ticker}
                        className="flex items-center justify-between gap-3 rounded-lg px-2 py-2 hover:bg-amber-50"
                      >
                        <span className="flex items-center gap-3">
                          <input
                            type="checkbox"
                            checked={isBenchmark ? false : isSelected}
                            disabled={isBenchmark}
                            className={isBenchmark ? "cursor-not-allowed opacity-40" : ""}
                            onChange={() =>
                              isBenchmark
                                ? null
                                : applySelectionUpdate((current) =>
                                    current.includes(stock.ticker)
                                      ? current.filter((item) => item !== stock.ticker)
                                      : [...current, stock.ticker]
                                  )
                            }
                          />
                          <span className="flex items-center gap-2">
                            <span className="font-semibold text-ink">
                              {stock.ticker}
                            </span>
                            <TickerNewsButton
                              ticker={stock.ticker}
                              className="h-4 w-4"
                            />
                          </span>
                          <span className="text-xs text-steel">
                            {stock.company_name ?? stock.sector ?? "S&P 500"}
                          </span>
                        </span>
                        <span className="text-xs text-steel">
                          {isBenchmark ? "" : stock.sector ?? ""}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            ) : null}
            <div className="mt-4 rounded-2xl border border-amber-100 bg-white p-4">
              {chartYears.length >= 2 ? (
                <svg
                  viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
                  className="h-80 w-full overflow-visible"
                  overflow="visible"
                >
                      <text
                        x="8"
                        y="14"
                        className="text-[10px] font-semibold fill-slate-500"
                      >
                        Return (%)
                      </text>
                      <text
                        x="412"
                        y="14"
                        className="text-[10px] font-semibold fill-slate-500"
                        textAnchor="end"
                      >
                        Portfolio/BM (%)
                      </text>
                      {chartYears.map((year, index) => {
                        const x =
                          CHART_PADDING +
                          (index * (CHART_WIDTH - CHART_PADDING * 2)) /
                            (chartYears.length - 1);
                        const labelY = CHART_HEIGHT - CHART_PADDING + CHART_LABEL_OFFSET;
                        return (
                          <text
                            key={year}
                            x={x}
                            y={labelY}
                            className="text-[10px] font-semibold fill-slate-500"
                            textAnchor="end"
                            transform={`rotate(-90 ${x} ${labelY})`}
                          >
                            {chartYearLabels[index]}
                          </text>
                        );
                      })}
                      {leftAxis.ticks.map((value) => {
                        const y =
                          CHART_HEIGHT -
                          CHART_PADDING -
                          ((value - leftAxis.min) / (leftAxis.max - leftAxis.min || 1)) *
                            (CHART_HEIGHT - CHART_PADDING * 2);
                        return (
                          <g key={value}>
                            <line
                              x1={CHART_PADDING}
                              x2={CHART_WIDTH - CHART_PADDING}
                              y1={y}
                              y2={y}
                              stroke="#e2e8f0"
                              strokeWidth="1"
                            />
                            <text
                              x="6"
                              y={y + 4}
                              className="text-[10px] font-semibold fill-slate-500"
                            >
                              {formatAxisPercent(value)}
                            </text>
                          </g>
                        );
                      })}
                      {portfolioAxis.ticks.map((value) => {
                        const y =
                          CHART_HEIGHT -
                          CHART_PADDING -
                          ((value - portfolioAxis.min) /
                            (portfolioAxis.max - portfolioAxis.min || 1)) *
                            (CHART_HEIGHT - CHART_PADDING * 2);
                        return (
                          <text
                            key={`portfolio-${value}`}
                            x="414"
                            y={y + 4}
                            className="text-[10px] font-semibold fill-slate-500"
                            textAnchor="start"
                          >
                            {formatAxisPercent(value)}
                          </text>
                        );
                      })}
                      {visibleSeries.map((series, index) => {
                        const path = buildLinePath(
                          series,
                          CHART_WIDTH,
                          CHART_HEIGHT,
                          leftAxis.min,
                          leftAxis.max
                        );
                        return (
                          <path
                            key={`line-${index}`}
                            d={path}
                            fill="none"
                            stroke={COLORS[index % COLORS.length]}
                            strokeWidth="3"
                            strokeLinecap="round"
                          />
                        );
                      })}
                      {portfolioSeries.length ? (
                        <path
                          d={buildLinePath(
                            portfolioSeries,
                            CHART_WIDTH,
                            CHART_HEIGHT,
                            portfolioAxis.min,
                            portfolioAxis.max
                          )}
                          fill="none"
                          stroke={PORTFOLIO_COLOR}
                          strokeDasharray="2 6"
                          strokeWidth="2"
                          strokeLinecap="round"
                        />
                      ) : null}
                      {benchmarkSeries.length ? (
                        <path
                          d={buildLinePath(
                            benchmarkSeries,
                            CHART_WIDTH,
                            CHART_HEIGHT,
                            portfolioAxis.min,
                            portfolioAxis.max
                          )}
                          fill="none"
                          stroke={BENCHMARK_COLOR}
                          strokeWidth="2"
                          strokeLinecap="round"
                        />
                      ) : null}
                      {benchmarkPoints.length
                        ? benchmarkPoints.map((point, index) => (
                            <rect
                              key={`benchmark-point-${index}`}
                              x={point.x - 2.5}
                              y={point.y - 2.5}
                              width="5"
                              height="5"
                              fill={BENCHMARK_COLOR}
                              stroke="#f8fafc"
                              strokeWidth="1"
                            />
                          ))
                        : null}
                    </svg>
                  ) : (
                    <div className="py-10 text-center text-sm text-steel">
                      Select at least two tickers to compare yearly returns.
                    </div>
                  )}
                </div>
                <div className="mt-4 rounded-2xl border border-amber-100 bg-white px-4 py-3 text-sm text-steel">
                  <div className="flex flex-wrap items-center gap-3">
                    {overlayTickers.map((ticker) => (
                      <div key={ticker} className="flex items-center gap-2">
                        <span className="font-semibold text-ink">{ticker}</span>
                        <TickerNewsButton ticker={ticker} className="h-4 w-4" />
                        <input
                          type="text"
                          inputMode="decimal"
                          value={weightInputs[ticker] ?? formatWeightInput(weights[ticker] ?? 0)}
                          onChange={(event) => {
                            const raw = event.target.value;
                            setWeightInputs((current) => ({ ...current, [ticker]: raw }));
                            const parsed = parseWeightInput(raw);
                            setWeights((current) => ({
                              ...current,
                              [ticker]: parsed
                            }));
                          }}
                          onFocus={() => setActiveWeightTicker(ticker)}
                          onBlur={(event) => {
                            const parsed = parseWeightInput(event.target.value);
                            setActiveWeightTicker(null);
                            setWeightInputs((current) => ({
                              ...current,
                              [ticker]: formatWeightInput(parsed)
                            }));
                          }}
                          className="w-20 rounded-xl border border-amber-100 bg-white px-2 py-1 text-right text-xs"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            applySelectionUpdate((current) =>
                              current.filter((item) => item !== ticker)
                            )
                          }
                          className="text-xs font-semibold text-red-600 transition hover:text-red-700"
                          aria-label={`Remove ${ticker}`}
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-steel">
                  <p className="whitespace-nowrap">
                    Total weight: <span className="font-semibold text-ink">{totalWeight}%</span>
                  </p>
                  <p className="whitespace-nowrap">
                    Annual Return:{" "}
                    <span className="font-semibold text-ink">
                      {formatPercent(portfolioAnnualReturn)}
                    </span>
                  </p>
                  <p className="flex flex-wrap items-center gap-2 whitespace-nowrap">
                    <span>
                      Annual Volatility:{" "}
                      <span className="font-semibold text-ink">
                        {portfolioVolatility === null
                          ? "—"
                          : formatPercent(portfolioVolatility)}
                      </span>
                    </span>
                    <span className="text-steel/70">•</span>
                    <span>
                      Sharpe Ratio:{" "}
                      <span className="font-semibold text-ink">
                        {formatRatio(portfolioSharpe)}
                      </span>
                    </span>
                  </p>
                </div>
                <div className="mt-3 flex flex-col gap-3 text-xs text-steel sm:flex-row sm:items-start sm:justify-between">
                  <p className="max-w-md leading-relaxed">
                    Sharpe ratios above 1.0 generally signal better risk-adjusted performance for
                    the hypothetical portfolio.
                  </p>
                  <button
                    type="button"
                    onClick={handleResetOverlaySelection}
                    className="rounded-full border border-navy/30 bg-white px-4 py-2 text-xs font-semibold text-navy shadow-sm shadow-navy/10 transition hover:border-navy hover:bg-navy-soft hover:text-white"
                  >
                    Reset
                  </button>
                </div>
            </div>
          </section>
        ) : null}
          </section>
        ) : null}

        {showSnapshotSection ? (
          <section
            id="company-snapshot"
            className="rounded-2xl border border-amber-100 bg-paper p-5"
          >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h2 className="font-display text-2xl text-ink">Company Snapshot</h2>
              <span className="text-xs uppercase tracking-[0.2em] text-steel">
                Live fundamentals
              </span>
            </div>
            {activeStock?.ticker ? (
              <div className="flex flex-col items-end gap-2">
                <a
                  href={`?view=snapshot&ticker=${encodeURIComponent(activeStock.ticker)}#company-snapshot`}
                  className="inline-flex"
                >
                  <CompanyLogo ticker={activeStock.ticker} size={104} />
                </a>
                <div className="flex flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (!activeStock?.ticker) {
                        return;
                      }
                      setWatchlist(
                        toggleWatchlistItem({
                          ticker: activeStock.ticker,
                          company_name: activeStock.company_name ?? null,
                          sector: activeStock.sector ?? null,
                          industry: activeStock.industry ?? null
                        })
                      );
                    }}
                    className="rounded-full border border-navy/20 bg-white px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-navy shadow-sm shadow-navy/10 transition hover:border-navy hover:bg-navy-soft hover:text-white"
                  >
                    {activeInWatchlist ? "In watchlist" : "Add to watchlist"}
                  </button>
                  <button
                    type="button"
                    disabled={!activeStock?.ticker || activeInOverlay}
                    onClick={() => {
                      if (!activeStock?.ticker || activeInOverlay) {
                        return;
                      }
                      applySelectionUpdate((current) =>
                        current.includes(activeStock.ticker)
                          ? current
                          : [...current, activeStock.ticker]
                      );
                    }}
                    className="rounded-full border border-navy/20 bg-white px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-navy shadow-sm shadow-navy/10 transition hover:border-navy hover:bg-navy-soft hover:text-white disabled:cursor-not-allowed disabled:border-navy/10 disabled:text-navy/40"
                  >
                    {activeInOverlay ? "IN OVERLAY CHART" : "ADD TO OVERLAY CHART"}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
          <p className="mt-2 text-xs uppercase tracking-[0.2em] text-steel">
            As of {formatAsOf(snapshotAsOf)}
          </p>
          <p className="mt-2 text-xs uppercase tracking-[0.2em] text-steel">
            Returns exclude dividends
          </p>
          <p className="mt-2 text-xs text-steel">
            Use this snapshot to review fundamentals, valuation, and risk signals.
          </p>
          <label className="mt-4 block text-sm font-semibold text-ink">
            Ticker or company
            <input
              className="mt-2 w-full rounded-xl border border-amber-100 bg-white px-4 py-3 text-sm"
              placeholder="Search a ticker or company"
              value={snapshotQuery}
              onChange={(event) => {
                setSnapshotQuery(event.target.value);
                snapshotScrollTopRef.current = 0;
                setActiveTicker("");
                setSnapshotOpen(true);
              }}
              onFocus={(event) => {
                event.target.select();
                setSnapshotOpen(true);
              }}
              onBlur={() => {
                setTimeout(() => setSnapshotOpen(false), 120);
              }}
              onClick={(event) => {
                event.currentTarget.select();
                setSnapshotOpen(true);
              }}
            />
          </label>
          {snapshotOpen && snapshotOptions.length ? (
            <div
              ref={snapshotListRef}
              className="mt-2 max-h-64 overflow-y-auto rounded-xl border border-amber-100 bg-white text-sm text-steel"
              onMouseDown={(event) => event.preventDefault()}
              onScroll={(event) => {
                snapshotScrollTopRef.current = event.currentTarget.scrollTop;
              }}
            >
              {snapshotOptions.map((option) => (
                <button
                  key={option.ticker}
                  data-ticker={option.ticker}
                  type="button"
                  className="flex w-full items-center justify-between px-4 py-2 text-left hover:bg-amber-50"
                  onClick={() => {
                    handleSelectSnapshot(option);
                    setSnapshotOpen(false);
                  }}
                >
                  <span className="flex items-center gap-2">
                    <span className="font-semibold text-ink">{option.ticker}</span>
                    <TickerNewsButton
                      ticker={option.ticker}
                      className="h-4 w-4"
                      as="span"
                    />
                  </span>
                  <span className="text-xs text-steel">
                    {option.company_name ?? option.sector ?? "S&P 500"}
                  </span>
                </button>
              ))}
            </div>
          ) : null}
          <div className="mt-4 rounded-xl border border-amber-100 bg-white px-4 py-3">
            <p className="text-xs uppercase tracking-[0.2em] text-steel">Ticker</p>
            <div className="mt-1 flex items-center gap-2 font-semibold text-ink">
              <span>{activeStock?.ticker ?? "—"}</span>
              {activeStock?.ticker ? (
                <TickerNewsButton ticker={activeStock.ticker} className="h-4 w-4" />
              ) : null}
            </div>
            <p className="mt-2 text-sm text-steel">
              {activeError
                ? activeError
                : activeMetrics?.description ??
                  (snapshotLoading
                    ? "Loading company fundamentals..."
                    : fallbackDescription ??
                      activeMetrics?.name ??
                      activeStock?.company_name ??
                      "Select a ticker to see the company overview.")}
            </p>
          </div>
          <div className="mt-4 grid gap-3 text-sm text-steel sm:grid-cols-2">
            <div className="rounded-xl border border-amber-100 bg-white px-4 py-3">
              <p className="text-xs uppercase tracking-[0.2em] text-steel">Last price</p>
              <p className="mt-1 font-semibold text-ink">
                {activeError
                  ? "Unavailable"
                  : activeMetrics
                    ? formatPrice(activeMetrics.lastPrice)
                    : snapshotPlaceholder}
              </p>
            </div>
            <div className="rounded-xl border border-amber-100 bg-white px-4 py-3">
              <p className="text-xs uppercase tracking-[0.2em] text-steel">Market cap</p>
              <p className="mt-1 font-semibold text-ink">
                {activeError ? "Unavailable" : activeMetrics?.marketCap ?? snapshotPlaceholder}
              </p>
            </div>
            <div className="rounded-xl border border-amber-100 bg-white px-4 py-3">
              <p className="text-xs uppercase tracking-[0.2em] text-steel">P/E</p>
              <p className="mt-1 font-semibold text-ink">
                {activeError ? "Unavailable" : activeMetrics?.pe ?? snapshotPlaceholder}
              </p>
            </div>
            <div className="rounded-xl border border-amber-100 bg-white px-4 py-3">
              <p className="text-xs uppercase tracking-[0.2em] text-steel">Beta</p>
              <p className="mt-1 font-semibold text-ink">
                {activeError
                  ? "Unavailable"
                  : activeMetrics?.beta === null || activeMetrics?.beta === undefined
                    ? snapshotPlaceholder
                    : activeMetrics.beta.toFixed(2)}
              </p>
            </div>
            <div className="rounded-xl border border-amber-100 bg-white px-4 py-3">
              <p className="text-xs uppercase tracking-[0.2em] text-steel">1Y return</p>
              <p className="mt-1 font-semibold text-ink">
                {activeError
                  ? "Unavailable"
                  : activeMetrics
                    ? formatPercent(
                        activeMetrics.oneYearReturn ?? activeMetrics.annualReturn
                      )
                    : snapshotPlaceholder}
              </p>
            </div>
            <div className="rounded-xl border border-amber-100 bg-white px-4 py-3">
              <p className="text-xs uppercase tracking-[0.2em] text-steel">
                Alpha (vs S&amp;P)
              </p>
              <p className="mt-1 font-semibold text-ink">
                {activeError
                  ? "Unavailable"
                  : activeMetrics?.oneYearReturn !== null &&
                      activeMetrics?.oneYearReturn !== undefined &&
                      metricsByTicker.SPY?.oneYearReturn !== null &&
                      metricsByTicker.SPY?.oneYearReturn !== undefined
                    ? formatPercent(
                        activeMetrics.oneYearReturn - metricsByTicker.SPY.oneYearReturn
                      )
                    : activeMetrics?.annualReturn !== null &&
                        activeMetrics?.annualReturn !== undefined &&
                        metricsByTicker.SPY?.annualReturn !== null &&
                        metricsByTicker.SPY?.annualReturn !== undefined
                      ? formatPercent(
                          activeMetrics.annualReturn - metricsByTicker.SPY.annualReturn
                        )
                      : snapshotPlaceholder}
              </p>
            </div>
            <div className="rounded-xl border border-amber-100 bg-white px-4 py-3">
              <p className="text-xs uppercase tracking-[0.2em] text-steel">Volatility</p>
              <p className="mt-1 font-semibold text-ink">
                {activeError
                  ? "Unavailable"
                  : snapshotVolatility === null
                    ? snapshotPlaceholder
                    : formatPercent(snapshotVolatility)}
              </p>
            </div>
          </div>
          </section>
        ) : null}

        {showScreenerSection ? (
          <section
            id="stock-screener"
            className="rounded-2xl border border-amber-100 bg-paper p-6"
          >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-2xl text-ink">Stock Screener</h2>
              <p className="mt-1 text-sm text-steel">
                Browse tickers by sector and industry. The universe is the full S&amp;P 500.
              </p>
              <p className="mt-2 text-xs uppercase tracking-[0.2em] text-steel">
                As of {formatAsOf(screenerAsOfDisplay)}
              </p>
              <p className="mt-2 text-xs uppercase tracking-[0.2em] text-steel">
                Returns exclude dividends
              </p>
            </div>
            <div className="text-xs uppercase tracking-[0.2em] text-steel">
              {loadingUniverse ? "Loading..." : `${filteredStocks.length} matches`}
            </div>
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-3">
            <label className="relative text-sm font-semibold text-ink md:col-span-2">
              Search
              <input
                ref={screenerInputRef}
                className="mt-2 w-full rounded-xl border border-amber-100 bg-white px-4 py-3 text-sm"
                placeholder="Search ticker or company name"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setScreenerTicker("");
                  screenerScrollTopRef.current = 0;
                  setScreenerFocus(true);
                }}
                onFocus={() => {
                  setScreenerFocus(true);
                }}
                onBlur={() => {
                  setTimeout(() => setScreenerFocus(false), 120);
                }}
                onClick={() => {
                  setScreenerFocus(true);
                }}
              />
              {screenerFocus && screenerOptions.length ? (
                <div
                  ref={screenerListRef}
                  className="absolute z-10 mt-2 max-h-64 w-full overflow-y-auto rounded-xl border border-amber-100 bg-white text-sm text-steel shadow-lg"
                  onMouseDown={(event) => event.preventDefault()}
                  onScroll={(event) => {
                    screenerScrollTopRef.current = event.currentTarget.scrollTop;
                  }}
                >
                  {screenerOptions.map((option) => (
                    <button
                      key={option.ticker}
                      data-ticker={option.ticker}
                      type="button"
                      className="flex w-full items-center justify-between px-4 py-2 text-left hover:bg-amber-50"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        if (screenerListRef.current) {
                          screenerScrollTopRef.current =
                            screenerListRef.current.scrollTop;
                        }
                        setQuery(
                          `${option.ticker} · ${option.company_name ?? ""}`.trim()
                        );
                        setScreenerTicker(option.ticker);
                        setScreenerFocus(false);
                        requestAnimationFrame(() => {
                          setScreenerFocus(false);
                          screenerInputRef.current?.blur();
                        });
                      }}
                    >
                      <span className="flex items-center gap-2">
                        <span className="font-semibold text-ink">{option.ticker}</span>
                        <TickerNewsButton
                          ticker={option.ticker}
                          className="h-4 w-4"
                          as="span"
                        />
                      </span>
                      <span className="text-xs text-steel">
                        {option.company_name ?? option.sector ?? "S&P 500"}
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
            </label>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-amber-100 bg-white p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-steel">Sectors</p>
              <div className="mt-3 max-h-40 space-y-2 overflow-y-auto text-sm text-steel">
                {sectorOptions.map((option) => (
                  <label key={option} className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={selectedSectors.includes(option)}
                      onChange={(event) =>
                        setSelectedSectors((current) =>
                          event.target.checked
                            ? [...current, option]
                            : current.filter((item) => item !== option)
                        )
                      }
                    />
                    <span>{option}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="rounded-2xl border border-amber-100 bg-white p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-steel">Industries</p>
              <div className="mt-3 max-h-40 space-y-2 overflow-y-auto text-sm text-steel">
                {industryOptions.length ? (
                  industryOptions.map((option) => (
                    <label key={option} className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        checked={selectedIndustries.includes(option)}
                        onChange={(event) =>
                          setSelectedIndustries((current) =>
                            event.target.checked
                              ? [...current, option]
                              : current.filter((item) => item !== option)
                          )
                        }
                      />
                      <span>{option}</span>
                    </label>
                  ))
                ) : (
                  <p className="text-sm text-steel">Select a sector to filter industries.</p>
                )}
              </div>
            </div>
          </div>

          {isScreenerVisible ? (
            <div className="mt-5 rounded-2xl border border-amber-100 bg-white">
              <div className="min-w-0">
                <div className="grid grid-cols-[minmax(0,0.7fr)_minmax(0,0.35fr)_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.8fr)_minmax(0,0.7fr)_minmax(0,0.7fr)_minmax(0,1.1fr)_minmax(0,1.1fr)] gap-2 border-b border-amber-100 px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-steel">
                  <span className="text-center">Ticker</span>
                  <span className="text-center">News</span>
                  <span className="pl-2">Company</span>
                  <span>Sector</span>
                  <span>Industry</span>
                  <span className="text-center">Last price</span>
                  <span className="text-center">1Y</span>
                  <span className="text-center">Beta</span>
                  <span className="text-center">Watch list</span>
                  <span className="text-center">Add to Overlay Chart</span>
                </div>
                {filteredStocks.map((stock, index) => {
                  const metrics = metricsByTicker[stock.ticker];
                  const metricsError = metricsErrorsByTicker[stock.ticker];
                  const isSelected = selectedTickers.includes(stock.ticker);
                  const isBenchmark = stock.ticker === benchmarkTicker;
                  const inWatchlist = watchlist.some(
                    (item) => item.ticker === stock.ticker
                  );
                  return (
                    <div
                      key={stock.ticker}
                      className={`grid grid-cols-[minmax(0,0.7fr)_minmax(0,0.35fr)_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.8fr)_minmax(0,0.7fr)_minmax(0,0.7fr)_minmax(0,1.1fr)_minmax(0,1.1fr)] items-center gap-2 border-b border-amber-50 px-4 py-3 text-xs text-steel ${
                        index % 2 === 0 ? "bg-white/95" : "bg-white"
                      }`}
                    >
                      <div className="flex items-center justify-center text-center text-navy">
                        <span className="font-semibold">{stock.ticker}</span>
                      </div>
                      <div className="flex items-center justify-center">
                        <TickerNewsButton ticker={stock.ticker} className="h-4 w-4" />
                      </div>
                      <span className="min-w-0 truncate pl-2 font-semibold text-ink">
                        {stock.company_name ?? "—"}
                      </span>
                      <span className="min-w-0 truncate">{stock.sector ?? "—"}</span>
                      <span className="min-w-0 truncate">{stock.industry ?? "—"}</span>
                      <span className="text-center">
                        {metrics
                          ? formatPrice(metrics.lastPrice)
                          : metricsError
                            ? "Unavailable"
                          : isScreenerVisible
                              ? "Loading..."
                              : "—"}
                      </span>
                      <span className="text-center">
                        {metrics
                          ? formatPercent(metrics.oneYearReturn ?? metrics.annualReturn)
                          : metricsError
                            ? "Unavailable"
                          : isScreenerVisible
                              ? "Loading..."
                              : "—"}
                      </span>
                      <span className="text-center">
                        {metrics
                          ? metrics.beta === null || metrics.beta === undefined
                            ? "—"
                            : metrics.beta.toFixed(2)
                          : metricsError
                            ? "Unavailable"
                          : isScreenerVisible
                              ? "Loading..."
                              : "—"}
                      </span>
                      <label className="flex items-center justify-center gap-2 text-[10px] text-steel">
                        <input
                          type="checkbox"
                          checked={inWatchlist}
                          onChange={() =>
                            setWatchlist(
                              toggleWatchlistItem({
                                ticker: stock.ticker,
                                company_name: stock.company_name ?? null,
                                sector: stock.sector ?? null,
                                industry: stock.industry ?? null
                              })
                            )
                          }
                        />
                        <span>Add to Watch List</span>
                      </label>
                      <div className="flex justify-center">
                        <input
                          type="checkbox"
                          checked={isBenchmark ? false : isSelected}
                          disabled={isBenchmark}
                          className={isBenchmark ? "cursor-not-allowed opacity-40" : ""}
                          onChange={() =>
                            isBenchmark
                              ? null
                              : applySelectionUpdate((current) =>
                                  current.includes(stock.ticker)
                                    ? current.filter((item) => item !== stock.ticker)
                                    : [...current, stock.ticker]
                                )
                          }
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="mt-5 rounded-2xl border border-amber-100 bg-white px-4 py-6 text-center text-sm text-steel">
              Browse the screener to explore every S&amp;P 500 constituent.
            </div>
          )}
          </section>
        ) : null}
      </div>
    </main>
  );
}

export default function PlaygroundPage() {
  return (
    <Suspense
      fallback={<div className="px-6 py-8 text-sm text-steel">Loading playground…</div>}
    >
      <PlaygroundPageInner />
    </Suspense>
  );
}

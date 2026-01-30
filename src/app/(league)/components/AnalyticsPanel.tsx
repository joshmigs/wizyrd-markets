"use client";

import { useEffect, useMemo, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type League = {
  id: string;
  name: string;
  current_week?: {
    id: string;
    week_start: string;
    week_end: string;
    lock_time: string;
  } | null;
};

type Member = {
  id: string;
  display_name?: string | null;
  email?: string | null;
};

type AnalyticsSummary = {
  record: {
    wins: number;
    losses: number;
    ties: number;
    games: number;
    winPct: number | null;
  };
  stats: {
    avgWeekly: number | null;
    monthly: number | null;
    annualized: number | null;
    stdDev: number | null;
  };
  benchmark: {
    alpha: number | null;
    beta: number | null;
  };
  series: {
    portfolio: number[];
    benchmark: number[];
    cumulative: number[];
    benchmarkCumulative: number[];
    weeklySharpe: number[];
    weeklyBeta: number[];
    weeklyAlpha: number[];
    weeklyVolatility: number[];
  };
};

const RANGE_OPTIONS = [
  { value: "live", label: "Current week (live)" },
  { value: "1w", label: "Last 1 week" },
  { value: "2w", label: "Last 2 weeks" },
  { value: "3w", label: "Last 3 weeks" },
  { value: "4w", label: "Last 4 weeks" },
  { value: "6m", label: "Last 6 months" },
  { value: "12m", label: "Last 12 months" },
  { value: "qtd", label: "Quarter to date" },
  { value: "ytd", label: "Year to date" },
  { value: "all", label: "All time" }
];

const formatPercent = (value: number | null) => {
  if (value === null || Number.isNaN(value)) {
    return "—";
  }
  const normalized = Math.abs(value) < 0.00005 ? 0 : value;
  return `${(normalized * 100).toFixed(2)}%`;
};

const formatNumber = (value: number | null) => {
  if (value === null || Number.isNaN(value)) {
    return "—";
  }
  const normalized = Math.abs(value) < 0.00005 ? 0 : value;
  return normalized.toFixed(2);
};

const mean = (values: number[]) =>
  values.reduce((sum, value) => sum + value, 0) / values.length;

const stdDev = (values: number[]) => {
  if (values.length < 2) {
    return values.length === 1 ? 0 : null;
  }
  const avg = mean(values);
  const variance =
    values.reduce((sum, value) => sum + (value - avg) ** 2, 0) /
    (values.length - 1);
  return Math.sqrt(variance);
};

const buildSharpeSeries = (values: number[]) =>
  values.map((_, index) => {
    const slice = values.slice(0, index + 1);
    const vol = stdDev(slice);
    const avg = mean(slice);
    return vol && vol !== 0 ? avg / vol : 0;
  });

const valueTone = (value: number | null, neutralClass = "text-navy") => {
  if (value === null || Number.isNaN(value)) {
    return neutralClass;
  }
  const rounded = Math.abs(value) < 0.00005 ? 0 : value;
  if (rounded < 0) {
    return "text-red-600";
  }
  if (rounded > 0) {
    return "text-green-500";
  }
  return neutralClass;
};

type ChartRange = {
  min: number;
  max: number;
};

type ChartPadding = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

const CHART_PADDING: ChartPadding = {
  top: 16,
  right: 12,
  bottom: 20,
  left: 38
};

const resolveChartRange = (values: number[], includeZero: boolean) => {
  const filtered = values.filter((value) => Number.isFinite(value));
  if (!filtered.length) {
    return { min: 0, max: 0 };
  }
  let min = Math.min(...filtered);
  let max = Math.max(...filtered);
  if (includeZero) {
    min = Math.min(min, 0);
    max = Math.max(max, 0);
  }
  if (min === max) {
    const bump = Math.abs(min) > 0 ? Math.abs(min) * 0.1 : 0.01;
    min -= bump;
    max += bump;
  }
  return { min, max };
};

const buildYAxisTicks = (range: ChartRange) => {
  const { min, max } = range;
  if (min === max) {
    return [min];
  }
  if (min < 0 && max > 0) {
    return [max, 0, min];
  }
  return [max, (max + min) / 2, min];
};

const getYPosition = (
  value: number,
  range: ChartRange,
  height: number,
  padding: ChartPadding
) => {
  const plotHeight = height - padding.top - padding.bottom;
  const spread = range.max - range.min || 1;
  return padding.top + ((range.max - value) / spread) * plotHeight;
};

const buildLinePath = (
  values: number[],
  width: number,
  height: number,
  range: ChartRange,
  padding: ChartPadding
) => {
  if (values.length < 2) {
    return "";
  }
  const plotWidth = width - padding.left - padding.right;
  const xStep = plotWidth / (values.length - 1);

  return values
    .map((value, index) => {
      const x = padding.left + index * xStep;
      const y = getYPosition(value, range, height, padding);
      return `${index === 0 ? "M" : "L"} ${x} ${y}`;
    })
    .join(" ");
};

const getRangeTargetWeeks = (range: string) => {
  const now = new Date();
  const weekTargets: Record<string, number> = {
    "1w": 1,
    "2w": 2,
    "3w": 3,
    "4w": 4,
    "6m": 26,
    "12m": 52,
    all: 1
  };

  if (range === "live") {
    return 1;
  }

  if (range === "qtd") {
    const quarterStartMonth = Math.floor(now.getUTCMonth() / 3) * 3;
    const quarterStart = new Date(Date.UTC(now.getUTCFullYear(), quarterStartMonth, 1));
    return Math.max(
      1,
      Math.ceil((now.getTime() - quarterStart.getTime()) / (7 * 24 * 60 * 60 * 1000))
    );
  }

  if (range === "ytd") {
    const yearStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
    return Math.max(
      1,
      Math.ceil((now.getTime() - yearStart.getTime()) / (7 * 24 * 60 * 60 * 1000))
    );
  }

  return weekTargets[range] ?? 2;
};

function StatCard({
  label,
  value,
  className = "",
  valueClassName = ""
}: {
  label: string;
  value: string;
  className?: string;
  valueClassName?: string;
}) {
  const valueClasses = [
    "mt-2 text-2xl font-semibold",
    valueClassName || "text-navy"
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={`rounded-2xl border border-amber-100 bg-white p-4 ${className}`}>
      <p className="text-xs uppercase tracking-[0.2em] text-steel">{label}</p>
      <p className={valueClasses}>{value}</p>
    </div>
  );
}

function LineChart({
  primary,
  secondary,
  tertiary = [],
  primaryLabel = "Portfolio",
  secondaryLabel = "Benchmark",
  tertiaryLabel = "Comparison",
  showCompareLegend = false,
  showSecondaryLegend = false,
  description,
  title,
  subtitle,
  emptyMessage,
  showEmpty,
  xLabel,
  yLabel,
  tickFormat
}: {
  primary: number[];
  secondary: number[];
  tertiary?: number[];
  primaryLabel?: string;
  secondaryLabel?: string;
  tertiaryLabel?: string;
  showCompareLegend?: boolean;
  showSecondaryLegend?: boolean;
  description?: string;
  title: string;
  subtitle: string;
  emptyMessage: string;
  showEmpty: boolean;
  xLabel: string;
  yLabel: string;
  tickFormat?: (value: number) => string;
}) {
  const width = 340;
  const height = 140;
  const padding = CHART_PADDING;
  const formatTick = tickFormat ?? formatPercent;
  const tertiaryColor = "#f59e0b";
  const [tooltip, setTooltip] = useState<{
    x: number;
    y: number;
    value: number;
    label: string;
    index: number;
    color: string;
  } | null>(null);
  const range = useMemo(
    () => resolveChartRange([...primary, ...secondary, ...tertiary], true),
    [primary, secondary, tertiary]
  );
  const yTicks = useMemo(() => buildYAxisTicks(range), [range]);
  const primaryPath = useMemo(
    () => buildLinePath(primary, width, height, range, padding),
    [primary, range]
  );
  const secondaryPath = useMemo(
    () => buildLinePath(secondary, width, height, range, padding),
    [secondary, range]
  );
  const tertiaryPath = useMemo(
    () => buildLinePath(tertiary, width, height, range, padding),
    [tertiary, range]
  );
  const plotWidth = width - padding.left - padding.right;
  const maxPoints = Math.max(primary.length, secondary.length, tertiary.length);
  const xStep = maxPoints > 1 ? plotWidth / (maxPoints - 1) : 0;
  const axisCenterX = padding.left + plotWidth / 2;
  const tooltipWidth = 116;
  const tooltipHeight = 40;
  const clamp = (value: number, min: number, max: number) =>
    Math.min(max, Math.max(min, value));
  const tooltipX = tooltip
    ? clamp(
        tooltip.x,
        padding.left + tooltipWidth / 2,
        width - padding.right - tooltipWidth / 2
      )
    : 0;

  return (
    <div className="rounded-2xl border border-amber-100 bg-white p-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-steel">{title}</p>
          <p className="mt-1 text-sm text-steel">{subtitle}</p>
        </div>
      </div>
      <div className="mt-4">
        {showEmpty ? (
          <p className="text-sm text-steel">{emptyMessage}</p>
        ) : (
          <svg
            width="100%"
            viewBox={`0 0 ${width} ${height}`}
            className="h-40 w-full"
            onMouseLeave={() => setTooltip(null)}
          >
            <rect
              x="0"
              y="0"
              width={width}
              height={height}
              rx="16"
              fill="transparent"
            />
            <text x={padding.left} y="12" fill="#94a3b8" fontSize="10">
              {yLabel}
            </text>
            <text
              x={axisCenterX}
              y={height - 2}
              textAnchor="middle"
              fill="#94a3b8"
              fontSize="10"
            >
              {xLabel}
            </text>
            <line
              x1={padding.left}
              x2={padding.left}
              y1={padding.top}
              y2={height - padding.bottom}
              stroke="#e2e8f0"
              strokeWidth="1"
            />
            <line
              x1={padding.left}
              x2={width - padding.right}
              y1={height - padding.bottom}
              y2={height - padding.bottom}
              stroke="#e2e8f0"
              strokeWidth="1"
            />
            {yTicks.map((tick, index) => (
              <text
                key={`line-tick-${index}`}
                x={padding.left - 6}
                y={getYPosition(tick, range, height, padding)}
                textAnchor="end"
                dominantBaseline="middle"
                fill="#94a3b8"
                fontSize="10"
              >
                {formatTick(tick)}
              </text>
            ))}
            {secondaryPath ? (
              <path
                d={secondaryPath}
                fill="none"
                stroke="#94a3b8"
                strokeWidth="2"
                strokeDasharray="5 4"
              />
            ) : null}
            {secondary.length === 1 ? (
              <circle
                cx={axisCenterX}
                cy={getYPosition(secondary[0], range, height, padding)}
                r="5"
                fill="#94a3b8"
              />
            ) : null}
            {tertiaryPath ? (
              <path
                d={tertiaryPath}
                fill="none"
                stroke={tertiaryColor}
                strokeWidth="2.5"
                strokeLinecap="round"
              />
            ) : null}
            {tertiary.length === 1 ? (
              <circle
                cx={axisCenterX}
                cy={getYPosition(tertiary[0], range, height, padding)}
                r="5"
                fill={tertiaryColor}
              />
            ) : null}
            {primary.length > 1 ? (
              <path
                d={primaryPath}
                fill="none"
                stroke="#1b3d63"
                strokeWidth="3"
                strokeLinecap="round"
              />
            ) : primary.length === 1 ? (
              <circle
                cx={axisCenterX}
                cy={getYPosition(primary[0], range, height, padding)}
                r="6"
                fill="#1b3d63"
              />
            ) : null}
            {primary.map((value, index) => {
              const x = maxPoints > 1 ? padding.left + index * xStep : axisCenterX;
              const y = getYPosition(value, range, height, padding);
              return (
                <circle
                  key={`primary-point-${index}`}
                  cx={x}
                  cy={y}
                  r="8"
                  fill="transparent"
                  onMouseEnter={() =>
                    setTooltip({
                      x,
                      y,
                      value,
                      label: primaryLabel,
                      index,
                      color: "#1b3d63"
                    })
                  }
                />
              );
            })}
            {tertiary.map((value, index) => {
              const x = maxPoints > 1 ? padding.left + index * xStep : axisCenterX;
              const y = getYPosition(value, range, height, padding);
              return (
                <circle
                  key={`tertiary-point-${index}`}
                  cx={x}
                  cy={y}
                  r="8"
                  fill="transparent"
                  onMouseEnter={() =>
                    setTooltip({
                      x,
                      y,
                      value,
                      label: tertiaryLabel,
                      index,
                      color: tertiaryColor
                    })
                  }
                />
              );
            })}
            {secondary.map((value, index) => {
              const x = maxPoints > 1 ? padding.left + index * xStep : axisCenterX;
              const y = getYPosition(value, range, height, padding);
              return (
                <circle
                  key={`secondary-point-${index}`}
                  cx={x}
                  cy={y}
                  r="8"
                  fill="transparent"
                  onMouseEnter={() =>
                    setTooltip({
                      x,
                      y,
                      value,
                      label: secondaryLabel,
                      index,
                      color: "#94a3b8"
                    })
                  }
                />
              );
            })}
            {tooltip ? (
              <g pointerEvents="none">
                <rect
                  x={tooltipX - tooltipWidth / 2}
                  y={Math.max(tooltip.y - tooltipHeight - 10, padding.top)}
                  width={tooltipWidth}
                  height={tooltipHeight}
                  rx="10"
                  fill="#fef3c7"
                />
                <text
                  x={tooltipX}
                  y={Math.max(tooltip.y - tooltipHeight - 10, padding.top) + 14}
                  textAnchor="middle"
                  fill="#1b3d63"
                  fontSize="9"
                  letterSpacing="0.18em"
                >
                  {`WEEK ${tooltip.index + 1}`}
                </text>
                <text
                  x={tooltipX}
                  y={Math.max(tooltip.y - tooltipHeight - 10, padding.top) + 30}
                  textAnchor="middle"
                  fill="#1b3d63"
                  fontSize="12"
                  fontWeight="600"
                >
                  {`${tooltip.label}: ${formatTick(tooltip.value)}`}
                </text>
                <circle cx={tooltip.x} cy={tooltip.y} r="4" fill={tooltip.color} />
              </g>
            ) : null}
          </svg>
        )}
      </div>
      {showCompareLegend ? (
        <div className="mt-3 flex flex-wrap justify-center gap-4 text-[11px] text-steel">
          <span className="inline-flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-[#1b3d63]" />
            {primaryLabel}
          </span>
          <span className="inline-flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-[#f59e0b]" />
            {tertiaryLabel}
          </span>
          {showSecondaryLegend ? (
            <span className="inline-flex items-center gap-2">
              <span className="h-0.5 w-6 border-t-2 border-dotted border-slate-400" />
              {secondaryLabel}
            </span>
          ) : null}
        </div>
      ) : null}
      {description ? (
        <p className="mt-3 text-xs text-steel">{description}</p>
      ) : null}
    </div>
  );
}

function BarChart({
  values,
  comparison = [],
  primaryLabel = "Portfolio",
  comparisonLabel = "Comparison",
  showCompareLegend = false,
  description,
  title,
  subtitle,
  emptyMessage,
  showEmpty,
  xLabel,
  yLabel
}: {
  values: number[];
  comparison?: number[];
  primaryLabel?: string;
  comparisonLabel?: string;
  showCompareLegend?: boolean;
  description?: string;
  title: string;
  subtitle: string;
  emptyMessage: string;
  showEmpty: boolean;
  xLabel: string;
  yLabel: string;
}) {
  const width = 340;
  const height = 140;
  const padding = CHART_PADDING;
  const [tooltip, setTooltip] = useState<{
    x: number;
    y: number;
    value: number;
    index: number;
    label: string;
    color: string;
  } | null>(null);
  const comparisonSeries = comparison.slice(0, values.length);
  const range = useMemo(
    () => resolveChartRange([...values, ...comparisonSeries], true),
    [values, comparisonSeries]
  );
  const yTicks = useMemo(() => buildYAxisTicks(range), [range]);
  const plotWidth = width - padding.left - padding.right;
  const barWidth = values.length ? plotWidth / values.length : 0;
  const baseline = getYPosition(0, range, height, padding);
  const axisCenterX = padding.left + plotWidth / 2;
  const tooltipWidth = 124;
  const tooltipHeight = 40;
  const comparisonColor = "#f59e0b";
  const clamp = (value: number, min: number, max: number) =>
    Math.min(max, Math.max(min, value));
  const tooltipX = tooltip
    ? clamp(
        tooltip.x,
        padding.left + tooltipWidth / 2,
        width - padding.right - tooltipWidth / 2
      )
    : 0;

  return (
    <div className="rounded-2xl border border-amber-100 bg-white p-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-steel">{title}</p>
          <p className="mt-1 text-sm text-steel">{subtitle}</p>
        </div>
      </div>
      <div className="mt-4">
        {showEmpty ? (
          <p className="text-sm text-steel">{emptyMessage}</p>
        ) : (
          <svg
            width="100%"
            viewBox={`0 0 ${width} ${height}`}
            className="h-40 w-full"
            onMouseLeave={() => setTooltip(null)}
          >
            <rect x="0" y="0" width={width} height={height} rx="16" fill="transparent" />
            <text x={padding.left} y="12" fill="#94a3b8" fontSize="10">
              {yLabel}
            </text>
            <text
              x={axisCenterX}
              y={height - 2}
              textAnchor="middle"
              fill="#94a3b8"
              fontSize="10"
            >
              {xLabel}
            </text>
            <line
              x1={padding.left}
              x2={padding.left}
              y1={padding.top}
              y2={height - padding.bottom}
              stroke="#e2e8f0"
              strokeWidth="1"
            />
            <line
              x1={padding.left}
              x2={width - padding.right}
              y1={height - padding.bottom}
              y2={height - padding.bottom}
              stroke="#e2e8f0"
              strokeWidth="1"
            />
            {yTicks.map((tick, index) => (
              <text
                key={`bar-tick-${index}`}
                x={padding.left - 6}
                y={getYPosition(tick, range, height, padding)}
                textAnchor="end"
                dominantBaseline="middle"
                fill="#94a3b8"
                fontSize="10"
              >
                {formatPercent(tick)}
              </text>
            ))}
            <line
              x1={padding.left}
              x2={width - padding.right}
              y1={baseline}
              y2={baseline}
              stroke="#e2e8f0"
              strokeWidth="1"
            />
            {values.map((value, index) => {
              const comparisonValue = comparisonSeries[index];
              const hasComparisonValue = Number.isFinite(comparisonValue);
              const groupWidth = barWidth * 0.8;
              const gap = hasComparisonValue ? Math.min(6, barWidth * 0.12) : 0;
              const barsInGroup = hasComparisonValue ? 2 : 1;
              const barSlotWidth = barsInGroup
                ? (groupWidth - gap) / barsInGroup
                : groupWidth;
              const groupX = padding.left + index * barWidth + (barWidth - groupWidth) / 2;
              const primaryX = groupX;
              const compareX = groupX + barSlotWidth + gap;

              const primaryY = getYPosition(value, range, height, padding);
              const primaryHeight = Math.abs(primaryY - baseline);
              const primaryTop = Math.min(primaryY, baseline);
              const primaryCenterX = primaryX + barSlotWidth / 2;

              return (
                <g key={`${index}-${value}`}>
                  <rect
                    x={primaryX}
                    y={primaryTop}
                    width={barSlotWidth}
                    height={Math.max(primaryHeight, 2)}
                    rx="6"
                    fill={value >= 0 ? "#1b3d63" : "#94a3b8"}
                    onMouseEnter={() =>
                      setTooltip({
                        x: primaryCenterX,
                        y: primaryTop,
                        value,
                        index,
                        label: primaryLabel,
                        color: "#1b3d63"
                      })
                    }
                  />
                  {hasComparisonValue ? (
                    <rect
                      x={compareX}
                      y={Math.min(
                        getYPosition(comparisonValue as number, range, height, padding),
                        baseline
                      )}
                      width={barSlotWidth}
                      height={Math.max(
                        Math.abs(
                          getYPosition(comparisonValue as number, range, height, padding) -
                            baseline
                        ),
                        2
                      )}
                      rx="6"
                      fill={
                        (comparisonValue as number) >= 0 ? comparisonColor : "#fcd34d"
                      }
                      onMouseEnter={() =>
                        setTooltip({
                          x: compareX + barSlotWidth / 2,
                          y: Math.min(
                            getYPosition(
                              comparisonValue as number,
                              range,
                              height,
                              padding
                            ),
                            baseline
                          ),
                          value: comparisonValue as number,
                          index,
                          label: comparisonLabel,
                          color: comparisonColor
                        })
                      }
                    />
                  ) : null}
                </g>
              );
            })}
            {tooltip ? (
              <g pointerEvents="none">
                <rect
                  x={tooltipX - tooltipWidth / 2}
                  y={Math.max(tooltip.y - tooltipHeight - 10, padding.top)}
                  width={tooltipWidth}
                  height={tooltipHeight}
                  rx="10"
                  fill="#fef3c7"
                />
                <text
                  x={tooltipX}
                  y={Math.max(tooltip.y - tooltipHeight - 10, padding.top) + 14}
                  textAnchor="middle"
                  fill="#1b3d63"
                  fontSize="9"
                  letterSpacing="0.18em"
                >
                  {`WEEK ${tooltip.index + 1}`}
                </text>
                <text
                  x={tooltipX}
                  y={Math.max(tooltip.y - tooltipHeight - 10, padding.top) + 30}
                  textAnchor="middle"
                  fill="#1b3d63"
                  fontSize="12"
                  fontWeight="600"
                >
                  {`${tooltip.label}: ${formatPercent(tooltip.value)}`}
                </text>
                <circle cx={tooltip.x} cy={tooltip.y} r="4" fill={tooltip.color} />
              </g>
            ) : null}
          </svg>
        )}
      </div>
      {showCompareLegend ? (
        <div className="mt-3 flex flex-wrap justify-center gap-4 text-[11px] text-steel">
          <span className="inline-flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-[#1b3d63]" />
            {primaryLabel}
          </span>
          <span className="inline-flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-[#f59e0b]" />
            {comparisonLabel}
          </span>
        </div>
      ) : null}
      {description ? (
        <p className="mt-3 text-xs text-steel">{description}</p>
      ) : null}
    </div>
  );
}

export default function AnalyticsPanel({
  accessToken,
  leagues,
  selectedLeagueId,
  onLeagueChange
}: {
  accessToken: string;
  leagues: League[];
  selectedLeagueId?: string;
  onLeagueChange?: (leagueId: string) => void;
}) {
  const [authToken, setAuthToken] = useState<string>(accessToken);
  const [leagueId, setLeagueId] = useState<string>(selectedLeagueId ?? "all");
  const [range, setRange] = useState<string>("all");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [compareUserId, setCompareUserId] = useState<string>("none");
  const [compareSummary, setCompareSummary] = useState<AnalyticsSummary | null>(null);
  const [compareLoading, setCompareLoading] = useState(false);
  const [compareError, setCompareError] = useState<string | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<string>("me");
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const effectiveLeagueId =
    leagueId === "all" ? (leagues[0]?.id ?? "all") : leagueId;
  const compareOptions = useMemo(() => {
    const options = [{ value: "none", label: "Compare to..." }];
    if (effectiveLeagueId === "all") {
      return options;
    }
    if (selectedUserId !== "me") {
      options.push({ value: "me", label: "Your stats" });
    }
    members.forEach((member) => {
      if (member.id === selectedUserId) {
        return;
      }
      options.push({
        value: member.id,
        label: member.display_name ?? member.email ?? "Member"
      });
    });
    return options;
  }, [members, selectedUserId, effectiveLeagueId]);
  const compareLabel = useMemo(() => {
    if (compareUserId === "none") {
      return "";
    }
    if (compareUserId === "me") {
      return "You";
    }
    const match = members.find((member) => member.id === compareUserId);
    return match?.display_name ?? match?.email ?? "Member";
  }, [compareUserId, members]);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    supabase.auth.getSession().then(({ data }) => {
      setCurrentUserId(data.session?.user.id ?? null);
      if (!accessToken) {
        setAuthToken(data.session?.access_token ?? "");
      }
      setSelectedUserId((current) => current);
    });
  }, []);

  useEffect(() => {
    if (accessToken) {
      setAuthToken(accessToken);
    }
  }, [accessToken]);

  useEffect(() => {
    if (selectedLeagueId && selectedLeagueId !== leagueId) {
      setLeagueId(selectedLeagueId);
      return;
    }
    if (!selectedLeagueId && leagueId === "all" && leagues.length > 0) {
      setLeagueId(leagues[0].id);
    }
  }, [selectedLeagueId, leagueId, leagues]);

  useEffect(() => {
    if (effectiveLeagueId === "all") {
      setMembers([]);
      setSelectedUserId("me");
      return;
    }
    if (!authToken) {
      setMembers([]);
      return;
    }

    const loadMembers = async () => {
      setMembersLoading(true);
      try {
        const response = await fetch(
          `/api/league/members?leagueId=${effectiveLeagueId}`,
          {
            headers: {
              Authorization: `Bearer ${authToken}`
            }
          }
        );
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
          setMembers([]);
          return;
        }
        const nextMembers = (result.members ?? []) as Member[];
        const filteredMembers = currentUserId
          ? nextMembers.filter((member) => member.id !== currentUserId)
          : nextMembers;
        setMembers(filteredMembers);
        setSelectedUserId((current) => {
          if (current === "me") {
            return "me";
          }
          return filteredMembers.some((member) => member.id === current)
            ? current
            : "me";
        });
      } catch (_error) {
        setMembers([]);
      } finally {
        setMembersLoading(false);
      }
    };

    loadMembers();
  }, [authToken, effectiveLeagueId, currentUserId]);

  useEffect(() => {
    setCompareUserId((current) => {
      if (current === "none") {
        return current;
      }
      if (effectiveLeagueId === "all") {
        return "none";
      }
      if (current === selectedUserId) {
        return "none";
      }
      if (current === "me") {
        return selectedUserId === "me" ? "none" : current;
      }
      const stillMember = members.some((member) => member.id === current);
      if (!stillMember) {
        return "none";
      }
      return current;
    });
  }, [members, selectedUserId, effectiveLeagueId]);

  useEffect(() => {
    const fetchSummary = async () => {
      setLoading(true);
      setError(null);
      if (!authToken) {
        setLoading(false);
        return;
      }
      const query = new URLSearchParams();
      if (leagueId !== "all") {
        query.set("leagueId", leagueId);
      }
      query.set("range", range);
      if (selectedUserId !== "me") {
        if (effectiveLeagueId !== "all") {
          query.set("leagueId", effectiveLeagueId);
        }
        query.set("userId", selectedUserId);
      }

      try {
        const response = await fetch(`/api/analytics/summary?${query.toString()}`, {
          headers: {
            Authorization: `Bearer ${authToken}`
          }
        });

        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
          setError(result.error ?? "Unable to load analytics.");
          return;
        }

        setSummary(result as AnalyticsSummary);
      } catch (_error) {
        setError("Unable to load analytics.");
      } finally {
        setLoading(false);
      }
    };

    fetchSummary();
  }, [authToken, leagueId, range, selectedUserId, effectiveLeagueId]);

  useEffect(() => {
    if (compareUserId === "none" || effectiveLeagueId === "all") {
      setCompareSummary(null);
      setCompareError(null);
      setCompareLoading(false);
      return;
    }

    const controller = new AbortController();
    const fetchComparison = async () => {
      setCompareLoading(true);
      setCompareError(null);
      if (!authToken) {
        setCompareLoading(false);
        return;
      }
      const query = new URLSearchParams();
      query.set("range", range);
      if (effectiveLeagueId !== "all") {
        query.set("leagueId", effectiveLeagueId);
      }
      if (compareUserId !== "me") {
        query.set("userId", compareUserId);
      }

      try {
        const response = await fetch(
          `/api/analytics/summary?${query.toString()}`,
          {
            headers: {
              Authorization: `Bearer ${authToken}`
            },
            signal: controller.signal
          }
        );

        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
          setCompareError(result.error ?? "Unable to load comparison.");
          setCompareSummary(null);
          return;
        }

        setCompareSummary(result as AnalyticsSummary);
      } catch (_error) {
        if (!controller.signal.aborted) {
          setCompareError("Unable to load comparison.");
          setCompareSummary(null);
        }
      } finally {
        if (!controller.signal.aborted) {
          setCompareLoading(false);
        }
      }
    };

    fetchComparison();

    return () => {
      controller.abort();
    };
  }, [authToken, compareUserId, effectiveLeagueId, range]);

  const stats = summary?.stats;
  const record = summary?.record;
  const benchmark = summary?.benchmark;
  const compareSeries = compareSummary?.series;
  const compareLineLabel = compareLabel || "Comparison";
  const compareSharpeSeries = useMemo(() => {
    if (!compareSummary?.series) {
      return [] as number[];
    }
    const provided = compareSummary.series.weeklySharpe ?? [];
    if (provided.length) {
      return provided;
    }
    const portfolio = compareSummary.series.portfolio ?? [];
    return portfolio.length ? buildSharpeSeries(portfolio) : [];
  }, [compareSummary]);
  const showCompareLegend = compareUserId !== "none";
  const cumulativeSubtitle = showCompareLegend
    ? `You vs S&P 500 vs ${compareLineLabel}`
    : "You vs S&P 500";
  const hasGames = Boolean(record && record.games > 0);
  const lossPct = hasGames && record ? record.losses / record.games : null;
  const tiePct = hasGames && record ? record.ties / record.games : null;
  const targetWeeks = getRangeTargetWeeks(range);
  const weeksPlayed = summary?.series?.portfolio?.length ?? 0;
  const remainingWeeks = Math.max(targetWeeks - weeksPlayed, 0);
  const emptyMessage =
    range === "live"
      ? "Live stats update after close."
      : range === "all"
        ? "Play to unlock charts."
        : remainingWeeks > 0
          ? `Play ${remainingWeeks} more week${remainingWeeks === 1 ? "" : "s"} to unlock charts.`
          : "Charts will update as new weeks finalize.";
  const showEmpty =
    range === "live"
      ? weeksPlayed === 0
      : range === "all"
        ? weeksPlayed === 0
        : weeksPlayed < targetWeeks;

  return (
    <section className="rounded-2xl border border-amber-100 bg-paper p-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="font-display text-2xl text-ink">Analytics</h2>
          <p className="mt-1 text-sm text-steel">
            Track league record and portfolio performance trends.
          </p>
          <p className="mt-2 text-xs uppercase tracking-[0.2em] text-steel">
            Returns exclude dividends
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <select
            className="rounded-full border border-amber-100 bg-white px-4 py-2 text-sm"
            value={leagueId}
            onChange={(event) => {
              const value = event.target.value;
              setLeagueId(value);
              if (value !== "all") {
                onLeagueChange?.(value);
              }
            }}
          >
            {leagues.map((league) => (
              <option key={league.id} value={league.id}>
                {league.name}
              </option>
            ))}
          </select>
          <select
            className="cursor-pointer rounded-full border border-amber-100 bg-white px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-70"
            value={selectedUserId}
            onChange={(event) => setSelectedUserId(event.target.value)}
            disabled={leagues.length === 0}
          >
            <option value="me">Your stats</option>
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.display_name ?? member.email ?? "Member"}
              </option>
            ))}
          </select>
          <select
            className="rounded-full border border-amber-100 bg-white px-4 py-2 text-sm"
            value={range}
            onChange={(event) => setRange(event.target.value)}
          >
            {RANGE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error ? <p className="mt-4 text-sm text-red-600">{error}</p> : null}
      {loading ? <p className="mt-4 text-sm text-steel">Loading analytics...</p> : null}

      {!loading ? (
        <>
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-amber-100 bg-white p-5">
              <p className="text-xs uppercase tracking-[0.2em] text-steel">
                Record
              </p>
              <div className="mt-4 grid gap-4 sm:grid-cols-3">
                <StatCard
                  label="Wins"
                  value={hasGames && record ? `${record.wins}` : "—"}
                  valueClassName="text-green-500"
                />
                <StatCard
                  label="Losses"
                  value={hasGames && record ? `${record.losses}` : "—"}
                  valueClassName="text-red-600"
                />
                <StatCard
                  label="Ties"
                  value={hasGames && record ? `${record.ties}` : "—"}
                  valueClassName="text-ink"
                />
              </div>
            </div>
            <div className="rounded-2xl border border-amber-100 bg-white p-5">
              <p className="text-xs uppercase tracking-[0.2em] text-steel">
                Percentages
              </p>
              <div className="mt-4 grid gap-4 sm:grid-cols-3">
                <StatCard
                  label="Win %"
                  value={hasGames && record ? formatPercent(record.winPct) : "—"}
                  valueClassName="text-green-500"
                />
                <StatCard
                  label="Loss %"
                  value={formatPercent(lossPct)}
                  valueClassName="text-red-600"
                />
                <StatCard
                  label="Tie %"
                  value={formatPercent(tiePct)}
                  valueClassName="text-ink"
                />
              </div>
            </div>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-3">
            <StatCard
              label="Avg weekly return"
              value={stats ? formatPercent(stats.avgWeekly) : "—"}
              valueClassName={valueTone(stats?.avgWeekly ?? null)}
            />
            <StatCard
              label="Monthly return"
              value={stats ? formatPercent(stats.monthly) : "—"}
              valueClassName={valueTone(stats?.monthly ?? null)}
            />
            <StatCard
              label="Annualized return"
              value={stats ? formatPercent(stats.annualized) : "—"}
              valueClassName={valueTone(stats?.annualized ?? null)}
            />
            <StatCard
              label="Volatility"
              value={stats ? formatPercent(stats.stdDev) : "—"}
              valueClassName={valueTone(stats?.stdDev ?? null)}
            />
            <StatCard
              label="Alpha vs S&P 500"
              value={benchmark ? formatPercent(benchmark.alpha) : "—"}
              valueClassName={valueTone(benchmark?.alpha ?? null)}
            />
            <StatCard
              label="Beta vs S&P 500"
              value={benchmark ? formatNumber(benchmark.beta) : "—"}
              valueClassName={valueTone(benchmark?.beta ?? null)}
            />
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-100 bg-white p-4">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-steel">
                Compare charts
              </p>
              <p className="mt-1 text-sm text-steel">
                Overlay one league member on the charts.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                className="cursor-pointer rounded-full border border-amber-100 bg-white px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-70"
                value={compareUserId}
                onChange={(event) => setCompareUserId(event.target.value)}
                disabled={
                  compareOptions.length <= 1 ||
                  membersLoading ||
                  effectiveLeagueId === "all"
                }
              >
                {compareOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              {compareUserId !== "none" ? (
                <button
                  type="button"
                  onClick={() => setCompareUserId("none")}
                  className="rounded-full border border-amber-100 bg-white px-3 py-1.5 text-[10px] font-medium uppercase tracking-[0.18em] text-steel shadow-sm shadow-navy/10 transition hover:border-navy hover:bg-navy-soft hover:text-white"
                >
                  Clear comparison
                </button>
              ) : null}
            </div>
          </div>

          {compareError ? (
            <p className="mt-2 text-sm text-red-600">{compareError}</p>
          ) : null}
          {compareLoading ? (
            <p className="mt-2 text-sm text-steel">Loading comparison...</p>
          ) : null}

          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <LineChart
              primary={summary?.series.cumulative ?? []}
              secondary={summary?.series.benchmarkCumulative ?? []}
              tertiary={compareSeries?.cumulative ?? []}
              primaryLabel="You"
              secondaryLabel="S&P 500"
              tertiaryLabel={compareLineLabel}
              showCompareLegend={showCompareLegend}
              showSecondaryLegend={showCompareLegend}
              title="Cumulative return"
              subtitle={cumulativeSubtitle}
              description="Shows compounded performance over the selected weeks. Rising lines indicate growth; dips indicate drawdowns."
              emptyMessage={emptyMessage}
              showEmpty={showEmpty}
              xLabel="Weeks"
              yLabel="Cumulative (%)"
            />
            <BarChart
              values={summary?.series.portfolio ?? []}
              comparison={compareSeries?.portfolio ?? []}
              primaryLabel="You"
              comparisonLabel={compareLineLabel}
              showCompareLegend={showCompareLegend}
              title="Weekly returns"
              subtitle="Weekly performance snapshots"
              description="Each bar is that week's return, showing consistency and swings week to week."
              emptyMessage={emptyMessage}
              showEmpty={showEmpty}
              xLabel="Weeks"
              yLabel="Return (%)"
            />
          </div>
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <LineChart
              primary={summary?.series.weeklySharpe ?? []}
              secondary={[]}
              tertiary={compareSharpeSeries}
              primaryLabel="You"
              tertiaryLabel={compareLineLabel}
              showCompareLegend={showCompareLegend}
              title="Weekly Sharpe ratio"
              subtitle="Cumulative Sharpe by week"
              description="Sharpe compares return to volatility; values above 1.0 generally signal better risk-adjusted performance."
              emptyMessage={emptyMessage}
              showEmpty={showEmpty}
              xLabel="Weeks"
              yLabel="Sharpe"
              tickFormat={formatNumber}
            />
            <LineChart
              primary={summary?.series.weeklyBeta ?? []}
              secondary={[]}
              tertiary={compareSeries?.weeklyBeta ?? []}
              primaryLabel="You"
              tertiaryLabel={compareLineLabel}
              showCompareLegend={showCompareLegend}
              title="Weekly beta vs S&P 500"
              subtitle="Cumulative beta by week"
              description="Beta measures sensitivity to the S&P 500; above 1.0 moves more than the index, below 1.0 moves less."
              emptyMessage={emptyMessage}
              showEmpty={showEmpty}
              xLabel="Weeks"
              yLabel="Beta"
              tickFormat={formatNumber}
            />
            <LineChart
              primary={summary?.series.weeklyAlpha ?? []}
              secondary={[]}
              tertiary={compareSeries?.weeklyAlpha ?? []}
              primaryLabel="You"
              tertiaryLabel={compareLineLabel}
              showCompareLegend={showCompareLegend}
              title="Weekly alpha vs S&P 500"
              subtitle="Cumulative alpha by week"
              description="Alpha is excess return versus the S&P 500 after accounting for beta."
              emptyMessage={emptyMessage}
              showEmpty={showEmpty}
              xLabel="Weeks"
              yLabel="Alpha (%)"
            />
            <LineChart
              primary={summary?.series.weeklyVolatility ?? []}
              secondary={[]}
              tertiary={compareSeries?.weeklyVolatility ?? []}
              primaryLabel="You"
              tertiaryLabel={compareLineLabel}
              showCompareLegend={showCompareLegend}
              title="Weekly volatility"
              subtitle="Cumulative volatility by week"
              description="Volatility is the standard deviation of returns; higher values mean more variability."
              emptyMessage={emptyMessage}
              showEmpty={showEmpty}
              xLabel="Weeks"
              yLabel="Volatility (%)"
            />
          </div>
        </>
      ) : null}
    </section>
  );
}

import { NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { ALLOWED_TICKERS, getAssetName } from "@/lib/assets";
import { DEFAULT_BENCHMARK_TICKER } from "@/lib/benchmark";
import { ensureProfile } from "@/lib/profiles";
import { fetchFmpNews, fetchFmpProfile } from "@/lib/fmp";
import { fetchEdgarFundamentals } from "@/lib/edgar";

type UniverseMember = {
  ticker: string;
  company_name: string | null;
  sector: string | null;
  industry?: string | null;
};

type MonthlyYear = {
  year: number;
  months: (number | null)[];
};

type StockMetrics = {
  ticker: string;
  name: string | null;
  description?: string | null;
  marketCap: string | null;
  pe: string | null;
  beta: number | null;
  annualReturn: number | null;
  oneYearReturn: number | null;
  lastPrice?: number | null;
  asOf?: string | null;
  monthlyByYear: MonthlyYear[];
  revenue?: number | null;
  netIncome?: number | null;
  eps?: number | null;
  sharesOutstanding?: number | null;
  assets?: number | null;
  liabilities?: number | null;
  equity?: number | null;
};

type MetricKey = "volatility" | "return" | "beta" | "alpha" | "sharpe" | "pe" | "marketCap";

type WizyrdSuggestion = {
  ticker: string;
  name: string | null;
  sector: string | null;
  detail?: string | null;
};

type ReturnRequest = {
  horizonYears: number | null;
  annualized: boolean;
  period: "month" | "mtd" | "qtd" | "ytd" | null;
  month: number | null;
  year: number | null;
};

type WizyrdPayload = {
  reply?: string;
  suggestions?: WizyrdSuggestion[];
  coverage?: { available: number; total: number } | null;
  linkableTickers?: string[];
  contextTicker?: string | null;
  contextIntent?: "sentiment" | null;
  contextMetric?: MetricKey | null;
  error?: string;
};

const METRIC_KEYS: MetricKey[] = [
  "volatility",
  "return",
  "beta",
  "alpha",
  "sharpe",
  "pe",
  "marketCap"
];

const RETURN_WORD_NUMBERS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10
};

const SECTOR_ALIASES: Array<{ sector: string; aliases: string[] }> = [
  { sector: "Information Technology", aliases: ["tech", "technology", "software", "chip", "semiconductor"] },
  { sector: "Health Care", aliases: ["health", "healthcare", "pharma", "biotech", "medical"] },
  { sector: "Financials", aliases: ["financial", "financials", "bank", "banks", "insurance"] },
  { sector: "Energy", aliases: ["energy", "oil", "gas"] },
  { sector: "Utilities", aliases: ["utilities", "utility"] },
  { sector: "Industrials", aliases: ["industrial", "industrials", "aerospace", "defense", "machinery"] },
  { sector: "Consumer Staples", aliases: ["staples", "consumer staples"] },
  {
    sector: "Consumer Discretionary",
    aliases: ["discretionary", "consumer discretionary", "retail", "auto"]
  },
  {
    sector: "Communication Services",
    aliases: ["communication", "communications", "telecom", "media"]
  },
  { sector: "Real Estate", aliases: ["real estate", "reit"] },
  { sector: "Materials", aliases: ["materials", "mining", "chemicals"] }
];

const MONTH_LABELS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December"
];

const MONTH_ALIASES: Array<{ month: number; aliases: string[] }> = [
  { month: 0, aliases: ["january", "jan"] },
  { month: 1, aliases: ["february", "feb"] },
  { month: 2, aliases: ["march", "mar"] },
  { month: 3, aliases: ["april", "apr"] },
  { month: 4, aliases: ["may"] },
  { month: 5, aliases: ["june", "jun"] },
  { month: 6, aliases: ["july", "jul"] },
  { month: 7, aliases: ["august", "aug"] },
  { month: 8, aliases: ["september", "sep", "sept"] },
  { month: 9, aliases: ["october", "oct"] },
  { month: 10, aliases: ["november", "nov"] },
  { month: 11, aliases: ["december", "dec"] }
];

const MONTH_ALIAS_LOOKUP = new Map<string, number>();
MONTH_ALIASES.forEach((entry) => {
  entry.aliases.forEach((alias) => {
    MONTH_ALIAS_LOOKUP.set(alias, entry.month);
  });
});

const MONTH_PATTERN = MONTH_ALIASES.flatMap((entry) => entry.aliases)
  .sort((a, b) => b.length - a.length)
  .join("|");

const normalizeText = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const normalizeTicker = (value: string) => value.toUpperCase().trim();

const SECTOR_ALIAS_WORDS = new Set(
  SECTOR_ALIASES.flatMap((entry) =>
    entry.aliases
      .map((alias) => normalizeText(alias))
      .filter((alias) => alias && !alias.includes(" "))
  )
);

const MONTH_ALIAS_WORDS = new Set(
  MONTH_ALIASES.flatMap((entry) =>
    entry.aliases
      .map((alias) => normalizeText(alias))
      .filter((alias) => alias && !alias.includes(" "))
  )
);

const SPELLCHECK_WORDS = new Set([
  ...SECTOR_ALIAS_WORDS,
  "return",
  "returns",
  "volatility",
  "volatile",
  "risk",
  "sharpe",
  "alpha",
  "beta",
  "market",
  "cap",
  "marketcap",
  "performance",
  "growth",
  "annual",
  "annualized",
  "year",
  "years",
  "dividend",
  "yield",
  "value",
  "sector",
  "sectors",
  "stock",
  "stocks",
  "company",
  "companies",
  "universe",
  "sentiment",
  "help",
  "examples",
  "example",
  "overview",
  "description",
  "describe",
  "tell",
  "about",
  "what",
  "which",
  "with",
  "low",
  "high",
  "highest",
  "lowest",
  "top",
  "best",
  "give",
  "show",
  "list",
  "picks",
  "suggestions",
  "ideas",
  "member",
  "members",
  "constituent",
  "component",
  "included",
  "belong",
  "belongs",
  "part",
  "mtd",
  "ytd",
  "qtd",
  "month",
  "months",
  "quarter",
  "quarters",
  "qtr",
  "qtrs",
  "qtr",
  "qtrs",
  "date",
  "playground",
  "matchup",
  "matchups",
  "league",
  "leagues",
  "analytics",
  "optimal",
  "lineup",
  "overlay",
  "snapshot",
  "screener",
  "settings"
]);

SECTOR_ALIASES.forEach((entry) => {
  normalizeText(entry.sector)
    .split(" ")
    .filter(Boolean)
    .forEach((token) => SPELLCHECK_WORDS.add(token));
});

MONTH_ALIASES.forEach((entry) => {
  entry.aliases.forEach((alias) => {
    normalizeText(alias)
      .split(" ")
      .filter(Boolean)
      .forEach((token) => SPELLCHECK_WORDS.add(token));
  });
});

const SPELLCHECK_DICTIONARY = Array.from(SPELLCHECK_WORDS);

const QUESTION_WORDS = [
  "what",
  "who",
  "why",
  "how",
  "when",
  "where",
  "which",
  "do",
  "does",
  "can",
  "are",
  "is"
];
const STOCK_WORDS = new Set(["stock", "ticker", "symbol"]);

const editDistance = (left: string, right: string) => {
  const rows = left.length + 1;
  const cols = right.length + 1;
  const matrix = Array.from({ length: rows }, () => new Array(cols).fill(0));
  for (let i = 0; i < rows; i += 1) {
    matrix[i][0] = i;
  }
  for (let j = 0; j < cols; j += 1) {
    matrix[0][j] = j;
  }
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }
  return matrix[rows - 1][cols - 1];
};

const isSubsequence = (short: string, long: string) => {
  let index = 0;
  for (let i = 0; i < long.length && index < short.length; i += 1) {
    if (long[i] === short[index]) {
      index += 1;
    }
  }
  return index === short.length;
};

const autocorrectToken = (token: string, knownTickers: Set<string>) => {
  if (token.length < 3) {
    return token;
  }
  const upper = token.toUpperCase();
  if (knownTickers.has(upper)) {
    return token;
  }
  if (SPELLCHECK_WORDS.has(token)) {
    return token;
  }
  let best: { word: string; score: number } | null = null;
  for (const candidate of SPELLCHECK_DICTIONARY) {
    if (!candidate || candidate[0] !== token[0]) {
      continue;
    }
    const lengthDelta = Math.abs(candidate.length - token.length);
    if (token.length <= 3) {
      if (candidate.length <= 7 && isSubsequence(token, candidate)) {
        const score = lengthDelta;
        if (!best || score < best.score) {
          best = { word: candidate, score };
        }
      }
      continue;
    }
    if (lengthDelta > 3) {
      continue;
    }
    const distance = editDistance(token, candidate);
    const threshold = Math.max(1, Math.floor(candidate.length * 0.4));
    if (distance <= threshold) {
      if (!best || distance < best.score) {
        best = { word: candidate, score: distance };
      }
    }
  }
  return best?.word ?? token;
};

const autocorrectNormalized = (normalized: string, knownTickers: Set<string>) => {
  const tokens = normalized.split(" ").filter(Boolean);
  const corrected = tokens.map((token) => autocorrectToken(token, knownTickers));
  return corrected.join(" ");
};

const TOKEN_SYNONYMS: Record<string, string> = {
  rtn: "return",
  ret: "return",
  stck: "stock",
  stcks: "stocks",
  stcko: "stock",
  stk: "stock",
  vol: "volatility",
  annl: "annual",
  ann: "annual",
  yr: "year",
  qtr: "quarter",
  qtrs: "quarters",
  mth: "month",
  mths: "months"
};

const normalizePromptText = (value: string, knownTickers: Set<string>) => {
  const normalized = normalizeText(value);
  const corrected = autocorrectNormalized(normalized, knownTickers);
  const tokens = corrected
    .split(" ")
    .filter(Boolean)
    .map((token) => TOKEN_SYNONYMS[token] ?? token);
  return tokens.join(" ");
};

const isLikelyQuestionWord = (token: string) => {
  if (QUESTION_WORDS.includes(token)) {
    return true;
  }
  if (token.length < 3) {
    return false;
  }
  return QUESTION_WORDS.some(
    (word) =>
      Math.abs(word.length - token.length) <= 1 && editDistance(token, word) <= 1
  );
};

type PromptToken = {
  index: number;
  cleaned: string;
  upper: string;
  lower: string;
  corrected: string;
  hasTicker: boolean;
};

const tokenizePrompt = (prompt: string, knownTickers: Set<string>) => {
  const rawTokens = prompt.split(/\s+/).filter(Boolean);
  const tokens: PromptToken[] = [];
  rawTokens.forEach((raw, index) => {
    const cleaned = raw.replace(/[^a-zA-Z0-9.]/g, "");
    if (!cleaned) {
      return;
    }
    const upper = normalizeTicker(cleaned);
    const lower = cleaned.toLowerCase();
    const hasTicker = knownTickers.has(upper);
    const corrected =
      /^[a-zA-Z]+$/.test(cleaned) && !cleaned.includes(".")
        ? autocorrectToken(lower, knownTickers)
        : lower;
    tokens.push({ index, cleaned, upper, lower, corrected, hasTicker });
  });
  return tokens;
};

const parseLimit = (normalized: string) => {
  const match = normalized.match(/\b(\d{1,2})\b/);
  if (!match) {
    return 8;
  }
  const value = Number(match[1]);
  if (!Number.isFinite(value)) {
    return 8;
  }
  return Math.min(12, Math.max(3, value));
};

const detectSector = (normalized: string) => {
  for (const entry of SECTOR_ALIASES) {
    for (const alias of entry.aliases) {
      if (normalized.includes(alias)) {
        return entry.sector;
      }
    }
  }
  return null;
};

const SUBSECTOR_STOP_WORDS = [
  "stocks",
  "stock",
  "companies",
  "company",
  "names",
  "tickers",
  "ticker",
  "universe",
  "s&p 500",
  "sp 500",
  "sp500",
  "s and p 500"
];

const extractSubsectorQuery = (normalized: string) => {
  const match = normalized.match(/\b(?:in|within|for|about|around|focused on)\s+(.+)$/);
  if (!match) {
    return null;
  }
  let phrase = match[1];
  SUBSECTOR_STOP_WORDS.forEach((word) => {
    phrase = phrase.replace(new RegExp(`\\b${word}\\b`, "g"), "");
  });
  const cleaned = phrase.trim();
  return cleaned.length >= 3 ? cleaned : null;
};

const TICKER_ALIASES: Array<{ alias: string; ticker: string }> = [
  { alias: "google", ticker: "GOOG" },
  { alias: "alphabet", ticker: "GOOG" },
  { alias: "apple", ticker: "AAPL" },
  { alias: "microsoft", ticker: "MSFT" },
  { alias: "amazon", ticker: "AMZN" },
  { alias: "meta", ticker: "META" },
  { alias: "facebook", ticker: "META" },
  { alias: "tesla", ticker: "TSLA" },
  { alias: "nvidia", ticker: "NVDA" },
  { alias: "s p 500", ticker: "SPY" },
  { alias: "sp 500", ticker: "SPY" },
  { alias: "sandp 500", ticker: "SPY" },
  { alias: "s&p 500", ticker: "SPY" }
];

const detectMetric = (normalized: string): MetricKey | null => {
  if (normalized.includes("volatility") || normalized.includes("volatile") || normalized.includes("risk")) {
    return "volatility";
  }
  if (/\bsharpe\b/.test(normalized)) {
    return "sharpe";
  }
  if (/\balpha\b/.test(normalized)) {
    return "alpha";
  }
  if (normalized.includes("beta")) {
    return "beta";
  }
  if (
    normalized.includes("mtd") ||
    normalized.includes("month to date") ||
    normalized.includes("month-to-date") ||
    normalized.includes("ytd") ||
    normalized.includes("year to date") ||
    normalized.includes("year-to-date") ||
    normalized.includes("qtd") ||
    normalized.includes("quarter to date") ||
    normalized.includes("quarter-to-date")
  ) {
    return "return";
  }
  if (normalized.includes("return") || normalized.includes("returns") || normalized.includes("performance") || normalized.includes("growth")) {
    return "return";
  }
  if (/\bp e\b/.test(normalized) || /\bpe\b/.test(normalized) || normalized.includes("valuation") || normalized.includes("value")) {
    return "pe";
  }
  if (normalized.includes("market cap") || normalized.includes("large cap") || normalized.includes("small cap") || normalized.includes("mega cap")) {
    return "marketCap";
  }
  return null;
};

const detectDirection = (normalized: string, metric: MetricKey | null) => {
  const wantsLow =
    normalized.includes("low") ||
    normalized.includes("lower") ||
    normalized.includes("lowest") ||
    normalized.includes("defensive") ||
    normalized.includes("stable") ||
    normalized.includes("conservative") ||
    normalized.includes("small");
  const wantsHigh =
    normalized.includes("high") ||
    normalized.includes("higher") ||
    normalized.includes("highest") ||
    normalized.includes("top") ||
    normalized.includes("best") ||
    normalized.includes("aggressive") ||
    normalized.includes("large") ||
    normalized.includes("mega");

  if (metric === "volatility") {
    return wantsHigh ? "desc" : "asc";
  }
  if (metric === "return") {
    return wantsLow ? "asc" : "desc";
  }
  if (metric === "sharpe") {
    return wantsLow ? "asc" : "desc";
  }
  if (metric === "beta") {
    return wantsLow ? "asc" : "desc";
  }
  if (metric === "alpha") {
    return wantsLow ? "asc" : "desc";
  }
  if (metric === "pe") {
    return wantsHigh ? "desc" : "asc";
  }
  if (metric === "marketCap") {
    return wantsLow ? "asc" : "desc";
  }
  return "desc";
};

const parseMonthYearRequest = (normalized: string) => {
  if (!MONTH_PATTERN) {
    return null;
  }
  const forwardMatch = normalized.match(
    new RegExp(`\\b(${MONTH_PATTERN})\\s+(\\d{4})\\b`)
  );
  if (forwardMatch) {
    const monthIndex = MONTH_ALIAS_LOOKUP.get(forwardMatch[1]);
    const year = Number(forwardMatch[2]);
    if (monthIndex !== undefined && Number.isFinite(year)) {
      return { month: monthIndex, year };
    }
  }
  const backwardMatch = normalized.match(
    new RegExp(`\\b(\\d{4})\\s+(${MONTH_PATTERN})\\b`)
  );
  if (backwardMatch) {
    const monthIndex = MONTH_ALIAS_LOOKUP.get(backwardMatch[2]);
    const year = Number(backwardMatch[1]);
    if (monthIndex !== undefined && Number.isFinite(year)) {
      return { month: monthIndex, year };
    }
  }
  return null;
};

const parseReturnRequest = (normalized: string) => {
  const monthYear = parseMonthYearRequest(normalized);
  if (monthYear) {
    return {
      horizonYears: null,
      annualized: false,
      period: "month" as const,
      month: monthYear.month,
      year: monthYear.year
    };
  }

  const mtd =
    normalized.includes("mtd") || normalized.includes("month to date");
  const qtd =
    normalized.includes("qtd") || normalized.includes("quarter to date");
  const ytd =
    normalized.includes("ytd") || normalized.includes("year to date");
  if (mtd || qtd || ytd) {
    return {
      horizonYears: null,
      annualized: false,
      period: mtd ? ("mtd" as const) : qtd ? ("qtd" as const) : ("ytd" as const),
      month: null,
      year: null
    };
  }

  let horizonYears: number | null = null;
  const numericMatch = normalized.match(/\b(\d{1,2})\s*(?:year|years|yr|yrs|y)\b/);
  if (numericMatch) {
    const value = Number(numericMatch[1]);
    if (Number.isFinite(value) && value > 0) {
      horizonYears = value;
    }
  }
  if (!horizonYears) {
    for (const [word, value] of Object.entries(RETURN_WORD_NUMBERS)) {
      if (
        normalized.includes(`${word} year`) ||
        normalized.includes(`${word} years`) ||
        normalized.includes(`${word} yr`) ||
        normalized.includes(`${word} yrs`)
      ) {
        horizonYears = value;
        break;
      }
    }
  }
  if (
    !horizonYears &&
    (normalized.includes("one year") ||
      normalized.includes("1 year") ||
      normalized.includes("1y"))
  ) {
    horizonYears = 1;
  }
  const annualized =
    normalized.includes("annualized") || normalized.includes("annualised");
  const annual = !annualized && normalized.includes("annual");
  if (!horizonYears && annual) {
    horizonYears = 1;
  }
  return {
    horizonYears,
    annualized,
    period: null,
    month: null,
    year: null
  };
};

const wantsHelp = (normalized: string) =>
  normalized.includes("help") ||
  normalized.includes("examples") ||
  normalized.includes("what can you do") ||
  normalized.includes("how do");

const wantsDividend = (normalized: string) =>
  normalized.includes("dividend") || normalized.includes("yield");

const isListIntent = (normalized: string) =>
  normalized.includes("stocks") ||
  normalized.includes("companies") ||
  normalized.includes("suggestions") ||
  normalized.includes("ideas") ||
  normalized.includes("picks") ||
  normalized.includes("list") ||
  normalized.includes("show me") ||
  normalized.includes("give me") ||
  normalized.includes("top") ||
  normalized.includes("best") ||
  normalized.includes("highest") ||
  normalized.includes("lowest");

const wantsDescription = (normalized: string) =>
  normalized.includes("description") ||
  normalized.includes("describe") ||
  normalized.includes("overview") ||
  normalized.includes("company profile") ||
  normalized.includes("tell me about") ||
  normalized.includes("what is") ||
  normalized.includes("what does") ||
  normalized.includes("about");

const wantsAffirmation = (normalized: string) =>
  normalized.includes("yes") ||
  normalized.includes("sure") ||
  normalized.includes("ok") ||
  normalized.includes("okay") ||
  normalized.includes("please") ||
  normalized.includes("go ahead") ||
  normalized.includes("sounds good") ||
  normalized.includes("yep") ||
  normalized.includes("yeah");

const shouldUseContextTicker = (normalized: string, metric: MetricKey | null) =>
  Boolean(metric) || wantsAffirmation(normalized);

const detectAppTopic = (normalized: string) => {
  if (normalized.includes("playground")) {
    return "playground";
  }
  if (normalized.includes("matchup") || normalized.includes("matchups")) {
    return "matchup";
  }
  if (
    normalized.includes("league hub") ||
    normalized.includes("league page") ||
    normalized.includes("leagues") ||
    normalized.includes("league")
  ) {
    return "league";
  }
  if (normalized.includes("lineup")) {
    return "lineup";
  }
  if (normalized.includes("analytics")) {
    return "analytics";
  }
  if (normalized.includes("optimal lineup") || normalized.includes("optimal portfolio")) {
    return "optimal";
  }
  if (normalized.includes("overlay")) {
    return "overlay";
  }
  if (normalized.includes("company snapshot") || normalized.includes("snapshot")) {
    return "snapshot";
  }
  if (normalized.includes("screener") || normalized.includes("screen")) {
    return "screener";
  }
  if (normalized.includes("settings") || normalized.includes("account settings")) {
    return "settings";
  }
  return null;
};

const buildAppTopicReply = (topic: string) => {
  switch (topic) {
    case "playground":
      return "Playground is where you explore the S&P 500 universe: company snapshots, overlay charts, a stock screener, and the optimal lineup builder. Use it to compare tickers, test ideas, and build sample portfolios.";
    case "matchup":
      return "Matchup shows head-to-head league results for the current week, including live performance, locked lineups, and standings context.";
    case "league":
      return "League Hub is your home for leagues. You can create or join leagues, select a league, and review standings and matchups.";
    case "analytics":
      return "Analytics summarizes your record and performance metrics, plus charts for returns, Sharpe, beta, alpha, and volatility across timeframes.";
    case "optimal":
      return "Optimal Lineup builds a hypothetical portfolio based on your objective (return, Sharpe, beta, alpha, or volatility) using the S&P 500 universe.";
    case "overlay":
      return "Overlay lets you compare selected tickers on a shared chart and see how they track against each other and the benchmark.";
    case "snapshot":
      return "Company Snapshot shows a single ticker’s overview, fundamentals, and key metrics so you can quickly evaluate a stock.";
    case "screener":
      return "Screener filters the S&P 500 by sector and metrics so you can narrow the universe to a focused list.";
    case "settings":
      return "Settings lets you manage your profile, logo, and (if you’re an admin) account tools and league oversight.";
    case "lineup":
      return "Lineup is where you set your weekly weights before lock. Add tickers, make sure weights sum to 100%, and save before the deadline.";
    default:
      return null;
  }
};

const wantsReturnBreakdown = (normalized: string) => {
  const mentionsAnnual =
    normalized.includes("annual") || normalized.includes("annualized");
  const mentionsOneYear =
    normalized.includes("1 year") || normalized.includes("one year") || normalized.includes("1y");
  return mentionsAnnual && mentionsOneYear;
};

const mentionsSp500 = (normalized: string) =>
  normalized.includes("s p 500") ||
  normalized.includes("s and p 500") ||
  normalized.includes("sp 500") ||
  normalized.includes("sandp 500") ||
  normalized.includes("sp500") ||
  normalized.includes("s p") ||
  normalized.includes("s and p");

const isMembershipIntent = (normalized: string) => {
  const tokens = normalized.split(" ").filter(Boolean);
  const mentionsIndex =
    mentionsSp500(normalized) || tokens.includes("universe");
  if (!mentionsIndex) {
    return false;
  }
  const hasIn = tokens.includes("in");
  const hasMember = tokens.includes("member") || tokens.includes("members");
  const hasConstituent =
    tokens.includes("constituent") ||
    tokens.includes("component") ||
    tokens.includes("included");
  const hasBelong =
    tokens.includes("belong") ||
    tokens.includes("belongs") ||
    tokens.includes("included");
  const hasPhrase = normalized.includes("part of");
  return hasIn || hasMember || hasConstituent || hasBelong || hasPhrase;
};

const wantsSentiment = (normalized: string) =>
  normalized.includes("sentiment") ||
  normalized.includes("bullish") ||
  normalized.includes("bearish") ||
  normalized.includes("outlook") ||
  normalized.includes("vibe") ||
  normalized.includes("catalyst") ||
  normalized.includes("catalysts") ||
  normalized.includes("news");

const wantsOwnership = (normalized: string) =>
  normalized.includes("who owns") ||
  normalized.includes("owner of") ||
  normalized.includes("owned by") ||
  normalized.includes("ownership") ||
  normalized.includes("parent company") ||
  normalized.includes("parent co") ||
  normalized.includes("parent");

const wantsOutOfUniverseInfo = (normalized: string) => {
  const mentionsOutside =
    normalized.includes("not in the universe") ||
    normalized.includes("outside the universe") ||
    normalized.includes("outside the sp 500") ||
    normalized.includes("outside the s p 500") ||
    normalized.includes("not in the sp 500") ||
    normalized.includes("not in the s p 500") ||
    normalized.includes("outside the s and p") ||
    normalized.includes("not in the s and p");
  if (!mentionsOutside) {
    return false;
  }
  return (
    normalized.includes("can you") ||
    normalized.includes("are you") ||
    normalized.includes("are you able") ||
    normalized.includes("able to") ||
    normalized.includes("do you") ||
    normalized.includes("could you")
  );
};

type WikipediaSummary = {
  title?: string;
  extract?: string;
  type?: string;
};

type WikipediaSearchResult = {
  title?: string;
  snippet?: string;
};

const fetchWikipediaSummary = async (query: string): Promise<WikipediaSummary | null> => {
  try {
    const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(
      query
    )}`;
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Wizyrd Markets (news lookup)"
      }
    });
    if (!response.ok) {
      return null;
    }
    const data = (await response.json()) as WikipediaSummary;
    if (data?.type === "disambiguation") {
      return null;
    }
    return data;
  } catch (_error) {
    return null;
  }
};

const fetchWikipediaSearch = async (
  query: string
): Promise<WikipediaSearchResult[]> => {
  try {
    const url = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(
      query
    )}&format=json&origin=*`;
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Wizyrd Markets (news lookup)"
      }
    });
    if (!response.ok) {
      return [];
    }
    const data = (await response.json()) as {
      query?: { search?: WikipediaSearchResult[] };
    };
    return data?.query?.search ?? [];
  } catch (_error) {
    return [];
  }
};

const isLikelyCompanyTitle = (title: string) => {
  const normalized = title.toLowerCase();
  return (
    normalized.includes("corporation") ||
    normalized.includes("company") ||
    normalized.includes("inc") ||
    normalized.includes("plc") ||
    normalized.includes("group") ||
    normalized.includes("holdings")
  );
};

const isIrrelevantOwnershipSummary = (extract: string) => {
  const normalized = extract.toLowerCase();
  const unrelatedTerms = ["festival", "season", "holiday", "celebration", "pre-lenten"];
  const companyTerms = ["company", "corporation", "inc", "plc", "group", "holdings"];
  const hasUnrelated = unrelatedTerms.some((term) => normalized.includes(term));
  const hasCompany = companyTerms.some((term) => normalized.includes(term));
  return hasUnrelated && !hasCompany;
};

const summarizeOwnership = (extract?: string | null) => {
  if (!extract) {
    return null;
  }
  const trimmed = extract.trim();
  if (!trimmed) {
    return null;
  }
  const firstSentence = trimmed.split(/\.\\s/)[0] ?? trimmed;
  const sentence = firstSentence.endsWith(".") ? firstSentence : `${firstSentence}.`;
  const lower = trimmed.toLowerCase();
  const publicHint =
    lower.includes("publicly traded") ||
    lower.includes("public company") ||
    lower.includes("publicly listed") ||
    lower.includes("nyse") ||
    lower.includes("nasdaq");
  const publicNote = publicHint
    ? " It is publicly traded, so ownership is held by shareholders."
    : "";
  return `${sentence}${publicNote}`;
};

const extractMonthlySeries = (metrics: StockMetrics) => {
  const ordered = [...(metrics.monthlyByYear ?? [])].sort((a, b) => a.year - b.year);
  const values: number[] = [];
  ordered.forEach((row) => {
    row.months.forEach((value) => {
      if (value === null || value === undefined) {
        return;
      }
      values.push(value);
    });
  });
  return values;
};

const computeAnnualizedReturn = (returns: number[]) => {
  if (!returns.length) {
    return null;
  }
  const compounded = returns.reduce((total, value) => total * (1 + value), 1);
  return Math.pow(compounded, 12 / returns.length) - 1;
};

const computeCumulativeReturn = (returns: number[]) =>
  returns.reduce((total, value) => total * (1 + value), 1) - 1;

const computeTrailingReturn = (returns: number[], months: number) => {
  if (returns.length < months) {
    return null;
  }
  return computeCumulativeReturn(returns.slice(-months));
};

const getLatestMonthlyPoint = (metrics: StockMetrics) => {
  const ordered = [...(metrics.monthlyByYear ?? [])].sort((a, b) => a.year - b.year);
  for (let yearIndex = ordered.length - 1; yearIndex >= 0; yearIndex -= 1) {
    const row = ordered[yearIndex];
    for (let monthIndex = row.months.length - 1; monthIndex >= 0; monthIndex -= 1) {
      const value = row.months[monthIndex];
      if (value !== null && value !== undefined) {
        return { year: row.year, month: monthIndex, value };
      }
    }
  }
  return null;
};

const getMonthlyReturn = (metrics: StockMetrics, year: number, month: number) => {
  const row = (metrics.monthlyByYear ?? []).find((entry) => entry.year === year);
  if (!row) {
    return null;
  }
  const value = row.months[month];
  return value === null || value === undefined ? null : value;
};

const computePeriodReturn = (
  metrics: StockMetrics,
  year: number,
  startMonth: number,
  endMonth: number
) => {
  const row = (metrics.monthlyByYear ?? []).find((entry) => entry.year === year);
  if (!row) {
    return null;
  }
  const slice = row.months.slice(startMonth, endMonth + 1);
  if (!slice.length || slice.some((value) => value === null || value === undefined)) {
    return null;
  }
  return computeCumulativeReturn(slice as number[]);
};

const calculateStdDev = (values: number[]) => {
  if (!values.length) {
    return null;
  }
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
};

const mean = (values: number[]) =>
  values.reduce((sum, value) => sum + value, 0) / values.length;

const computeSharpe = (returns: number[]) => {
  if (!returns.length) {
    return null;
  }
  const avg = mean(returns);
  const vol = calculateStdDev(returns);
  if (vol === null || vol === 0) {
    return 0;
  }
  return avg / vol;
};

const computeBetaAlpha = (portfolio: number[], benchmark: number[]) => {
  if (portfolio.length === 0 || benchmark.length === 0) {
    return { beta: null, alpha: null };
  }
  if (portfolio.length < 2 || benchmark.length < 2) {
    return { beta: 0, alpha: portfolio[0] - benchmark[0] };
  }

  const avgPortfolio = mean(portfolio);
  const avgBenchmark = mean(benchmark);
  const covariance =
    portfolio.reduce(
      (sum, value, index) => sum + (value - avgPortfolio) * (benchmark[index] - avgBenchmark),
      0
    ) /
    (portfolio.length - 1);
  const variance =
    benchmark.reduce((sum, value) => sum + (value - avgBenchmark) ** 2, 0) /
    (benchmark.length - 1);

  if (variance === 0) {
    return { beta: null, alpha: null };
  }

  const beta = covariance / variance;
  const alpha = avgPortfolio - beta * avgBenchmark;

  return { beta, alpha };
};

const computeAnnualizedVolatility = (returns: number[]) => {
  const stdDev = calculateStdDev(returns);
  return stdDev === null ? null : stdDev * Math.sqrt(12);
};

const parseNumeric = (value: string | null | undefined) => {
  if (!value) {
    return null;
  }
  const numeric = Number(value.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(numeric) ? numeric : null;
};

const buildFundamentalInputs = (
  metrics: StockMetrics | null,
  profile: { mktCap?: number | null; pe?: number | null } | null,
  edgar?: {
    revenue?: number | null;
    netIncome?: number | null;
    eps?: number | null;
    sharesOutstanding?: number | null;
    assets?: number | null;
    liabilities?: number | null;
    equity?: number | null;
  } | null
) => {
  const price = metrics?.lastPrice ?? null;
  const epsValue = metrics?.eps ?? edgar?.eps ?? null;
  const derivedPe =
    price !== null && epsValue !== null && epsValue !== 0
      ? price / epsValue
      : null;
  const sharesOutstanding =
    metrics?.sharesOutstanding ?? edgar?.sharesOutstanding ?? null;
  const derivedMarketCap =
    price !== null && sharesOutstanding !== null
      ? price * sharesOutstanding
      : null;
  const marketCap =
    parseMarketCap(metrics?.marketCap ?? null) ??
    profile?.mktCap ??
    derivedMarketCap ??
    null;
  const peValue =
    parseNumeric(metrics?.pe ?? null) ??
    profile?.pe ??
    (derivedPe !== null && Number.isFinite(derivedPe) ? derivedPe : null);
  return {
    peValue,
    marketCap,
    revenue: metrics?.revenue ?? edgar?.revenue ?? null,
    netIncome: metrics?.netIncome ?? edgar?.netIncome ?? null,
    eps: epsValue,
    assets: metrics?.assets ?? edgar?.assets ?? null,
    liabilities: metrics?.liabilities ?? edgar?.liabilities ?? null,
    equity: metrics?.equity ?? edgar?.equity ?? null
  };
};

const needsEdgarFundamentals = (metrics: StockMetrics | null) =>
  !metrics?.revenue &&
  !metrics?.netIncome &&
  !metrics?.eps &&
  !metrics?.assets &&
  !metrics?.liabilities &&
  !metrics?.equity;

const truncateText = (value: string, maxLength: number) => {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
};

const buildDescriptionSnippet = (description: string | null, maxSentences = 2) => {
  if (!description) {
    return null;
  }
  const cleaned = description.replace(/\s+/g, " ").trim();
  if (!cleaned) {
    return null;
  }
  const sentenceMatches = cleaned.match(/[^.!?]+[.!?]+/g);
  if (sentenceMatches && sentenceMatches.length) {
    const snippet = sentenceMatches.slice(0, maxSentences).join(" ").trim();
    return truncateText(snippet, 360);
  }
  return truncateText(cleaned, 360);
};

const buildFallbackSummary = (name: string | null, sectorLabel: string | null) => {
  if (!name) {
    return null;
  }
  if (sectorLabel) {
    return `${name} operates in ${sectorLabel}.`;
  }
  return `${name} is a company in the Wizyrd universe.`;
};

const formatAsOf = (value?: string | null) => {
  if (!value) {
    return null;
  }
  return value.slice(0, 10);
};

const formatMetricDetails = (metrics: StockMetrics | null) => {
  if (!metrics) {
    return null;
  }
  const parts: string[] = [];
  if (metrics.marketCap) {
    parts.push(`Market cap ${metrics.marketCap}`);
  }
  if (metrics.pe) {
    parts.push(`P/E ${metrics.pe}`);
  }
  if (metrics.beta !== null && Number.isFinite(metrics.beta)) {
    parts.push(`Beta ${metrics.beta.toFixed(2)}`);
  }
  const returnValue = metrics.oneYearReturn ?? metrics.annualReturn ?? null;
  const returnLabel = formatPercent(returnValue);
  if (returnLabel) {
    parts.push(`1Y return ${returnLabel}`);
  }
  return parts.length ? parts.join(" · ") : null;
};

const COMMON_NAME_WORDS = new Set([
  "inc",
  "incorporated",
  "corp",
  "corporation",
  "company",
  "co",
  "ltd",
  "plc",
  "class",
  "holdings",
  "group",
  "limited",
  "international"
]);

const extractNameKeywords = (name: string) =>
  normalizeText(name)
    .split(" ")
    .filter((word) => word.length >= 3 && !COMMON_NAME_WORDS.has(word));

const findTickerByName = (normalizedPrompt: string, list: UniverseMember[]) => {
  const promptWords = new Set(normalizedPrompt.split(" ").filter(Boolean));
  let best: { ticker: string; score: number } | null = null;
  list.forEach((member) => {
    const name = member.company_name ?? getAssetName(member.ticker) ?? "";
    if (!name) {
      return;
    }
    const keywords = extractNameKeywords(name);
    if (!keywords.length) {
      return;
    }
    const matches = keywords.filter((word) => promptWords.has(word)).length;
    if (keywords.length === 1 && matches === 1) {
      if (!best || matches > best.score) {
        best = { ticker: member.ticker, score: matches };
      }
      return;
    }
    if (keywords.length > 1) {
      const ratio = matches / keywords.length;
      if (matches >= 2 && ratio >= 0.6) {
        if (!best || matches > best.score) {
          best = { ticker: member.ticker, score: matches };
        }
      }
    }
  });
  return best?.ticker ?? null;
};

const buildSuggestionText = (
  suggestions: Array<{ ticker: string; name: string | null }>
) => {
  if (!suggestions.length) {
    return null;
  }
  const labels = suggestions.map(({ ticker, name }) =>
    name ? `${ticker} (${name})` : ticker
  );
  if (labels.length === 1) {
    return `Did you mean ${labels[0]}?`;
  }
  if (labels.length === 2) {
    return `Did you mean ${labels[0]} or ${labels[1]}?`;
  }
  return `Did you mean ${labels.slice(0, -1).join(", ")} or ${
    labels[labels.length - 1]
  }?`;
};

const suggestTickersFromPrompt = (
  prompt: string,
  list: UniverseMember[],
  knownTickers: Set<string>
) => {
  const normalized = normalizeText(prompt);
  const tokens = normalized
    .split(" ")
    .filter(Boolean)
    .filter((token) => !STOPWORDS.has(token) && !SECTOR_ALIAS_WORDS.has(token));
  const candidates = tokens.filter((token) => token.length >= 2 && token.length <= 6);
  if (!candidates.length) {
    return [];
  }
  const suggestions: Array<{ ticker: string; name: string | null; score: number }> = [];
  candidates.forEach((candidate) => {
    const upper = normalizeTicker(candidate);
    if (knownTickers.has(upper)) {
      return;
    }
    const maxDistance = candidate.length <= 3 ? 1 : 2;
    list.forEach((member) => {
      const ticker = normalizeTicker(member.ticker);
      const name = member.company_name ?? getAssetName(ticker) ?? null;
      const tickerDistance = editDistance(candidate, ticker.toLowerCase());
      if (tickerDistance <= maxDistance) {
        suggestions.push({ ticker, name, score: tickerDistance });
        return;
      }
      if (!name) {
        return;
      }
      const words = normalizeText(name).split(" ").filter(Boolean);
      const bestWord = words.reduce((best, word) => {
        if (word.length < 3) {
          return best;
        }
        const distance = editDistance(candidate, word);
        return Math.min(best, distance);
      }, Number.POSITIVE_INFINITY);
      if (Number.isFinite(bestWord) && bestWord <= 1) {
        suggestions.push({ ticker, name, score: bestWord + 0.5 });
      }
    });
  });
  if (!suggestions.length) {
    return [];
  }
  const deduped = new Map<string, { ticker: string; name: string | null; score: number }>();
  suggestions.forEach((entry) => {
    const existing = deduped.get(entry.ticker);
    if (!existing || entry.score < existing.score) {
      deduped.set(entry.ticker, entry);
    }
  });
  return Array.from(deduped.values())
    .sort((a, b) => a.score - b.score)
    .slice(0, 3)
    .map(({ ticker, name }) => ({ ticker, name }));
};

const STOPWORDS = new Set([
  "a",
  "about",
  "and",
  "are",
  "as",
  "at",
  "annual",
  "annualized",
  "for",
  "from",
  "give",
  "go",
  "ahead",
  "do",
  "does",
  "you",
  "your",
  "have",
  "has",
  "access",
  "able",
  "can",
  "could",
  "would",
  "should",
  "info",
  "information",
  "is",
  "me",
  "my",
  "of",
  "on",
  "or",
  "ok",
  "okay",
  "please",
  "tell",
  "the",
  "to",
  "what",
  "which",
  "who",
  "with",
  "low",
  "high",
  "highest",
  "lowest",
  "top",
  "best",
  "sure",
  "yes",
  "yeah",
  "yep",
  "lets",
  "let",
  "see",
  "year",
  "years",
  "yr",
  "volatility",
  "return",
  "returns",
  "beta",
  "alpha",
  "sharpe",
  "growth",
  "sentiment",
  "universe",
  "outside",
  "beyond",
  "mtd",
  "ytd",
  "qtd",
  "month",
  "months",
  "quarter",
  "quarters",
  "date",
  "stock",
  "stocks",
  ...SECTOR_ALIAS_WORDS,
  ...MONTH_ALIAS_WORDS
]);

const extractTickerFromPrompt = (
  prompt: string,
  normalizedPrompt: string,
  knownTickers: Set<string>,
  list: UniverseMember[]
) => {
  for (const alias of TICKER_ALIASES) {
    if (normalizedPrompt.includes(alias.alias)) {
      const candidate = normalizeTicker(alias.ticker);
      if (knownTickers.has(candidate)) {
        return candidate;
      }
    }
  }
  const nameMatch = findTickerByName(normalizedPrompt, list);
  if (nameMatch) {
    return normalizeTicker(nameMatch);
  }
  const tokens = tokenizePrompt(prompt, knownTickers);
  const candidates = tokens.filter((token) => {
    if (!token.hasTicker) {
      return false;
    }
    if (isLikelyQuestionWord(token.lower)) {
      return false;
    }
    if (STOPWORDS.has(token.lower) || STOPWORDS.has(token.corrected)) {
      return false;
    }
    return true;
  });
  if (!candidates.length) {
    const stockIndex = tokens.findIndex((token) => STOCK_WORDS.has(token.corrected));
    if (stockIndex >= 0) {
      const afterStock = tokens.find((token) => token.index === stockIndex + 1);
      if (
        afterStock &&
        !isLikelyQuestionWord(afterStock.lower) &&
        afterStock.cleaned.length >= 2 &&
        afterStock.cleaned.length <= 7 &&
        /[a-zA-Z]/.test(afterStock.cleaned)
      ) {
        return normalizeTicker(afterStock.cleaned);
      }
    }
    return null;
  }
  const stockIndex = tokens.findIndex((token) => STOCK_WORDS.has(token.corrected));
  if (stockIndex >= 0) {
    const afterStock = candidates.find((candidate) => candidate.index === stockIndex + 1);
    if (afterStock) {
      return afterStock.upper;
    }
    const fallback = tokens.find((token) => token.index === stockIndex + 1);
    if (
      fallback &&
      !isLikelyQuestionWord(fallback.lower) &&
      fallback.cleaned.length >= 2 &&
      fallback.cleaned.length <= 7 &&
      /[a-zA-Z]/.test(fallback.cleaned)
    ) {
      return normalizeTicker(fallback.cleaned);
    }
  }
  if (candidates.length === 1) {
    return candidates[0].upper;
  }
  return candidates[candidates.length - 1].upper;
};

const extractExplicitTicker = (prompt: string, knownTickers: Set<string>) => {
  const tokens = prompt
    .split(/\s+/)
    .map((token) => token.replace(/[^a-zA-Z0-9.$]/g, ""))
    .filter(Boolean);
  for (const token of tokens) {
    const hasDollar = token.startsWith("$");
    const cleaned = hasDollar ? token.slice(1) : token;
    if (!cleaned) {
      continue;
    }
    const lower = cleaned.toLowerCase();
    const isAllCaps =
      cleaned === cleaned.toUpperCase() && cleaned !== cleaned.toLowerCase();
    const hasNumberOrDot = /[0-9.]/.test(cleaned);
    const isExplicit = hasDollar || isAllCaps || hasNumberOrDot;
    if (!hasDollar && !hasNumberOrDot && STOPWORDS.has(lower) && lower.length <= 3) {
      continue;
    }
    if (STOPWORDS.has(lower) && !isExplicit) {
      continue;
    }
    const candidate = normalizeTicker(cleaned);
    if (!knownTickers.has(candidate)) {
      continue;
    }
    if (isExplicit) {
      return candidate;
    }
  }
  return null;
};

const MEMBERSHIP_STOPWORDS = new Set([
  ...STOPWORDS,
  "s",
  "p",
  "sp",
  "s&p",
  "500"
]);

const extractTickerCandidate = (prompt: string, knownTickers: Set<string>) => {
  const tokens = tokenizePrompt(prompt, knownTickers);
  if (!tokens.length) {
    return null;
  }
  const stockIndex = tokens.findIndex((token) => STOCK_WORDS.has(token.corrected));
  if (stockIndex >= 0) {
    const afterStock = tokens.find((token) => token.index === stockIndex + 1);
    if (
      afterStock &&
      !isLikelyQuestionWord(afterStock.lower) &&
      afterStock.cleaned.length >= 2 &&
      afterStock.cleaned.length <= 7 &&
      /[a-zA-Z]/.test(afterStock.cleaned)
    ) {
      return normalizeTicker(afterStock.cleaned);
    }
  }
  const knownCandidates = tokens.filter((token) => {
    if (!token.hasTicker) {
      return false;
    }
    if (isLikelyQuestionWord(token.lower)) {
      return false;
    }
    if (STOPWORDS.has(token.lower) || STOPWORDS.has(token.corrected)) {
      return false;
    }
    return true;
  });
  if (knownCandidates.length) {
    const lastKnown = knownCandidates[knownCandidates.length - 1];
    if (!isLikelyQuestionWord(lastKnown.lower)) {
      return lastKnown.upper;
    }
  }
  if (stockIndex >= 0) {
    const candidate = tokens.find(
      (token) =>
        token.index === stockIndex + 1 &&
        token.cleaned.length >= 2 &&
        token.cleaned.length <= 7 &&
        /[a-zA-Z]/.test(token.cleaned) &&
        !MEMBERSHIP_STOPWORDS.has(token.lower) &&
        !isLikelyQuestionWord(token.lower)
    );
    if (candidate) {
      return normalizeTicker(candidate.cleaned);
    }
  }
  for (const token of tokens) {
    if (MEMBERSHIP_STOPWORDS.has(token.lower)) {
      continue;
    }
    if (STOPWORDS.has(token.lower) || STOPWORDS.has(token.corrected)) {
      continue;
    }
    if (token.cleaned.length < 2 || token.cleaned.length > 7) {
      continue;
    }
    if (!/[a-zA-Z]/.test(token.cleaned)) {
      continue;
    }
    if (isLikelyQuestionWord(token.lower)) {
      continue;
    }
    return normalizeTicker(token.cleaned);
  }
  return null;
};

const extractTickerForMembership = (
  prompt: string,
  normalizedPrompt: string,
  knownTickers: Set<string>,
  list: UniverseMember[]
) => {
  const explicit = extractExplicitTicker(prompt, knownTickers);
  if (explicit) {
    return explicit;
  }
  const nameMatch = findTickerByName(normalizedPrompt, list);
  if (nameMatch) {
    return normalizeTicker(nameMatch);
  }
  const candidate = extractTickerCandidate(prompt, knownTickers);
  if (candidate) {
    return candidate;
  }
  return null;
};
const parseMarketCap = (value: string | null | undefined) => {
  if (!value) {
    return null;
  }
  const match = value.trim().match(/([0-9.]+)\s*([TBM])/i);
  if (!match) {
    return parseNumeric(value);
  }
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) {
    return null;
  }
  const unit = match[2].toUpperCase();
  const multiplier = unit === "T" ? 1e12 : unit === "B" ? 1e9 : 1e6;
  return amount * multiplier;
};

const formatPercent = (value: number | null) => {
  if (value === null || !Number.isFinite(value)) {
    return null;
  }
  return `${(value * 100).toFixed(2)}%`;
};

const formatNumber = (value: number | null, decimals = 2) => {
  if (value === null || !Number.isFinite(value)) {
    return null;
  }
  return value.toFixed(decimals);
};

const formatMarketCap = (value: number | null) => {
  if (value === null || !Number.isFinite(value)) {
    return null;
  }
  if (value >= 1e12) {
    return `${(value / 1e12).toFixed(2)}T`;
  }
  if (value >= 1e9) {
    return `${(value / 1e9).toFixed(1)}B`;
  }
  return `${(value / 1e6).toFixed(1)}M`;
};

const resolveReturnLabel = (request: ReturnRequest, normalized: string) => {
  if (request.period === "month" && request.month !== null && request.year) {
    const monthName = MONTH_LABELS[request.month] ?? "Month";
    return `${monthName} ${request.year} return`;
  }
  if (request.period === "mtd") {
    return "MTD return";
  }
  if (request.period === "qtd") {
    return "QTD return";
  }
  if (request.period === "ytd") {
    return "YTD return";
  }
  const years = request.horizonYears;
  if (years && years > 1) {
    return `${years}Y ${request.annualized ? "annualized " : ""}return`;
  }
  if (years === 1) {
    return "1Y return";
  }
  if (request.annualized) {
    return "Annualized return";
  }
  if (normalized.includes("annual")) {
    return "Annual return";
  }
  return "Return";
};

const resolveMetricLabel = (
  metric: MetricKey,
  normalized: string,
  returnRequest: ReturnRequest
) => {
  if (metric === "return") {
    return resolveReturnLabel(returnRequest, normalized);
  }
  if (metric === "volatility") {
    return "Volatility";
  }
  if (metric === "sharpe") {
    return "Sharpe ratio";
  }
  if (metric === "beta") {
    return "Beta";
  }
  if (metric === "alpha") {
    return "Alpha";
  }
  if (metric === "pe") {
    return "P/E";
  }
  if (metric === "marketCap") {
    return "Market cap";
  }
  return "Metric";
};

const resolveMetricValue = (
  metric: MetricKey,
  metrics: StockMetrics,
  benchmarkReturns: number[] | undefined,
  returnRequest: ReturnRequest
) => {
  const monthlyReturns = extractMonthlySeries(metrics);
  if (metric === "volatility") {
    return computeAnnualizedVolatility(monthlyReturns);
  }
  if (metric === "sharpe") {
    return computeSharpe(monthlyReturns);
  }
  if (metric === "return") {
    if (
      returnRequest.period === "month" &&
      returnRequest.month !== null &&
      returnRequest.year
    ) {
      return getMonthlyReturn(
        metrics,
        returnRequest.year,
        returnRequest.month
      );
    }
    if (returnRequest.period === "mtd") {
      const latest = getLatestMonthlyPoint(metrics);
      if (!latest) {
        return null;
      }
      return computePeriodReturn(metrics, latest.year, latest.month, latest.month);
    }
    if (returnRequest.period === "qtd") {
      const latest = getLatestMonthlyPoint(metrics);
      if (!latest) {
        return null;
      }
      const quarterStart = Math.floor(latest.month / 3) * 3;
      return computePeriodReturn(metrics, latest.year, quarterStart, latest.month);
    }
    if (returnRequest.period === "ytd") {
      const latest = getLatestMonthlyPoint(metrics);
      if (!latest) {
        return null;
      }
      return computePeriodReturn(metrics, latest.year, 0, latest.month);
    }
    const horizonYears = returnRequest.horizonYears ?? 1;
    if (horizonYears <= 1) {
      return (
        metrics.oneYearReturn ??
        metrics.annualReturn ??
        computeTrailingReturn(monthlyReturns, 12)
      );
    }
    const total = computeTrailingReturn(monthlyReturns, horizonYears * 12);
    if (total === null) {
      return null;
    }
    if (returnRequest.annualized) {
      return Math.pow(1 + total, 1 / horizonYears) - 1;
    }
    return total;
  }
  if (metric === "beta") {
    return metrics.beta ?? null;
  }
  if (metric === "alpha") {
    if (!benchmarkReturns || !benchmarkReturns.length) {
      return null;
    }
    const length = Math.min(monthlyReturns.length, benchmarkReturns.length);
    if (length === 0) {
      return null;
    }
    const alignedPortfolio = monthlyReturns.slice(-length);
    const alignedBenchmark = benchmarkReturns.slice(-length);
    const { alpha } = computeBetaAlpha(alignedPortfolio, alignedBenchmark);
    return alpha ?? null;
  }
  if (metric === "pe") {
    return parseNumeric(metrics.pe);
  }
  if (metric === "marketCap") {
    return parseMarketCap(metrics.marketCap);
  }
  return null;
};

const resolveReturnVariants = (metrics: StockMetrics) => {
  const monthlyReturns = extractMonthlySeries(metrics);
  const oneYear =
    metrics.oneYearReturn ?? computeTrailingReturn(monthlyReturns, 12);
  const annualized = metrics.annualReturn ?? oneYear;
  return { oneYear, annualized };
};

const formatMetricValue = (
  metric: MetricKey,
  value: number | null,
  metrics: StockMetrics
) => {
  if (metric === "marketCap") {
    return metrics.marketCap ?? formatMarketCap(value);
  }
  if (metric === "pe") {
    return formatNumber(value, 1);
  }
  if (metric === "beta") {
    return formatNumber(value, 2);
  }
  if (metric === "alpha") {
    return formatPercent(value);
  }
  if (metric === "sharpe") {
    return formatNumber(value, 2);
  }
  if (metric === "volatility" || metric === "return") {
    return formatPercent(value);
  }
  return formatNumber(value, 2);
};

const sentimentFromScore = (score: number) => {
  if (score > 0) {
    return "Bullish";
  }
  if (score < 0) {
    return "Bearish";
  }
  return "Neutral";
};

type NewsSentimentItem = {
  title: string;
  summary?: string | null;
};

const NEWS_SENTIMENT_TTL_MS = 5 * 60 * 1000;
const NEWS_SENTIMENT_CACHE = new Map<
  string,
  { updatedAt: number; items: NewsSentimentItem[] }
>();
const RSS_USER_AGENT = "Mozilla/5.0 (Wizyrd News)";

const decodeXml = (value: string) =>
  value
    .replace(/^<!\[CDATA\[/, "")
    .replace(/\]\]>$/, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");

const stripHtml = (value: string) =>
  value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

const extractTag = (block: string, tag: string) => {
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  if (!match) {
    return null;
  }
  return decodeXml(match[1].trim());
};

const parseRssItemsForSentiment = (rssText: string, limit: number) => {
  const blocks = rssText.match(/<item>[\s\S]*?<\/item>/gi) ?? [];
  const items: NewsSentimentItem[] = [];
  for (const block of blocks) {
    const title = extractTag(block, "title");
    if (!title) {
      continue;
    }
    const description =
      extractTag(block, "content:encoded") ?? extractTag(block, "description");
    const summaryText = description ? stripHtml(description) : "";
    items.push({ title, summary: summaryText || null });
    if (items.length >= limit) {
      break;
    }
  }
  return items;
};

const fetchRssSentimentItems = async (
  cacheKey: string,
  url: string,
  limit: number
) => {
  const cached = NEWS_SENTIMENT_CACHE.get(cacheKey);
  if (cached && Date.now() - cached.updatedAt < NEWS_SENTIMENT_TTL_MS) {
    return cached.items;
  }
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": RSS_USER_AGENT,
        Accept: "application/rss+xml"
      }
    });
    if (!response.ok) {
      return [];
    }
    const rssText = await response.text();
    const items = parseRssItemsForSentiment(rssText, limit);
    NEWS_SENTIMENT_CACHE.set(cacheKey, { updatedAt: Date.now(), items });
    return items;
  } catch (_error) {
    return [];
  }
};

const POSITIVE_NEWS_TERMS = [
  "beat",
  "beats",
  "surge",
  "rally",
  "gain",
  "strong",
  "record",
  "upgrade",
  "upgrades",
  "raise",
  "raises",
  "growth",
  "bullish",
  "positive",
  "profit",
  "wins",
  "outperform",
  "buy"
];

const NEGATIVE_NEWS_TERMS = [
  "miss",
  "misses",
  "drop",
  "drops",
  "fall",
  "falls",
  "plunge",
  "weak",
  "downgrade",
  "downgrades",
  "cut",
  "cuts",
  "lawsuit",
  "investigation",
  "bearish",
  "negative",
  "loss",
  "decline",
  "risk",
  "sell"
];

const analyzeNewsSentiment = (
  items: Array<{ title: string; text?: string | null; summary?: string | null }>
) => {
  if (!items.length) {
    return { label: "Unavailable", score: 0, detail: null as string | null };
  }
  let positive = 0;
  let negative = 0;
  const analyzed = items.slice(0, 8);
  analyzed.forEach((item) => {
    const text = `${item.title} ${item.text ?? item.summary ?? ""}`.toLowerCase();
    POSITIVE_NEWS_TERMS.forEach((term) => {
      if (text.includes(term)) {
        positive += 1;
      }
    });
    NEGATIVE_NEWS_TERMS.forEach((term) => {
      if (text.includes(term)) {
        negative += 1;
      }
    });
  });
  const score = positive - negative;
  const label = sentimentFromScore(score);
  const detail = `based on ${analyzed.length} headlines`;
  return { label, score, detail };
};

const technicalSentiment = (metrics: StockMetrics | null) => {
  if (!metrics) {
    return { label: "Unavailable", score: 0, detail: null as string | null };
  }
  const monthlyReturns = extractMonthlySeries(metrics);
  const oneYear =
    metrics.oneYearReturn ??
    metrics.annualReturn ??
    computeTrailingReturn(monthlyReturns, 12);
  const sixMonth = computeTrailingReturn(monthlyReturns, 6);
  const threeMonth = computeTrailingReturn(monthlyReturns, 3);
  const signals: string[] = [];
  let score = 0;
  const applySignal = (value: number | null, label: string) => {
    if (value === null || !Number.isFinite(value)) {
      return;
    }
    const formatted = formatPercent(value);
    if (formatted) {
      signals.push(`${label} ${formatted}`);
    }
    if (value >= 0.03) {
      score += 1;
    } else if (value <= -0.03) {
      score -= 1;
    }
  };
  applySignal(threeMonth, "3M");
  applySignal(sixMonth, "6M");
  applySignal(oneYear, "1Y");
  if (!signals.length) {
    return { label: "Unavailable", score: 0, detail: null as string | null };
  }
  return {
    label: sentimentFromScore(score),
    score,
    detail: signals.join(", ")
  };
};

const fundamentalSentiment = (inputs: {
  peValue: number | null;
  marketCap: number | null;
  revenue: number | null;
  netIncome: number | null;
  eps: number | null;
  assets: number | null;
  liabilities: number | null;
  equity: number | null;
}) => {
  const details: string[] = [];
  let score = 0;
  const { peValue, marketCap, revenue, netIncome, eps, assets, liabilities, equity } = inputs;

  if (peValue !== null && Number.isFinite(peValue)) {
    const peScore = peValue <= 15 ? 1 : peValue >= 30 ? -1 : 0;
    score += peScore;
    details.push(`P/E ${formatNumber(peValue, 1)}`);
  }

  if (revenue !== null && netIncome !== null && Number.isFinite(revenue)) {
    const margin = revenue !== 0 ? netIncome / revenue : null;
    if (margin !== null && Number.isFinite(margin)) {
      if (margin >= 0.1) {
        score += 1;
      } else if (margin <= 0) {
        score -= 1;
      }
      const formatted = formatPercent(margin);
      if (formatted) {
        details.push(`Net margin ${formatted}`);
      }
    }
  }

  if (
    liabilities !== null &&
    equity !== null &&
    Number.isFinite(liabilities) &&
    Number.isFinite(equity) &&
    equity !== 0
  ) {
    const leverage = liabilities / equity;
    if (Number.isFinite(leverage)) {
      if (leverage <= 1) {
        score += 1;
      } else if (leverage >= 2) {
        score -= 1;
      }
      details.push(`Leverage ${formatNumber(leverage, 2)}x`);
    }
  }

  if (eps !== null && Number.isFinite(eps)) {
    if (eps > 0) {
      score += 1;
    } else if (eps < 0) {
      score -= 1;
    }
    details.push(`EPS ${formatNumber(eps, 2)}`);
  }

  if (!details.length && marketCap !== null && Number.isFinite(marketCap)) {
    details.push(`Market cap ${formatMarketCap(marketCap)}`);
  }

  if (!details.length && assets !== null && liabilities !== null) {
    const coverage = assets - liabilities;
    if (Number.isFinite(coverage)) {
      details.push(`Net assets ${formatMarketCap(coverage)}`);
    }
  }

  if (!details.length) {
    return {
      label: "Neutral",
      score: 0,
      detail: "Limited fundamentals available"
    };
  }

  return {
    label: sentimentFromScore(score),
    score,
    detail: details.join(", ")
  };
};

const buildMetricDetail = (
  metric: MetricKey,
  metrics: StockMetrics,
  value: number | null,
  returnRequest: ReturnRequest,
  normalized: string
) => {
  if (metric === "volatility") {
    const formatted = formatPercent(value);
    return formatted ? `Volatility: ${formatted}` : null;
  }
  if (metric === "return") {
    const formatted = formatPercent(value);
    const label = resolveReturnLabel(returnRequest, normalized);
    return formatted ? `${label}: ${formatted}` : null;
  }
  if (metric === "sharpe") {
    const formatted = formatNumber(value, 2);
    return formatted ? `Sharpe: ${formatted}` : null;
  }
  if (metric === "beta") {
    const formatted = formatNumber(value, 2);
    return formatted ? `Beta: ${formatted}` : null;
  }
  if (metric === "alpha") {
    const formatted = formatPercent(value);
    return formatted ? `Alpha: ${formatted}` : null;
  }
  if (metric === "pe") {
    const formatted = formatNumber(value, 1);
    return formatted ? `P/E: ${formatted}` : null;
  }
  if (metric === "marketCap") {
    const label = metrics.marketCap ?? formatMarketCap(value);
    return label ? `Market cap: ${label}` : null;
  }
  return null;
};

const describeMetric = (
  metric: MetricKey,
  direction: "asc" | "desc",
  returnRequest: ReturnRequest,
  normalized: string
) => {
  if (metric === "volatility") {
    return direction === "asc" ? "low volatility" : "high volatility";
  }
  if (metric === "return") {
    const label = resolveReturnLabel(returnRequest, normalized).toLowerCase();
    return direction === "asc" ? `low ${label}` : `high ${label}`;
  }
  if (metric === "sharpe") {
    return direction === "asc" ? "low Sharpe" : "high Sharpe";
  }
  if (metric === "beta") {
    return direction === "asc" ? "low beta" : "high beta";
  }
  if (metric === "alpha") {
    return direction === "asc" ? "low alpha" : "high alpha";
  }
  if (metric === "pe") {
    return direction === "asc" ? "low P/E" : "high P/E";
  }
  if (metric === "marketCap") {
    return direction === "asc" ? "small cap" : "large cap";
  }
  return "";
};

const loadUniverse = async () => {
  let supabase: ReturnType<typeof createSupabaseServiceClient> | null = null;
  try {
    supabase = createSupabaseServiceClient();
  } catch (_error) {
    const fallback = [...ALLOWED_TICKERS].map((ticker) => ({
      ticker,
      company_name: getAssetName(ticker) || null,
      sector: null,
      industry: null
    }));
    return { supabase: null, list: fallback };
  }

  const { data: snapshot, error: snapshotError } = await supabase
    .from("asset_universe_snapshots")
    .select("id")
    .order("as_of", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (snapshotError || !snapshot?.id) {
    const fallback = [...ALLOWED_TICKERS].map((ticker) => ({
      ticker,
      company_name: getAssetName(ticker) || null,
      sector: null,
      industry: null
    }));
    return { supabase, list: fallback };
  }

  const { data, error } = await supabase
    .from("asset_universe_members")
    .select("ticker, company_name, sector, industry")
    .eq("snapshot_id", snapshot.id)
    .order("company_name", { ascending: true })
    .limit(1000);

  if (error) {
    const fallback = [...ALLOWED_TICKERS].map((ticker) => ({
      ticker,
      company_name: getAssetName(ticker) || null,
      sector: null,
      industry: null
    }));
    return { supabase, list: fallback };
  }

  return { supabase, list: (data ?? []) as UniverseMember[] };
};

const loadCachedMetric = async (
  supabase: ReturnType<typeof createSupabaseServiceClient>,
  ticker: string
) => {
  const { data } = await supabase
    .from("market_data_snapshots")
    .select("payload")
    .eq("ticker", ticker)
    .maybeSingle();
  if (!data?.payload) {
    return null;
  }
  return data.payload as StockMetrics;
};

const loadCachedMetrics = async (
  supabase: ReturnType<typeof createSupabaseServiceClient>,
  tickers: string[]
) => {
  const { data } = await supabase
    .from("market_data_snapshots")
    .select("ticker, payload")
    .in("ticker", tickers);
  const map = new Map<string, StockMetrics>();
  (data ?? []).forEach((row) => {
    if (row?.payload) {
      map.set(row.ticker, row.payload as StockMetrics);
    }
  });
  return map;
};

const shouldIgnoreLogError = (error?: { code?: string | null; message?: string | null }) =>
  error?.code === "42P01" ||
  error?.code === "PGRST205" ||
  Boolean(error?.message?.includes("schema cache"));

const logWizyrdPrompt = async ({
  userId,
  prompt,
  response,
  userEmail
}: {
  userId: string | null;
  prompt: string;
  response?: string | null;
  userEmail?: string | null;
}) => {
  try {
    const supabase = createSupabaseServiceClient();
    const logPayload =
      response === undefined
        ? { user_id: userId, prompt, user_email: userEmail ?? null }
        : { user_id: userId, prompt, response, user_email: userEmail ?? null };
    const { error } = await supabase.from("wizyrd_prompt_logs").insert(logPayload);
    if (error?.code === "42703") {
      await supabase.from("wizyrd_prompt_logs").insert({
        user_id: userId,
        prompt
      });
      return;
    }
    if (error && !shouldIgnoreLogError(error)) {
      // ignore unexpected log failures
    }
  } catch (_error) {
    // ignore logging failures
  }
};

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) {
    return NextResponse.json({ error: "Missing prompt." }, { status: 400 });
  }

  const { user } = await getAuthenticatedUser(request);
  const requestedContext =
    typeof body?.contextTicker === "string" ? body.contextTicker.trim() : "";
  const requestedContextIntent =
    typeof body?.contextIntent === "string" ? body.contextIntent.trim() : "";
  const requestedContextMetric =
    typeof body?.contextMetric === "string" ? body.contextMetric.trim() : "";

  if (user) {
    try {
      await ensureProfile(user);
    } catch (_error) {
      // ignore profile sync failures
    }
  }
  const respond = async (payload: WizyrdPayload, status = 200) => {
    const responseText = payload.reply ?? payload.error ?? null;
    if (responseText) {
      void logWizyrdPrompt({
        userId: user?.id ?? null,
        prompt,
        response: responseText,
        userEmail: user?.email ?? null
      });
    }
    return NextResponse.json(payload, { status });
  };

  const { supabase, list } = await loadUniverse();
  const universeTickers = new Set(list.map((member) => normalizeTicker(member.ticker)));
  const knownTickers = new Set(
    [...universeTickers, ...ALLOWED_TICKERS].map(normalizeTicker)
  );
  knownTickers.add(DEFAULT_BENCHMARK_TICKER);
  const contextTicker =
    requestedContext && universeTickers.has(normalizeTicker(requestedContext))
      ? normalizeTicker(requestedContext)
      : null;
  const contextIntent =
    requestedContextIntent.toLowerCase() === "sentiment" ? "sentiment" : null;
  const contextMetric = METRIC_KEYS.includes(requestedContextMetric as MetricKey)
    ? (requestedContextMetric as MetricKey)
    : null;
  const normalized = normalizePromptText(prompt, knownTickers);

  if (wantsDividend(normalized)) {
    return respond({
      reply:
        "Dividend data is not available in the free cache yet. Try sector, return, volatility, beta, value, or market cap.",
      suggestions: []
    });
  }

  const limit = parseLimit(normalized);
  const promptTokens = normalized.split(" ").filter(Boolean);
  const sector = detectSector(normalized);
  const subsectorQuery = !sector ? extractSubsectorQuery(normalized) : null;
  const metric = detectMetric(normalized);
  const baseReturnRequest = parseReturnRequest(normalized);
  const returnRequest =
    metric === "return" &&
    !baseReturnRequest.horizonYears &&
    !baseReturnRequest.period
      ? { ...baseReturnRequest, horizonYears: 1 }
      : baseReturnRequest;
  const direction = detectDirection(normalized, metric);
  const listIntent = isListIntent(normalized);
  const wantsAppHelp = promptTokens.some((token) =>
    ["what", "how", "does", "do", "explain", "help", "page", "screen"].includes(
      token
    )
  );
  const appTopic = detectAppTopic(normalized);
  let membershipIntent = isMembershipIntent(normalized);
  const followupSentiment =
    contextIntent === "sentiment" &&
    !wantsSentiment(normalized) &&
    !metric &&
    !listIntent &&
    !sector;

  if (
    !membershipIntent &&
    (mentionsSp500(normalized) || normalized.includes("universe"))
  ) {
    const candidate = extractTickerCandidate(prompt, knownTickers);
    if (candidate) {
      membershipIntent = true;
    }
  }

  const isAppFollowup =
    !metric &&
    !listIntent &&
    !sector &&
    !membershipIntent &&
    !wantsSentiment(normalized) &&
    promptTokens.length <= 6;

  if (appTopic && (wantsAppHelp || isAppFollowup)) {
    const reply = buildAppTopicReply(appTopic);
    if (reply) {
      return respond({ reply, suggestions: [] });
    }
  }

  if (wantsOutOfUniverseInfo(normalized)) {
    const capabilityTicker =
      extractExplicitTicker(prompt, knownTickers) ??
      findTickerByName(normalized, list);
    if (!capabilityTicker) {
      return respond({
        reply:
          "Yes — I focus on the S&P 500 for full metrics, but I can still give a basic overview or recent news for tickers outside the universe if you provide one. Which ticker should I check?",
        suggestions: []
      });
    }
    const inUniverse = universeTickers.has(capabilityTicker);
    if (!inUniverse) {
      return respond({
        reply: `I can provide limited info for ${capabilityTicker} even though it is not in the current S&P 500 universe. Want a quick overview?`,
        suggestions: []
      });
    }
  }

  if (wantsOwnership(normalized)) {
    const ownershipTicker =
      extractTickerForMembership(prompt, normalized, knownTickers, list) ??
      contextTicker ??
      null;
    if (!ownershipTicker) {
      return respond({
        reply: "Which company or ticker should I look up ownership for?",
        suggestions: []
      });
    }
    const member =
      list.find((entry) => normalizeTicker(entry.ticker) === ownershipTicker) ?? null;
    const profile = await fetchFmpProfile(ownershipTicker);
    const name =
      profile?.companyName ??
      member?.company_name ??
      getAssetName(ownershipTicker) ??
      ownershipTicker;
    const searchQueries = [
      `${name} company`,
      `${name} corporation`,
      `${name} plc`,
      `${ownershipTicker} company`,
      name,
      ownershipTicker
    ];
    let summary: WikipediaSummary | null = null;
    for (const query of searchQueries) {
      if (!query) {
        continue;
      }
      const results = await fetchWikipediaSearch(query);
      const rankedTitles = results
        .map((result) => result.title)
        .filter(Boolean) as string[];
      const preferred =
        rankedTitles.find((title) => isLikelyCompanyTitle(title)) ??
        rankedTitles[0] ??
        null;
      if (preferred) {
        summary = await fetchWikipediaSummary(preferred);
      }
      if (!summary) {
        summary = await fetchWikipediaSummary(query);
      }
      if (summary?.extract && !isIrrelevantOwnershipSummary(summary.extract)) {
        break;
      }
      summary = null;
    }
    const ownershipSummary = summarizeOwnership(summary?.extract ?? null);
    if (!ownershipSummary) {
      return respond({
        reply: `I don't have reliable ownership details for ${name} right now.`,
        suggestions: [],
        linkableTickers: universeTickers.has(ownershipTicker) ? [ownershipTicker] : []
      });
    }
    const label =
      name && ownershipTicker
        ? `${ownershipTicker} (${name})`
        : ownershipTicker;
    return respond({
      reply: `${label}: ${ownershipSummary}`,
      suggestions: [],
      linkableTickers: universeTickers.has(ownershipTicker) ? [ownershipTicker] : [],
      contextTicker: universeTickers.has(ownershipTicker) ? ownershipTicker : null
    });
  }

  if (wantsSentiment(normalized) || followupSentiment) {
    const wantsRandom =
      normalized.includes("random") ||
      normalized.includes("any random") ||
      normalized.includes("give me a random");
    if (wantsRandom && listIntent && supabase) {
      const eligible = list.filter(
        (member) => member.ticker !== DEFAULT_BENCHMARK_TICKER
      );
      const metricsMap = await loadCachedMetrics(
        supabase,
        eligible.map((member) => member.ticker)
      );
      const bearishCandidates: UniverseMember[] = [];
      eligible.forEach((member) => {
        const metrics = metricsMap.get(member.ticker);
        if (!metrics) {
          return;
        }
        const technical = technicalSentiment(metrics);
        if (technical.score < 0) {
          bearishCandidates.push(member);
        }
      });
      if (!bearishCandidates.length) {
        return respond({
          reply:
            "I couldn't find a bearish sentiment name in the cached S&P 500 data yet. Try again in a bit.",
          suggestions: []
        });
      }
      const pick =
        bearishCandidates[Math.floor(Math.random() * bearishCandidates.length)];
      const pickTicker = normalizeTicker(pick.ticker);
      const metrics = metricsMap.get(pickTicker) ?? null;
      const profile = await fetchFmpProfile(pickTicker);
      const name =
        pick.company_name ??
        metrics?.name ??
        profile?.companyName ??
        getAssetName(pickTicker) ??
        null;
      const descriptionSnippet = buildDescriptionSnippet(
        metrics?.description ?? profile?.description ?? null
      );
      const technical = technicalSentiment(metrics);
      const edgar = needsEdgarFundamentals(metrics)
        ? await fetchEdgarFundamentals(pickTicker)
        : null;
      const fundamentalInputs = buildFundamentalInputs(metrics, profile, edgar);
      const fundamental = fundamentalSentiment(fundamentalInputs);
      const newsItems = await fetchFmpNews({ ticker: pickTicker, limit: 8 });
      const queryName =
        name ?? getAssetName(pickTicker) ?? pickTicker;
      const yahooItems = await fetchRssSentimentItems(
        `${pickTicker}:yahoo`,
        `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(
          pickTicker
        )}&region=US&lang=en-US`,
        6
      );
      const googleItems = await fetchRssSentimentItems(
        `${pickTicker}:google`,
        `https://news.google.com/rss/search?q=${encodeURIComponent(
          `${queryName} stock`
        )}&hl=en-US&gl=US&ceid=US:en`,
        6
      );
      const news = analyzeNewsSentiment([
        ...newsItems.map((item) => ({ title: item.title, summary: item.text })),
        ...yahooItems,
        ...googleItems
      ]);
      const technicalLine = technical.detail
        ? `• Technical: ${technical.label} (${technical.detail})`
        : `• Technical: ${technical.label}`;
      const fundamentalLine = fundamental.detail
        ? `• Fundamental: ${fundamental.label} (${fundamental.detail})`
        : `• Fundamental: ${fundamental.label}`;
      const newsLine = news.detail
        ? `• News: ${news.label} (${news.detail})`
        : `• News: ${news.label}`;
      const reply = [
        `Here’s a random S&P 500 stock with bearish technical sentiment: ${pickTicker}${
          name ? ` (${name})` : ""
        }.`,
        technicalLine,
        fundamentalLine,
        newsLine,
        descriptionSnippet ?? null,
        "Want metrics like return, beta, alpha, Sharpe, or volatility?"
      ]
        .filter(Boolean)
        .join(" ");
      return respond({
        reply,
        suggestions: [],
        linkableTickers: [pickTicker],
        contextTicker: pickTicker,
        contextIntent: "sentiment"
      });
    }
    const followupTicker =
      followupSentiment && !wantsSentiment(normalized)
        ? extractTickerForMembership(prompt, normalized, knownTickers, list) ??
          extractTickerCandidate(prompt, knownTickers) ??
          contextTicker ??
          null
        : null;
    const sentimentTicker =
      (wantsSentiment(normalized)
        ? extractTickerForMembership(prompt, normalized, knownTickers, list)
        : null) ??
      followupTicker ??
      contextTicker ??
      null;
    if (!sentimentTicker) {
      return respond({
        reply: "Which stock do you want sentiment on?",
        suggestions: [],
        contextIntent: "sentiment"
      });
    }
    if (!universeTickers.has(sentimentTicker)) {
      const suggestions = suggestTickersFromPrompt(prompt, list, knownTickers);
      const suggestionLine = buildSuggestionText(suggestions);
      return respond({
        reply: suggestionLine
          ? `${sentimentTicker} is not in the current S&P 500 universe, so sentiment isn't available. ${suggestionLine}`
          : `${sentimentTicker} is not in the current S&P 500 universe, so sentiment isn't available.`,
        suggestions: [],
        contextIntent: "sentiment"
      });
    }
    const metrics = supabase
      ? await loadCachedMetric(supabase, sentimentTicker)
      : null;
    const profile = await fetchFmpProfile(sentimentTicker);
    const name =
      metrics?.name ??
      profile?.companyName ??
      getAssetName(sentimentTicker) ??
      null;
    const technical = technicalSentiment(metrics);
    const edgar = needsEdgarFundamentals(metrics)
      ? await fetchEdgarFundamentals(sentimentTicker)
      : null;
    const fundamentalInputs = buildFundamentalInputs(metrics, profile, edgar);
    const fundamental = fundamentalSentiment(fundamentalInputs);
    const newsItems = await fetchFmpNews({ ticker: sentimentTicker, limit: 8 });
    const queryName =
      name ?? getAssetName(sentimentTicker) ?? sentimentTicker;
    const yahooItems = await fetchRssSentimentItems(
      `${sentimentTicker}:yahoo`,
      `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(
        sentimentTicker
      )}&region=US&lang=en-US`,
      6
    );
    const googleItems = await fetchRssSentimentItems(
      `${sentimentTicker}:google`,
      `https://news.google.com/rss/search?q=${encodeURIComponent(
        `${queryName} stock`
      )}&hl=en-US&gl=US&ceid=US:en`,
      6
    );
    const news = analyzeNewsSentiment([
      ...newsItems.map((item) => ({ title: item.title, summary: item.text })),
      ...yahooItems,
      ...googleItems
    ]);
    if (!metrics && !profile && !newsItems.length) {
      return respond({
        reply: `Sentiment for ${sentimentTicker} is not available yet.`,
        suggestions: [],
        contextTicker: sentimentTicker,
        contextIntent: "sentiment"
      });
    }
    const overallScore = technical.score + fundamental.score + news.score;
    const overallLabel = sentimentFromScore(overallScore);
    const header = name
      ? `Overall sentiment for ${sentimentTicker} (${name}) is ${overallLabel}.`
      : `Overall sentiment for ${sentimentTicker} is ${overallLabel}.`;
    const technicalLine = technical.detail
      ? `• Technical: ${technical.label} (${technical.detail})`
      : `• Technical: ${technical.label}`;
    const fundamentalLine = fundamental.detail
      ? `• Fundamental: ${fundamental.label} (${fundamental.detail})`
      : `• Fundamental: ${fundamental.label}`;
    const newsLine = news.detail
      ? `• News: ${news.label} (${news.detail})`
      : `• News: ${news.label}`;
    return respond({
      reply: [header, technicalLine, fundamentalLine, newsLine].join(" "),
      suggestions: [],
      linkableTickers: [sentimentTicker],
      contextTicker: sentimentTicker,
      contextIntent: "sentiment"
    });
  }

  const wantsReturnClarifier =
    contextTicker &&
    (contextMetric === "return" || metric === "return") &&
    wantsReturnBreakdown(normalized);

  if (wantsReturnClarifier && contextTicker) {
    const clarifierTicker =
      extractExplicitTicker(prompt, knownTickers) ??
      extractTickerFromPrompt(prompt, normalized, knownTickers, list);
    if (!clarifierTicker || clarifierTicker === contextTicker) {
      const metrics = supabase ? await loadCachedMetric(supabase, contextTicker) : null;
      if (!metrics) {
        return respond({
          reply: `Return data for ${contextTicker} is not available yet.`,
          suggestions: [],
          linkableTickers: [contextTicker],
          contextTicker,
          contextMetric: "return"
        });
      }
      const { oneYear, annualized } = resolveReturnVariants(metrics);
      const oneYearLabel = formatPercent(oneYear);
      const annualLabel = formatPercent(annualized);
      const parts: string[] = [];
      if (oneYearLabel) {
        parts.push(`1Y return ${oneYearLabel}`);
      }
      if (annualLabel && annualLabel !== oneYearLabel) {
        parts.push(`Annualized return ${annualLabel}`);
      }
      if (!parts.length) {
        return respond({
          reply: `Return data for ${contextTicker} is not available yet.`,
          suggestions: [],
          linkableTickers: [contextTicker],
          contextTicker,
          contextMetric: "return"
        });
      }
      const annualNote =
        annualLabel && annualLabel === oneYearLabel
          ? " Annualized returns require a multi-year window (e.g., 3Y annualized)."
          : "";
      const reply = `For ${contextTicker}, ${parts.join(" · ")}.${annualNote}`;
      return respond({
        reply,
        suggestions: [],
        linkableTickers: [contextTicker],
        contextTicker,
        contextMetric: "return"
      });
    }
  }

  if (membershipIntent) {
    const membershipTicker =
      extractTickerForMembership(prompt, normalized, knownTickers, list) ??
      (contextTicker ?? null);
    if (!membershipTicker) {
      return respond({
        reply: "Tell me which ticker you want to check in the S&P 500 universe.",
        suggestions: []
      });
    }
    const isMember = universeTickers.has(membershipTicker);
    const member =
      list.find((entry) => normalizeTicker(entry.ticker) === membershipTicker) ?? null;
    const metrics = supabase
      ? await loadCachedMetric(supabase, membershipTicker)
      : null;
    const profile =
      !metrics?.description && !metrics?.name
        ? await fetchFmpProfile(membershipTicker)
        : null;
    const name =
      member?.company_name ??
      metrics?.name ??
      profile?.companyName ??
      getAssetName(membershipTicker) ??
      null;
    const label = name ? `${membershipTicker} (${name})` : membershipTicker;
    if (!isMember) {
      const suggestions = suggestTickersFromPrompt(prompt, list, knownTickers);
      const suggestionLine = buildSuggestionText(suggestions);
      return respond({
        reply: suggestionLine
          ? `No, ${label} is not in the current S&P 500 universe. ${suggestionLine}`
          : `No, ${label} is not in the current S&P 500 universe.`,
        suggestions: []
      });
    }
    const descriptionSnippet = buildDescriptionSnippet(
      metrics?.description ?? profile?.description ?? null
    );
    let reply = `Yes, ${label} is in the current S&P 500 universe.`;
    if (descriptionSnippet) {
      reply += ` ${descriptionSnippet}`;
    }
    reply += " Want any metrics like return, beta, alpha, Sharpe, or volatility?";
    return respond({
      reply,
      suggestions: [],
      linkableTickers: [membershipTicker],
      contextTicker: membershipTicker
    });
  }

  const explicitTicker = extractExplicitTicker(prompt, knownTickers);
  let requestedTicker =
    explicitTicker ??
    (listIntent && (sector || metric)
      ? null
      : extractTickerFromPrompt(prompt, normalized, knownTickers, list));
  if (!requestedTicker && metric && !listIntent) {
    const candidate = extractTickerCandidate(prompt, knownTickers);
      if (candidate) {
        if (universeTickers.has(candidate)) {
          requestedTicker = candidate;
        } else {
          const suggestions = suggestTickersFromPrompt(prompt, list, knownTickers);
          const suggestionLine = buildSuggestionText(suggestions);
          return respond({
            reply: suggestionLine
              ? `No, ${candidate} is not in the current S&P 500 universe. ${suggestionLine}`
              : `No, ${candidate} is not in the current S&P 500 universe.`,
            suggestions: []
          });
        }
      }
  }
  if (!requestedTicker && contextTicker && !listIntent) {
    if (shouldUseContextTicker(normalized, metric)) {
      if (!metric) {
        return respond({
          reply: `Which metric would you like for ${contextTicker}? Try return, beta, alpha, Sharpe, or volatility.`,
          suggestions: [],
          linkableTickers: [contextTicker],
          contextTicker
        });
      }
      requestedTicker = contextTicker;
    }
  }

  if (requestedTicker) {
    const isUniverseMember =
      universeTickers.has(requestedTicker) ||
      requestedTicker === DEFAULT_BENCHMARK_TICKER;
    if (!isUniverseMember) {
      const label = getAssetName(requestedTicker);
      const display = label
        ? `${requestedTicker} (${label})`
        : requestedTicker;
      const suggestions = suggestTickersFromPrompt(prompt, list, knownTickers);
      const suggestionLine = buildSuggestionText(suggestions);
      return respond({
        reply: suggestionLine
          ? `No, ${display} is not in the current S&P 500 universe. ${suggestionLine}`
          : `No, ${display} is not in the current S&P 500 universe. Want to check a different ticker?`,
        suggestions: []
      });
    }
    const member =
      list.find((entry) => normalizeTicker(entry.ticker) === requestedTicker) ?? null;
    const metrics = supabase
      ? await loadCachedMetric(supabase, requestedTicker)
      : null;
    let profile =
      !metrics?.description || !metrics?.name
        ? await fetchFmpProfile(requestedTicker)
        : null;
    const wantsSpecificMetric = Boolean(metric) && !listIntent;
    if (wantsSpecificMetric) {
      const metricLabel = resolveMetricLabel(
        metric as MetricKey,
        normalized,
        returnRequest
      );
      if (!metrics) {
        if (["pe", "marketCap", "beta"].includes(metric as string)) {
          if (!profile) {
            profile = await fetchFmpProfile(requestedTicker);
          }
          if (profile) {
            const fallbackValue =
              metric === "pe"
                ? profile.pe ?? null
                : metric === "beta"
                  ? profile.beta ?? null
                  : profile.mktCap ?? null;
            const formatted =
              metric === "marketCap"
                ? formatMarketCap(fallbackValue)
                : metric === "pe"
                  ? formatNumber(fallbackValue, 1)
                  : formatNumber(fallbackValue, 2);
            if (formatted) {
              return respond({
                reply: `${metricLabel} for ${requestedTicker} is ${formatted}.`,
                suggestions: [],
                linkableTickers: [requestedTicker],
                contextTicker: requestedTicker,
                contextMetric: metric
              });
            }
          }
        }
        return respond({
          reply: `${metricLabel} for ${requestedTicker} is not available yet.`,
          suggestions: [],
          linkableTickers: [requestedTicker],
          contextTicker: requestedTicker,
          contextMetric: metric
        });
      }
      let benchmarkReturns: number[] | undefined;
      if (metric === "alpha" && supabase) {
        const benchmarkMetrics = await loadCachedMetric(
          supabase,
          DEFAULT_BENCHMARK_TICKER
        );
        if (benchmarkMetrics) {
          benchmarkReturns = extractMonthlySeries(benchmarkMetrics);
        }
      }
      const metricValue = resolveMetricValue(
        metric as MetricKey,
        metrics,
        benchmarkReturns,
        returnRequest
      );
      const formatted = formatMetricValue(
        metric as MetricKey,
        metricValue,
        metrics
      );
      if (!formatted) {
        if (["pe", "marketCap", "beta"].includes(metric as string)) {
          if (!profile) {
            profile = await fetchFmpProfile(requestedTicker);
          }
          if (profile) {
            const fallbackValue =
              metric === "pe"
                ? profile.pe ?? null
                : metric === "beta"
                  ? profile.beta ?? null
                  : profile.mktCap ?? null;
            const fallbackFormatted =
              metric === "marketCap"
                ? formatMarketCap(fallbackValue)
                : metric === "pe"
                  ? formatNumber(fallbackValue, 1)
                  : formatNumber(fallbackValue, 2);
            if (fallbackFormatted) {
              return respond({
                reply: `${metricLabel} for ${requestedTicker} is ${fallbackFormatted}.`,
                suggestions: [],
                linkableTickers: [requestedTicker],
                contextTicker: requestedTicker,
                contextMetric: metric
              });
            }
          }
        }
        return respond({
          reply: `${metricLabel} for ${requestedTicker} is not available yet.`,
          suggestions: [],
          linkableTickers: [requestedTicker],
          contextTicker: requestedTicker,
          contextMetric: metric
        });
      }
      let returnSuffix = "";
      if (
        metric === "return" &&
        (returnRequest.period === "mtd" ||
          returnRequest.period === "qtd" ||
          returnRequest.period === "ytd")
      ) {
        const asOfDate = formatAsOf(metrics?.asOf ?? null);
        if (asOfDate) {
          returnSuffix = ` As of ${asOfDate}.`;
        } else {
          const latest = getLatestMonthlyPoint(metrics);
          if (latest) {
            const monthName = MONTH_LABELS[latest.month] ?? "Month";
            returnSuffix = ` As of ${monthName} ${latest.year}.`;
          }
        }
      }
      return respond({
        reply: `${metricLabel} for ${requestedTicker} is ${formatted}.${returnSuffix}`,
        suggestions: [],
        linkableTickers: [requestedTicker],
        contextTicker: requestedTicker,
        contextMetric: metric
      });
    }
    const name =
      member?.company_name ??
      metrics?.name ??
      profile?.companyName ??
      getAssetName(requestedTicker) ??
      null;
    const sectorName = member?.sector ?? profile?.sector ?? null;
    const industryName = member?.industry ?? profile?.industry ?? null;
    const sectorLabel =
      sectorName && industryName
        ? `${sectorName} / ${industryName}`
        : sectorName ?? industryName ?? null;
    const profileDetailParts: string[] = [];
    if (profile?.mktCap !== null && profile?.mktCap !== undefined) {
      const label = formatMarketCap(profile.mktCap);
      if (label) {
        profileDetailParts.push(`Market cap ${label}`);
      }
    }
    if (profile?.pe !== null && profile?.pe !== undefined) {
      const label = formatNumber(profile.pe, 1);
      if (label) {
        profileDetailParts.push(`P/E ${label}`);
      }
    }
    if (profile?.beta !== null && profile?.beta !== undefined) {
      const label = formatNumber(profile.beta, 2);
      if (label) {
        profileDetailParts.push(`Beta ${label}`);
      }
    }
    const detail =
      formatMetricDetails(metrics) ??
      (profileDetailParts.length ? profileDetailParts.join(" · ") : null);
    const returnValue = metrics?.oneYearReturn ?? metrics?.annualReturn ?? null;
    const returnLabel = detail ? null : formatPercent(returnValue);
    const asOf = formatAsOf(metrics?.asOf ?? null);
    const descriptionSnippet = buildDescriptionSnippet(
      metrics?.description ?? profile?.description ?? null
    );
    const summary = descriptionSnippet ?? buildFallbackSummary(name, sectorLabel);

    let reply = requestedTicker;
    if (name) {
      reply += ` is ${name}`;
    } else {
      reply += " is a stock in the Wizyrd universe";
    }
    if (sectorLabel) {
      reply += ` (${sectorLabel})`;
    }
    reply += ".";
    if (summary) {
      reply += ` ${summary}`;
    }
    if (detail) {
      reply += ` ${detail}.`;
    } else if (returnLabel) {
      reply += ` 1Y return: ${returnLabel}.`;
    }
    if (asOf) {
      reply += ` As of ${asOf}.`;
    }
    if (!metrics) {
      reply += " Market data is still syncing for this ticker.";
    }

    return respond({
      reply,
      suggestions: [
        {
          ticker: requestedTicker,
          name,
          sector: sectorName ?? null,
          detail
        }
      ],
      linkableTickers: [requestedTicker],
      contextTicker: requestedTicker
    });
  }

  if (wantsDescription(normalized) && !sector && !metric) {
    return respond({
      reply: "Tell me which ticker you want a description for.",
      suggestions: []
    });
  }

  if (wantsHelp(normalized) && !sector && !metric) {
    return respond({
      reply:
        "Ask for a sector or style. Try tech stocks, low volatility, high beta, value stocks, or large cap picks.",
      suggestions: []
    });
  }

  if (!sector && subsectorQuery && listIntent) {
    const normalizedSubsector = normalizeText(subsectorQuery);
    const subsectorTokens = normalizedSubsector.split(" ").filter(Boolean);
    const subsectorMatches = list
      .filter((member) => member.ticker !== DEFAULT_BENCHMARK_TICKER)
      .filter((member) => {
        const industry = normalizeText(member.industry ?? "");
        const sectorName = normalizeText(member.sector ?? "");
        const company = normalizeText(member.company_name ?? "");
        const haystack = `${industry} ${sectorName} ${company}`.trim();
        return subsectorTokens.every((token) => haystack.includes(token));
      });

    if (!subsectorMatches.length) {
      return respond({
        reply:
          `I don’t have a subsector match for "${subsectorQuery}". ` +
          "Try a broader sector (e.g., Industrials, Materials, Technology) or a specific ticker.",
        suggestions: []
      });
    }

    const suggestions: WizyrdSuggestion[] = subsectorMatches
      .slice(0, limit)
      .map((member) => ({
        ticker: member.ticker,
        name: member.company_name ?? null,
        sector: member.sector ?? null
      }));

    return respond({
      reply: `Here are ${suggestions.length} ${subsectorQuery} stocks to explore.`,
      suggestions
    });
  }

  if (!sector && !metric && !listIntent) {
    return respond({
      reply:
        "I can help with S&P 500 tickers, market metrics (return, beta, alpha, Sharpe, volatility), and Wizyrd screens. Ask about a ticker, metric, or page to get started.",
      suggestions: []
    });
  }

  const normalizedSector = sector ? normalizeText(sector) : null;
  const filteredUniverse = list
    .filter((member) => member.ticker !== DEFAULT_BENCHMARK_TICKER)
    .filter((member) =>
      normalizedSector
        ? normalizeText(member.sector ?? "") === normalizedSector
        : true
    );

  if (!filteredUniverse.length) {
    return respond({
      reply: "I could not find any matches for that request. Try a different sector.",
      suggestions: []
    });
  }

  if (!supabase) {
    if (metric) {
      return respond({
        reply:
          "Market data cache is not available yet. Try again later or ask for a sector list.",
        suggestions: []
      });
    }
    const suggestions: WizyrdSuggestion[] = filteredUniverse.slice(0, limit).map((member) => ({
      ticker: member.ticker,
      name: member.company_name ?? null,
      sector: member.sector ?? null
    }));
    const label = sector ? `${sector} ` : "";
    return respond({
      reply: `Here are ${suggestions.length} ${label}stocks to explore.`,
      suggestions
    });
  }

  if (!metric) {
    const suggestions: WizyrdSuggestion[] = filteredUniverse.slice(0, limit).map((member) => ({
      ticker: member.ticker,
      name: member.company_name ?? null,
      sector: member.sector ?? null
    }));
    const label = sector ? `${sector} ` : "";
    return respond({
      reply: `Here are ${suggestions.length} ${label}stocks to explore.`,
      suggestions
    });
  }

  const tickers = filteredUniverse.map((member) => member.ticker);
  const metricsMap = await loadCachedMetrics(supabase, tickers);
  let benchmarkReturns: number[] = [];
  if (metric === "alpha") {
    const benchmarkMetrics =
      metricsMap.get(DEFAULT_BENCHMARK_TICKER) ??
      (supabase ? await loadCachedMetric(supabase, DEFAULT_BENCHMARK_TICKER) : null);
    if (benchmarkMetrics) {
      benchmarkReturns = extractMonthlySeries(benchmarkMetrics);
    }
  }
  const scored: Array<{
    member: UniverseMember;
    value: number;
    detail: string | null;
  }> = [];

  filteredUniverse.forEach((member) => {
    const metrics = metricsMap.get(member.ticker);
    if (!metrics) {
      return;
    }
    const value = resolveMetricValue(
      metric,
      metrics,
      benchmarkReturns,
      returnRequest
    );
    if (value === null || !Number.isFinite(value)) {
      return;
    }
    const detail = buildMetricDetail(metric, metrics, value, returnRequest, normalized);
    scored.push({ member, value, detail });
  });

  const sorted = scored.sort((a, b) => {
    if (direction === "asc") {
      return a.value - b.value;
    }
    return b.value - a.value;
  });
  const selected = sorted.slice(0, limit);
  const suggestions: WizyrdSuggestion[] = selected.map(({ member, detail }) => ({
    ticker: member.ticker,
    name: member.company_name ?? null,
    sector: member.sector ?? null,
    detail
  }));

  const descriptor = describeMetric(metric, direction, returnRequest, normalized);
  const parts = [descriptor, sector].filter(Boolean).join(" ");
  const reply = suggestions.length
    ? `Here are ${suggestions.length} ${parts ? `${parts} ` : ""}stocks to explore.`
    : "I could not find any matches with cached data yet. Try a broader request.";

  return respond({
    reply,
    suggestions,
    coverage: {
      available: scored.length,
      total: filteredUniverse.length
    }
  });
}

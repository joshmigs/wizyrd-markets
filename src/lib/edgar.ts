type EdgarCompanyFacts = {
  facts?: Record<string, Record<string, EdgarFact>>;
};

type EdgarFact = {
  units?: Record<string, EdgarFactValue[]>;
};

type EdgarFactValue = {
  val?: number | null;
  end?: string;
  filed?: string;
  form?: string;
  fy?: number;
  fp?: string;
  frame?: string;
};

export type EdgarFundamentals = {
  ticker: string;
  cik: string;
  asOf: string | null;
  revenue: number | null;
  netIncome: number | null;
  eps: number | null;
  sharesOutstanding: number | null;
  assets: number | null;
  liabilities: number | null;
  equity: number | null;
};

const SEC_TICKERS_URL = "https://www.sec.gov/files/company_tickers.json";
const SEC_COMPANY_FACTS_URL =
  "https://data.sec.gov/api/xbrl/companyfacts/CIK";

const SEC_USER_AGENT =
  process.env.SEC_USER_AGENT?.trim() ?? "Wizyrd Markets (support@wizyrd.com)";

const TICKER_MAP_TTL_MS = 1000 * 60 * 60 * 24;
const FACTS_TTL_MS = 1000 * 60 * 60 * 6;

const tickerCache: {
  updatedAt: number;
  map: Map<string, { cik: string; title: string | null }>;
} = {
  updatedAt: 0,
  map: new Map()
};

const factsCache = new Map<string, { updatedAt: number; data: EdgarCompanyFacts | null }>();

const buildHeaders = () => ({
  "User-Agent": SEC_USER_AGENT,
  Accept: "application/json",
  "Accept-Encoding": "gzip, deflate"
});

const padCik = (value: number | string) => {
  const raw = String(value ?? "").replace(/\D/g, "");
  return raw.padStart(10, "0");
};

const parseJson = async <T>(url: string) => {
  const response = await fetch(url, { headers: buildHeaders() });
  if (!response.ok) {
    return null;
  }
  return (await response.json()) as T;
};

const getTickerMap = async () => {
  if (tickerCache.updatedAt && Date.now() - tickerCache.updatedAt < TICKER_MAP_TTL_MS) {
    return tickerCache.map;
  }
  const data = await parseJson<Record<string, { cik_str: number; ticker: string; title?: string }>>(
    SEC_TICKERS_URL
  );
  const map = new Map<string, { cik: string; title: string | null }>();
  if (data) {
    Object.values(data).forEach((entry) => {
      const ticker = entry.ticker?.toUpperCase();
      if (!ticker) {
        return;
      }
      map.set(ticker, { cik: padCik(entry.cik_str), title: entry.title ?? null });
    });
  }
  tickerCache.map = map;
  tickerCache.updatedAt = Date.now();
  return map;
};

const getCompanyFacts = async (cik: string) => {
  const normalized = padCik(cik);
  const cached = factsCache.get(normalized);
  if (cached && Date.now() - cached.updatedAt < FACTS_TTL_MS) {
    return cached.data;
  }
  const url = `${SEC_COMPANY_FACTS_URL}${normalized}.json`;
  const data = await parseJson<EdgarCompanyFacts>(url);
  factsCache.set(normalized, { updatedAt: Date.now(), data });
  return data;
};

const formRank = (form?: string | null) => {
  const normalized = (form ?? "").toUpperCase();
  if (normalized === "10-K" || normalized === "20-F" || normalized === "40-F") {
    return 3;
  }
  if (normalized === "10-Q") {
    return 2;
  }
  if (normalized === "8-K") {
    return 1;
  }
  return 0;
};

const chooseLatestValue = (entries: EdgarFactValue[] | undefined) => {
  if (!entries?.length) {
    return null;
  }
  const filtered = entries
    .filter((entry) => Number.isFinite(entry.val))
    .map((entry) => ({
      ...entry,
      endTime: entry.end ? new Date(entry.end).getTime() : 0,
      filedTime: entry.filed ? new Date(entry.filed).getTime() : 0,
      formScore: formRank(entry.form)
    }));
  if (!filtered.length) {
    return null;
  }
  filtered.sort((left, right) => {
    if (right.formScore !== left.formScore) {
      return right.formScore - left.formScore;
    }
    if (right.endTime !== left.endTime) {
      return right.endTime - left.endTime;
    }
    return right.filedTime - left.filedTime;
  });
  return filtered[0];
};

const resolveUnits = (
  units: Record<string, EdgarFactValue[]>,
  candidates: string[]
) => {
  for (const candidate of candidates) {
    const exact = units[candidate];
    if (exact) {
      return exact;
    }
    const match = Object.keys(units).find(
      (key) => key.toLowerCase() === candidate.toLowerCase()
    );
    if (match) {
      return units[match];
    }
  }
  for (const candidate of candidates) {
    const match = Object.keys(units).find((key) =>
      key.toLowerCase().includes(candidate.toLowerCase())
    );
    if (match) {
      return units[match];
    }
  }
  return units[Object.keys(units)[0] ?? ""] ?? undefined;
};

const pickFactValue = (
  facts: Record<string, EdgarFact> | undefined,
  tags: string[],
  unitCandidates: string[]
) => {
  for (const tag of tags) {
    const fact = facts?.[tag];
    const units = fact?.units;
    if (!units) {
      continue;
    }
    const entries = resolveUnits(units, unitCandidates);
    const latest = chooseLatestValue(entries);
    if (latest && Number.isFinite(latest.val)) {
      return latest;
    }
  }
  return null;
};

export const fetchEdgarFundamentals = async (
  ticker: string
): Promise<EdgarFundamentals | null> => {
  const map = await getTickerMap();
  const entry = map.get(ticker.toUpperCase());
  if (!entry?.cik) {
    return null;
  }
  const facts = await getCompanyFacts(entry.cik);
  if (!facts) {
    return {
      ticker: ticker.toUpperCase(),
      cik: entry.cik,
      asOf: null,
      revenue: null,
      netIncome: null,
      eps: null,
      sharesOutstanding: null,
      assets: null,
      liabilities: null,
      equity: null
    };
  }
  const gaap = facts.facts?.["us-gaap"] ?? {};
  const dei = facts.facts?.["dei"] ?? {};

  const revenue = pickFactValue(
    gaap,
    ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax"],
    ["USD"]
  );
  const netIncome = pickFactValue(gaap, ["NetIncomeLoss"], ["USD"]);
  const eps = pickFactValue(
    gaap,
    ["EarningsPerShareDiluted", "EarningsPerShareBasic"],
    ["USD/shares", "USD / shares", "USD/share", "USD / share"]
  );
  const shares = pickFactValue(
    dei,
    ["EntityCommonStockSharesOutstanding"],
    ["shares"]
  );
  const sharesFallback = pickFactValue(
    gaap,
    ["CommonStockSharesOutstanding"],
    ["shares"]
  );
  const assets = pickFactValue(gaap, ["Assets"], ["USD"]);
  const liabilities = pickFactValue(gaap, ["Liabilities"], ["USD"]);
  const equity = pickFactValue(
    gaap,
    ["StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"],
    ["USD"]
  );

  const dates = [
    revenue?.end,
    netIncome?.end,
    eps?.end,
    shares?.end,
    sharesFallback?.end,
    assets?.end,
    liabilities?.end,
    equity?.end
  ]
    .filter(Boolean)
    .map((value) => new Date(value as string).getTime())
    .filter((value) => Number.isFinite(value));

  const asOf = dates.length
    ? new Date(Math.max(...dates)).toISOString().slice(0, 10)
    : null;

  return {
    ticker: ticker.toUpperCase(),
    cik: entry.cik,
    asOf,
    revenue: typeof revenue?.val === "number" ? revenue.val : null,
    netIncome: typeof netIncome?.val === "number" ? netIncome.val : null,
    eps: typeof eps?.val === "number" ? eps.val : null,
    sharesOutstanding:
      typeof shares?.val === "number"
        ? shares.val
        : typeof sharesFallback?.val === "number"
          ? sharesFallback.val
          : null,
    assets: typeof assets?.val === "number" ? assets.val : null,
    liabilities: typeof liabilities?.val === "number" ? liabilities.val : null,
    equity: typeof equity?.val === "number" ? equity.val : null
  };
};


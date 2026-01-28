export type WatchlistItem = {
  ticker: string;
  company_name?: string | null;
  sector?: string | null;
  industry?: string | null;
  added_at?: string;
};

const STORAGE_KEY = "wizyrdWatchlist";
export const WATCHLIST_EVENT = "wizyrd-watchlist";

export const readWatchlist = () => {
  if (typeof window === "undefined") {
    return [] as WatchlistItem[];
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [] as WatchlistItem[];
    }
    const parsed = JSON.parse(raw) as WatchlistItem[];
    return Array.isArray(parsed) ? parsed : [];
  } catch (_error) {
    return [] as WatchlistItem[];
  }
};

export const writeWatchlist = (items: WatchlistItem[]) => {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  window.dispatchEvent(new Event(WATCHLIST_EVENT));
};

export const toggleWatchlistItem = (item: WatchlistItem) => {
  const list = readWatchlist();
  const exists = list.some((entry) => entry.ticker === item.ticker);
  const next = exists
    ? list.filter((entry) => entry.ticker !== item.ticker)
    : [...list, { ...item, added_at: new Date().toISOString() }];
  writeWatchlist(next);
  return next;
};

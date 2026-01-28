"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type NewsItem = {
  title: string;
  url: string;
  publishedDate?: string | null;
  site?: string | null;
  summary?: string | null;
};

type NewsDockProps = {
  inline?: boolean;
  className?: string;
};

export default function NewsDock({ inline = false, className }: NewsDockProps) {
  const [open, setOpen] = useState(false);
  const [newsItems, setNewsItems] = useState<NewsItem[]>([]);
  const [newsLoading, setNewsLoading] = useState(false);
  const [newsError, setNewsError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [activeTicker, setActiveTicker] = useState("");
  const [refreshSeed, setRefreshSeed] = useState(0);
  const [resolvedLabel, setResolvedLabel] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const requestIdRef = useRef(0);
  const openRef = useRef(false);
  const activeTickerRef = useRef("");
  const activeQueryRef = useRef("");

  const formatDate = useMemo(
    () => (value?: string | null) => {
      if (!value) {
        return null;
      }
      const parsed = new Date(value);
      if (Number.isNaN(parsed.getTime())) {
        return value;
      }
      return parsed.toLocaleString("en-US", {
        month: "short",
        day: "numeric"
      });
    },
    []
  );

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    let mounted = true;

    const resetState = () => {
      if (!mounted) {
        return;
      }
      requestIdRef.current += 1;
      setOpen(false);
      setQuery("");
      setActiveQuery("");
      setActiveTicker("");
      setResolvedLabel(null);
      setNewsItems([]);
      setNewsError(null);
      setNewsLoading(false);
    };

    const applyAuthState = (session: { user: { id: string } } | null) => {
      if (!session?.user) {
        resetState();
      }
    };

    supabase.auth
      .getSession()
      .then(({ data }) => applyAuthState(data.session ?? null))
      .catch(() => applyAuthState(null));

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      applyAuthState(session ?? null);
    });

    return () => {
      mounted = false;
      data.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const handleClose = (_event: Event) => setOpen(false);
    const handleOpen = (event: Event) => {
      const detail = (event as CustomEvent<{ query?: string; ticker?: string }>).detail;
      const nextTicker = detail?.ticker?.trim().toUpperCase() ?? "";
      const nextQuery = detail?.query?.trim() ?? "";
      const hasSameTicker =
        Boolean(nextTicker) && nextTicker === activeTickerRef.current;
      const hasSameQuery =
        !nextTicker && Boolean(nextQuery) && nextQuery === activeQueryRef.current;
      if (openRef.current && (hasSameTicker || hasSameQuery)) {
        setOpen(false);
        return;
      }
      requestIdRef.current += 1;
      setOpen(true);
      setActiveTicker(nextTicker);
      setQuery(nextTicker || nextQuery);
      setActiveQuery(nextTicker ? "" : nextQuery);
    };
    window.addEventListener("news:close", handleClose);
    window.addEventListener("news:open", handleOpen);
    return () => {
      window.removeEventListener("news:close", handleClose);
      window.removeEventListener("news:open", handleOpen);
    };
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    let cancelled = false;
    const loadNews = async () => {
      setNewsLoading(true);
      setNewsError(null);
      setResolvedLabel(null);
      try {
        const params = new URLSearchParams({ limit: "6" });
        if (activeTicker) {
          params.set("ticker", activeTicker);
        } else if (activeQuery) {
          params.set("q", activeQuery);
        }
        if (refreshSeed > 0) {
          params.set("refresh", "1");
        }
        const response = await fetch(`/api/news?${params.toString()}`);
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
          if (cancelled) {
            return;
          }
          if (requestId !== requestIdRef.current) {
            return;
          }
          setNewsError(result.error ?? "Unable to load news.");
          setNewsItems([]);
          return;
        }
        if (cancelled) {
          return;
        }
        if (requestId !== requestIdRef.current) {
          return;
        }
        setNewsItems(Array.isArray(result.news) ? result.news : []);
        setResolvedLabel(typeof result.label === "string" ? result.label : null);
      } catch (_error) {
        if (cancelled) {
          return;
        }
        if (requestId !== requestIdRef.current) {
          return;
        }
        setNewsError("Unable to load news.");
        setNewsItems([]);
      } finally {
        if (cancelled) {
          return;
        }
        if (requestId !== requestIdRef.current) {
          return;
        }
        setNewsLoading(false);
      }
    };

    loadNews();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || buttonRef.current?.contains(target)) {
        return;
      }
      if (target instanceof Element && target.closest("button")) {
        return;
      }
      setOpen(false);
    };

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handlePointerDown);

    return () => {
      cancelled = true;
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [open, activeQuery, activeTicker, refreshSeed]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (open) {
      window.dispatchEvent(new CustomEvent("wizyrd:close"));
      window.dispatchEvent(new CustomEvent("messenger:close"));
    }
  }, [open]);

  useEffect(() => {
    openRef.current = open;
  }, [open]);

  useEffect(() => {
    activeTickerRef.current = activeTicker;
  }, [activeTicker]);

  useEffect(() => {
    activeQueryRef.current = activeQuery;
  }, [activeQuery]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setActiveTicker("");
    setActiveQuery(query.trim());
  };

  const handleRefresh = () => {
    setRefreshSeed((current) => current + 1);
  };

  const wrapperClassName = inline
    ? `flex flex-col items-end gap-3 ${className ?? ""}`
    : `fixed bottom-24 right-6 z-[60] flex flex-col items-end gap-3 ${className ?? ""}`;

  return (
    <div className={wrapperClassName}>
      {open ? (
        <div
          className="fixed inset-0 z-[50]"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
      ) : null}
      {open ? (
        <div
          ref={panelRef}
          className="relative z-[56] flex max-h-[72vh] w-[min(92vw,360px)] flex-col rounded-3xl border border-amber-100 bg-white/90 p-4 shadow-2xl shadow-amber-200/40 backdrop-blur"
        >
          <div className="mb-3 flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-[0.35em] text-navy">
              News
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-full border border-navy/20 bg-white px-2.5 py-1 text-xs font-semibold text-navy shadow-sm shadow-navy/10 transition hover:border-navy hover:bg-navy-soft hover:text-white"
            >
              Close
            </button>
          </div>
          <form onSubmit={handleSubmit} className="mb-3 flex items-center gap-2">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Ticker or company name"
              className="flex-1 rounded-full border border-amber-100 bg-white px-3 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-navy outline-none transition focus:border-amber-300"
            />
            <button
              type="submit"
              className="rounded-full border border-amber-100 bg-amber-50 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-amber-900 transition hover:border-amber-300 hover:bg-amber-100"
            >
              Go
            </button>
            <button
              type="button"
              onClick={handleRefresh}
              className="rounded-full border border-navy/20 bg-white px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-navy transition hover:border-navy hover:bg-navy-soft hover:text-white"
            >
              Refresh
            </button>
          </form>
          <p className="mb-3 text-[11px] uppercase tracking-[0.2em] text-steel">
            {resolvedLabel ? `Latest news for ${resolvedLabel}` : "Latest market news"}
          </p>
          <div className="flex-1 overflow-y-auto pr-1 text-sm text-steel">
            {newsLoading ? (
              <p className="text-sm text-steel">Loading latest headlines...</p>
            ) : newsError ? (
              <p className="text-sm text-red-600">{newsError}</p>
            ) : newsItems.length === 0 ? (
              <p className="text-sm text-steel">No headlines available yet.</p>
            ) : (
              <div className="space-y-3">
                {newsItems.map((item) => {
                  const dateLabel = formatDate(item.publishedDate ?? null);
                  const summary = item.summary?.trim();
                  return (
                    <div
                      key={`${item.url}-${item.title}`}
                      className="group relative border-b border-amber-100 pb-3 last:border-0 last:pb-0"
                    >
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noreferrer"
                        className="block font-semibold text-ink transition hover:text-navy"
                      >
                        {item.title}
                      </a>
                      <div className="mt-1 flex items-center gap-2 text-[11px] uppercase tracking-[0.2em] text-steel">
                        {item.site ? <span>{item.site}</span> : null}
                        {dateLabel ? <span>{dateLabel}</span> : null}
                      </div>
                      {summary ? (
                        <div className="pointer-events-none absolute left-0 top-full z-20 mt-2 w-[min(78vw,300px)] rounded-2xl border border-amber-100 bg-white px-3 py-2 text-xs text-steel shadow-lg opacity-0 transition group-hover:opacity-100">
                          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-amber-700">
                            Preview
                          </p>
                          <p className="mt-1 leading-relaxed text-ink/80">{summary}</p>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      ) : null}
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-label="Open news feed"
        title="News"
        onClick={() => setOpen((prev) => !prev)}
        className="group flex h-14 w-14 items-center justify-center rounded-full border border-amber-200 bg-amber-50 text-amber-900 shadow-lg shadow-amber-200/30 transition hover:scale-105 hover:border-amber-300 hover:bg-amber-100"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="h-6 w-6"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="4" y="5" width="16" height="14" rx="2" />
          <path d="M8 8h5" />
          <path d="M8 11h5" />
          <path d="M8 14h5" />
          <path d="M14 8h4" />
          <path d="M14 11h4" />
          <path d="M14 14h4" />
        </svg>
      </button>
    </div>
  );
}

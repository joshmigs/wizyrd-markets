"use client";

import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type WizyrdPromptProps = {
  className?: string;
  showLabel?: boolean;
};

type WizyrdSuggestion = {
  ticker: string;
  name: string | null;
  sector: string | null;
  detail?: string | null;
};

type WizyrdMetric =
  | "volatility"
  | "return"
  | "beta"
  | "alpha"
  | "sharpe"
  | "pe"
  | "marketCap";

type WizyrdMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  suggestions?: WizyrdSuggestion[];
  coverage?: { available: number; total: number } | null;
  linkableTickers?: string[];
  contextTicker?: string | null;
  contextIntent?: "sentiment" | null;
  contextMetric?: WizyrdMetric | null;
};

type WizyrdResponse = {
  reply?: string;
  suggestions?: WizyrdSuggestion[];
  coverage?: { available: number; total: number } | null;
  linkableTickers?: string[];
  contextTicker?: string | null;
  contextIntent?: "sentiment" | null;
  contextMetric?: WizyrdMetric | null;
  error?: string;
};

const STORAGE_KEY = "wizyrd-chat-history";
const LAST_STORAGE_KEY = `${STORAGE_KEY}:last`;
const LAST_USER_KEY = `${STORAGE_KEY}:last-user`;

const QUICK_PROMPTS = [
  "Tech stock companies",
  "Low volatility stock suggestions",
  "Highest beta stocks",
  "Value stocks",
  "Stock sentiment"
];

const buildId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
const TICKER_REGEX = /\b[A-Z]{2,5}(?:\.[A-Z]{1,2})?\b/g;

const buildTickerHref = (ticker: string) =>
  `/playground?view=snapshot&ticker=${encodeURIComponent(ticker)}#company-snapshot`;

const linkifyContent = (
  content: string,
  linkClassName: string,
  linkableTickers?: string[]
) => {
  const matches = [...content.matchAll(TICKER_REGEX)];
  if (!matches.length) {
    return content;
  }
  const allowed = linkableTickers
    ? new Set(linkableTickers.map((ticker) => ticker.toUpperCase()))
    : null;
  const nodes: Array<string | JSX.Element> = [];
  let lastIndex = 0;
  matches.forEach((match) => {
    const start = match.index ?? 0;
    if (start > lastIndex) {
      nodes.push(content.slice(lastIndex, start));
    }
    const ticker = match[0];
    if (!allowed || !allowed.has(ticker)) {
      nodes.push(ticker);
    } else {
      nodes.push(
        <Link
          key={`${ticker}-${start}`}
          href={buildTickerHref(ticker)}
          className={linkClassName}
        >
          {ticker}
        </Link>
      );
    }
    lastIndex = start + ticker.length;
  });
  if (lastIndex < content.length) {
    nodes.push(content.slice(lastIndex));
  }
  return nodes;
};

export default function WizyrdPrompt({
  className = "",
  showLabel = true
}: WizyrdPromptProps) {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<WizyrdMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authEvent, setAuthEvent] = useState<string | null>(null);
  const [signedOut, setSignedOut] = useState<boolean | null>(null);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [remoteEnabled, setRemoteEnabled] = useState(false);
  const [remoteUpdatedAt, setRemoteUpdatedAt] = useState<string | null>(null);
  const [pendingIntent, setPendingIntent] = useState<"sentiment" | null>(null);
  const [contextTicker, setContextTicker] = useState<string | null>(null);
  const [contextIntent, setContextIntent] = useState<"sentiment" | null>(null);
  const [contextMetric, setContextMetric] = useState<WizyrdMetric | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const remoteUpdatedAtRef = useRef<string | null>(null);
  const saveTimeoutRef = useRef<number | null>(null);

  const hasMessages = messages.length > 0;
  const showHistoryLoader = authReady && Boolean(userId) && !historyLoaded;
  const headerTone = showLabel ? "text-steel" : "text-white/70";
  const clearButtonStyle = showLabel
    ? "border-navy/20 text-navy hover:border-navy hover:bg-navy-soft hover:text-white"
    : "border-white/30 text-white hover:border-white/60 hover:bg-white/10";
  const hintText = useMemo(
    () =>
      "Ask about the S&P 500 stock universe, such as sector, style, alpha/beta/return/sharpe/volatility constraints, tickers, or general company information.",
    []
  );

  const applyLoadedMessages = (nextMessages: WizyrdMessage[]) => {
    setMessages(nextMessages);
    const lastAssistant = [...nextMessages]
      .reverse()
      .find((entry) => entry.role === "assistant");
    setContextTicker(lastAssistant?.contextTicker ?? null);
    setContextIntent(lastAssistant?.contextIntent ?? null);
    setContextMetric(lastAssistant?.contextMetric ?? null);
  };

  useEffect(() => {
    remoteUpdatedAtRef.current = remoteUpdatedAt;
  }, [remoteUpdatedAt]);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    let mounted = true;

    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!mounted) {
          return;
        }
        setUserId(data.session?.user.id ?? null);
        setAccessToken(data.session?.access_token ?? null);
        setAuthEvent("INITIAL_SESSION");
        setSignedOut(data.session ? false : true);
        setAuthReady(true);
      })
      .catch(() => {
        if (!mounted) {
          return;
        }
        setUserId(null);
        setAccessToken(null);
        setAuthEvent("INITIAL_SESSION");
        setSignedOut(true);
        setAuthReady(true);
      });

    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      setAuthEvent(event);
      setUserId(session?.user.id ?? null);
      setAccessToken(session?.access_token ?? null);
      if (event === "SIGNED_OUT") {
        setSignedOut(true);
      } else if (
        event === "SIGNED_IN" ||
        event === "TOKEN_REFRESHED" ||
        event === "USER_UPDATED" ||
        event === "INITIAL_SESSION"
      ) {
        setSignedOut(session ? false : true);
      }
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
    if (!authReady) {
      return;
    }
    if (!userId) {
      if (!signedOut) {
        return;
      }
      setMessages([]);
      setPendingIntent(null);
      setAccessToken(null);
      setContextTicker(null);
      setContextIntent(null);
      setContextMetric(null);
      setHistoryLoaded(false);
      setRemoteEnabled(false);
      setRemoteUpdatedAt(null);
      return;
    }
    const loadLocalHistory = () => {
      const storageKey = `${STORAGE_KEY}:${userId}`;
      const stored = window.localStorage.getItem(storageKey);
      const legacyStored = stored ? null : window.localStorage.getItem(STORAGE_KEY);
      const lastUser = window.localStorage.getItem(LAST_USER_KEY);
      const lastStored =
        !stored && lastUser === userId ? window.localStorage.getItem(LAST_STORAGE_KEY) : null;
      const rawStored = stored ?? lastStored ?? legacyStored;
      if (!rawStored) {
        applyLoadedMessages([]);
        setHistoryLoaded(true);
        return;
      }
      try {
        const parsed = JSON.parse(rawStored);
        if (Array.isArray(parsed)) {
          applyLoadedMessages(parsed as WizyrdMessage[]);
          if (legacyStored) {
            window.localStorage.setItem(storageKey, JSON.stringify(parsed));
            window.localStorage.removeItem(STORAGE_KEY);
          }
        } else {
          applyLoadedMessages([]);
        }
      } catch {
        applyLoadedMessages([]);
      } finally {
        setHistoryLoaded(true);
      }
    };

    const loadRemoteHistory = async () => {
      let token = accessToken;
      if (!token) {
        try {
          const supabase = createSupabaseBrowserClient();
          const { data } = await supabase.auth.getSession();
          token = data.session?.access_token ?? null;
          if (token) {
            setAccessToken(token);
            setUserId(data.session?.user.id ?? null);
          }
        } catch (_error) {
          token = null;
        }
      }
      if (!token) {
        loadLocalHistory();
        return;
      }
      try {
        const response = await fetch("/api/wizyrd/history", {
          headers: {
            Authorization: `Bearer ${token}`
          }
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
          setRemoteEnabled(false);
          loadLocalHistory();
          return;
        }
        setRemoteEnabled(true);
        const nextMessages = Array.isArray(result.messages)
          ? (result.messages as WizyrdMessage[])
          : [];
        applyLoadedMessages(nextMessages);
        setRemoteUpdatedAt(result.updated_at ?? null);
        setHistoryLoaded(true);
      } catch (_error) {
        setRemoteEnabled(false);
        loadLocalHistory();
      }
    };

    loadRemoteHistory();
  }, [authReady, userId, accessToken, signedOut, authEvent]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (!authReady || !userId || !historyLoaded) {
      return;
    }
    if (!messages.length) {
      return;
    }
    const storageKey = `${STORAGE_KEY}:${userId}`;
    window.localStorage.setItem(storageKey, JSON.stringify(messages));
    window.localStorage.setItem(LAST_STORAGE_KEY, JSON.stringify(messages));
    window.localStorage.setItem(LAST_USER_KEY, userId);
  }, [messages, authReady, userId, historyLoaded]);

  useEffect(() => {
    if (!authReady || !userId || !historyLoaded || !remoteEnabled) {
      return;
    }
    if (saveTimeoutRef.current) {
      window.clearTimeout(saveTimeoutRef.current);
    }
    saveTimeoutRef.current = window.setTimeout(async () => {
      let token = accessToken;
      if (!token) {
        try {
          const supabase = createSupabaseBrowserClient();
          const { data } = await supabase.auth.getSession();
          token = data.session?.access_token ?? null;
          if (token) {
            setAccessToken(token);
            setUserId(data.session?.user.id ?? null);
          }
        } catch (_error) {
          token = null;
        }
      }
      if (!token) {
        return;
      }
      try {
        const response = await fetch("/api/wizyrd/history", {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({ messages })
        });
        const result = await response.json().catch(() => ({}));
        if (response.ok) {
          setRemoteUpdatedAt(result.updated_at ?? new Date().toISOString());
        }
      } catch (_error) {
        // ignore sync errors
      }
    }, 900);

    return () => {
      if (saveTimeoutRef.current) {
        window.clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [messages, authReady, userId, historyLoaded, remoteEnabled, accessToken]);

  useEffect(() => {
    if (!authReady || !userId || !remoteEnabled || !accessToken) {
      return;
    }
    const syncInterval = window.setInterval(async () => {
      try {
        const response = await fetch("/api/wizyrd/history", {
          headers: { Authorization: `Bearer ${accessToken}` }
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
          return;
        }
        const remoteStamp = result.updated_at ?? null;
        if (
          remoteStamp &&
          (!remoteUpdatedAtRef.current ||
            new Date(remoteStamp).getTime() >
              new Date(remoteUpdatedAtRef.current).getTime())
        ) {
          const nextMessages = Array.isArray(result.messages)
            ? (result.messages as WizyrdMessage[])
            : [];
          applyLoadedMessages(nextMessages);
          setRemoteUpdatedAt(remoteStamp);
        }
      } catch (_error) {
        // ignore polling errors
      }
    }, 15000);

    return () => {
      window.clearInterval(syncInterval);
    };
  }, [authReady, userId, remoteEnabled, accessToken]);

  useEffect(() => {
    if (!scrollRef.current) {
      return;
    }
    scrollRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, loading]);

  const sendPrompt = async (
    prompt: string,
    options?: { skipIntent?: boolean; preserveIntent?: boolean }
  ) => {
    const trimmed = prompt.trim();
    if (!trimmed || loading) {
      return;
    }
    const normalized = trimmed.toLowerCase();
    const shouldApplyIntent =
      pendingIntent === "sentiment" &&
      !options?.skipIntent &&
      !normalized.includes("sentiment");
    const promptToSend = shouldApplyIntent ? `sentiment ${trimmed}` : trimmed;
    if (!options?.preserveIntent) {
      if (shouldApplyIntent || normalized.includes("sentiment")) {
        setPendingIntent(null);
      }
    }
    setMessages((current) => [
      ...current,
      { id: buildId(), role: "user", content: trimmed }
    ]);
    setInput("");
    setLoading(true);
    try {
      let token = accessToken;
      if (!token) {
        try {
          const supabase = createSupabaseBrowserClient();
          const { data } = await supabase.auth.getSession();
          token = data.session?.access_token ?? null;
          if (token) {
            setAccessToken(token);
            setUserId(data.session?.user.id ?? null);
          }
        } catch (_error) {
          token = null;
        }
      }
      const headers: Record<string, string> = {
        "Content-Type": "application/json"
      };
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }
      const response = await fetch("/api/wizyrd", {
        method: "POST",
        headers,
        body: JSON.stringify({
          prompt: promptToSend,
          contextTicker: contextTicker ?? undefined,
          contextIntent: contextIntent ?? undefined,
          contextMetric: contextMetric ?? undefined
        })
      });
      const result = (await response.json().catch(() => ({}))) as WizyrdResponse;
      if (!response.ok) {
        setMessages((current) => [
          ...current,
          {
            id: buildId(),
            role: "assistant",
            content: result.error ?? "Wizyrd ran into a hiccup. Try again."
          }
        ]);
        return;
      }
      setMessages((current) => [
        ...current,
        {
          id: buildId(),
          role: "assistant",
          content:
            result.reply ??
            "Here are some ideas based on the latest cached market data.",
          suggestions: result.suggestions ?? [],
          coverage: result.coverage ?? null,
          linkableTickers: result.linkableTickers ?? [],
          contextTicker: result.contextTicker ?? null,
          contextIntent: result.contextIntent ?? null,
          contextMetric: result.contextMetric ?? null
        }
      ]);
      setContextTicker(result.contextTicker ?? null);
      setContextIntent(result.contextIntent ?? null);
      setContextMetric(result.contextMetric ?? null);
    } catch (_error) {
      setMessages((current) => [
        ...current,
        {
          id: buildId(),
          role: "assistant",
          content: "Wizyrd ran into a hiccup. Try again."
        }
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    sendPrompt(input);
  };

  const handleClearHistory = () => {
    setMessages([]);
    setInput("");
    setPendingIntent(null);
    setContextTicker(null);
    setContextIntent(null);
    setContextMetric(null);
    if (typeof window !== "undefined" && userId) {
      window.localStorage.removeItem(`${STORAGE_KEY}:${userId}`);
      window.localStorage.removeItem(LAST_STORAGE_KEY);
      window.localStorage.removeItem(LAST_USER_KEY);
    }
    if (remoteEnabled && userId && accessToken) {
      fetch("/api/wizyrd/history", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`
        },
        body: JSON.stringify({ messages: [] })
      }).catch(() => undefined);
      setRemoteUpdatedAt(new Date().toISOString());
    }
  };

  const handleQuickPrompt = (prompt: string) => {
    const normalized = prompt.toLowerCase();
    if (normalized.includes("sentiment")) {
      setPendingIntent("sentiment");
      sendPrompt(prompt, { skipIntent: true, preserveIntent: true });
      return;
    }
    sendPrompt(prompt);
  };

  const renderMessageContent = (message: WizyrdMessage) => {
    if (message.role === "user") {
      return message.content;
    }
    return linkifyContent(
      message.content,
      "font-semibold text-navy underline decoration-navy/40",
      message.linkableTickers
    );
  };

  return (
    <div className={`flex w-full flex-col gap-3 ${className}`.trim()}>
      {showLabel ? (
        <span className="text-[10px] font-semibold uppercase tracking-[0.35em] text-navy/70">
          Wizyrd
        </span>
      ) : null}
      <div className="space-y-3">
        {hasMessages ? (
          <div
            className={`flex items-center justify-between text-[11px] uppercase tracking-[0.2em] ${headerTone}`}
          >
            <span>Chat history</span>
            <button
              type="button"
              onClick={handleClearHistory}
              className={`rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] transition ${clearButtonStyle}`}
            >
              Clear history
            </button>
          </div>
        ) : null}
        {showHistoryLoader ? (
          <div className="rounded-2xl border border-white/20 bg-white/80 px-4 py-3 text-sm text-ink shadow-sm shadow-navy/10">
            <p className="text-xs text-steel">Loading your chat history...</p>
          </div>
        ) : null}
        {!hasMessages && !showHistoryLoader ? (
          <div className="rounded-2xl border border-white/20 bg-white/80 px-4 py-3 text-sm text-ink shadow-sm shadow-navy/10">
            <p className="text-xs text-steel">{hintText}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {QUICK_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => handleQuickPrompt(prompt)}
                  className="rounded-full border border-navy/20 bg-white px-3 py-1 text-[11px] font-semibold text-navy shadow-sm shadow-navy/10 transition hover:border-navy hover:bg-navy-soft hover:text-white"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        <div className="max-h-[45vh] space-y-3 overflow-y-auto pr-1">
          {messages.map((message) => (
            <div key={message.id}>
              <div
                className={`w-fit max-w-[90%] rounded-2xl px-3 py-2 text-sm shadow-sm ${
                  message.role === "user"
                    ? "ml-auto bg-navy text-white shadow-navy/30"
                    : "bg-white/85 text-ink shadow-navy/10"
                }`}
              >
                {renderMessageContent(message)}
              </div>
              {message.role === "assistant" && message.suggestions?.length ? (
                <div className="mt-2 grid gap-2">
                  {message.suggestions.map((suggestion) => (
                    <div
                      key={suggestion.ticker}
                      className="rounded-xl border border-white/30 bg-white/80 px-3 py-2 text-xs text-steel"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <Link
                          href={buildTickerHref(suggestion.ticker)}
                          className="font-semibold text-ink hover:text-navy"
                        >
                          {suggestion.ticker}
                        </Link>
                        {suggestion.detail ? (
                          <span className="text-[11px] text-steel">{suggestion.detail}</span>
                        ) : null}
                      </div>
                      <div className="mt-1 text-[11px] text-steel">
                        {suggestion.name ?? "Company name unavailable"}
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
              {message.role === "assistant" && message.coverage ? (
                <p className="mt-1 text-[10px] uppercase tracking-[0.2em] text-white/70">
                  Coverage: {message.coverage.available} / {message.coverage.total}
                </p>
              ) : null}
            </div>
          ))}
          {loading ? (
            <div className="rounded-2xl bg-white/80 px-3 py-2 text-xs text-steel shadow-sm shadow-navy/10">
              Wizyrd is thinking...
            </div>
          ) : null}
          <div ref={scrollRef} />
        </div>
      </div>
      <form
        onSubmit={handleSubmit}
        className="flex w-full items-center gap-3 rounded-full border border-white/30 bg-white/80 px-5 py-2 shadow-lg shadow-navy/10 backdrop-blur"
      >
        <input
          className="flex-1 bg-transparent text-sm text-ink placeholder:text-ink/40 focus:outline-none"
          placeholder="Need help? Ask Wizyrd a question."
          type="text"
          name="wizyrd"
          autoComplete="off"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          disabled={loading}
        />
        <button
          aria-label="Send to Wizyrd"
          className="flex h-10 w-10 items-center justify-center rounded-full bg-navy-soft text-white shadow-md shadow-navy/25 transition hover:bg-navy-soft hover:text-[#7bd99f] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
          type="submit"
          disabled={loading || !input.trim()}
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            className="h-5 w-5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M3 21l7.5-7.5" />
            <path d="M12 4l.9 1.9 1.9.9-1.9.9L12 9.6l-.9-1.9-1.9-.9 1.9-.9L12 4z" />
            <path d="M17 10.5l.6 1.2 1.2.6-1.2.6-.6 1.2-.6-1.2-1.2-.6 1.2-.6.6-1.2z" />
          </svg>
        </button>
      </form>
    </div>
  );
}

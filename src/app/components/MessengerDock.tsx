"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type MessengerDockProps = {
  inline?: boolean;
  className?: string;
};

type League = {
  id: string;
  name: string;
};

type LeagueMember = {
  id: string;
  display_name: string | null;
};

type MessageRow = {
  id: string;
  league_id: string;
  sender_id: string;
  recipient_id: string;
  message: string;
  created_at: string;
  read_at: string | null;
};

const LEAGUE_BROADCAST_ID = "__league__";
const SUPPORT_EMAIL = "support@wizyrd.com";

export default function MessengerDock({ inline = false, className }: MessengerDockProps) {
  const [session, setSession] = useState<Session | null>(null);
  const [open, setOpen] = useState(false);
  const [leagues, setLeagues] = useState<League[]>([]);
  const [members, setMembers] = useState<LeagueMember[]>([]);
  const [selectedLeagueId, setSelectedLeagueId] = useState("");
  const [selectedUserId, setSelectedUserId] = useState("");
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [messageInput, setMessageInput] = useState("");
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [membersLoading, setMembersLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [unreadByLeague, setUnreadByLeague] = useState<Record<string, number>>({});
  const [unreadByMember, setUnreadByMember] = useState<Record<string, number>>({});
  const [leagueUnreadCount, setLeagueUnreadCount] = useState(0);
  const [highlightLeagueId, setHighlightLeagueId] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const messagesRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const formatTime = useCallback((value?: string | null) => {
    if (!value) {
      return "";
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return "";
    }
    return parsed.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit"
    });
  }, []);

  const loadLeagues = useCallback(async () => {
    if (!session?.access_token) {
      return;
    }
    setError(null);
    try {
      const response = await fetch("/api/league/list", {
        headers: {
          Authorization: `Bearer ${session.access_token}`
        }
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(result.error ?? "Unable to load leagues.");
        setLeagues([]);
        return;
      }
      const nextLeagues = (result.leagues ?? []) as League[];
      setLeagues(nextLeagues);
    } catch (_error) {
      setError("Unable to load leagues.");
      setLeagues([]);
    }
  }, [session?.access_token]);

  const resetState = useCallback(() => {
    setOpen(false);
    setLeagues([]);
    setMembers([]);
    setSelectedLeagueId("");
    setSelectedUserId("");
    setMessages([]);
    setMessageInput("");
    setError(null);
    setUnreadCount(0);
    setUnreadByLeague({});
    setUnreadByMember({});
    setLeagueUnreadCount(0);
    setHighlightLeagueId(null);
    if (typeof window !== "undefined") {
      window.localStorage.setItem("messenger-open", "false");
    }
  }, []);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    let mounted = true;

    const applyAuthState = (sessionData: Session | null) => {
      if (!mounted) {
        return;
      }
      setSession(sessionData);
      if (!sessionData?.user) {
        resetState();
        return;
      }
      if (typeof window !== "undefined") {
        const stored = window.localStorage.getItem("messenger-open");
        if (stored === "true") {
          setOpen(true);
        }
      }
    };

    supabase.auth
      .getSession()
      .then(({ data }) => applyAuthState(data.session ?? null))
      .catch(() => applyAuthState(null));

    const { data } = supabase.auth.onAuthStateChange((_event, newSession) => {
      applyAuthState(newSession ?? null);
    });

    return () => {
      mounted = false;
      data.subscription.unsubscribe();
    };
  }, [resetState]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem("messenger-open", open ? "true" : "false");
  }, [open]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const handleClose = (_event: Event) => setOpen(false);
    window.addEventListener("messenger:close", handleClose);
    return () => {
      window.removeEventListener("messenger:close", handleClose);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const handleLeagueJoined = () => {
      if (!session?.access_token) {
        return;
      }
      loadLeagues();
    };
    window.addEventListener("league:joined", handleLeagueJoined);
    return () => {
      window.removeEventListener("league:joined", handleLeagueJoined);
    };
  }, [loadLeagues, session?.access_token]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (open) {
      window.dispatchEvent(new CustomEvent("news:close"));
      window.dispatchEvent(new CustomEvent("wizyrd:close"));
    }
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

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
      if (target instanceof HTMLElement) {
        const tagName = target.tagName.toLowerCase();
        if (tagName === "select" || tagName === "option" || target.closest("select")) {
          return;
        }
        if (target.closest("button")) {
          return;
        }
      }
      setOpen(false);
    };

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handlePointerDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [open]);

  const loadMembers = useCallback(
    async (leagueId: string) => {
      if (!session?.access_token || !leagueId) {
        return;
      }
      setMembersLoading(true);
      setError(null);
      try {
        const response = await fetch(
          `/api/league/members?leagueId=${encodeURIComponent(leagueId)}`,
          {
            headers: {
              Authorization: `Bearer ${session.access_token}`
            }
          }
        );
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
          setMembers([]);
          setError(result.error ?? "Unable to load members.");
          return;
        }
        const nextMembers = (result.members ?? []) as LeagueMember[];
        const filtered = nextMembers.filter((member) => member.id !== session.user.id);
        setMembers(filtered);
        setSelectedUserId((current) => {
          if (!current) {
            return "";
          }
          if (current === LEAGUE_BROADCAST_ID) {
            return current;
          }
          return filtered.some((member) => member.id === current) ? current : "";
        });
      } catch (_error) {
        setMembers([]);
        setError("Unable to load members.");
      } finally {
        setMembersLoading(false);
      }
    },
    [session?.access_token, selectedUserId, session?.user?.id]
  );

  const loadUnreadByMember = useCallback(
    async (leagueId: string) => {
      if (!session?.access_token || !leagueId) {
        return;
      }
      try {
        const response = await fetch(
          `/api/messages/unread-by-member?leagueId=${encodeURIComponent(leagueId)}`,
          {
            headers: {
              Authorization: `Bearer ${session.access_token}`
            }
          }
        );
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
          setUnreadByMember({});
          setLeagueUnreadCount(0);
          return;
        }
        const next: Record<string, number> = {};
        (result.members ?? []).forEach((entry: { userId: string; unread: number }) => {
          if (entry?.userId) {
            next[entry.userId] = entry.unread ?? 0;
          }
        });
        setUnreadByMember(next);
        setLeagueUnreadCount(Number(result.leagueUnread ?? 0));
      } catch (_error) {
        setUnreadByMember({});
        setLeagueUnreadCount(0);
      }
    },
    [session?.access_token]
  );

  const loadMessages = useCallback(async () => {
    if (!session?.access_token || !selectedLeagueId || !selectedUserId) {
      return;
    }
    setMessagesLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        leagueId: selectedLeagueId
      });
      if (selectedUserId === LEAGUE_BROADCAST_ID) {
        params.set("scope", "league");
      } else {
        params.set("userId", selectedUserId);
      }
      const response = await fetch(`/api/messages?${params.toString()}`, {
        headers: {
          Authorization: `Bearer ${session.access_token}`
        }
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessages([]);
        setError(result.error ?? "Unable to load messages.");
        return;
      }
      const nextMessages = (result.messages ?? []) as MessageRow[];
      setMessages(nextMessages);

      const isLeagueThread = selectedUserId === LEAGUE_BROADCAST_ID;
      const unreadInThread = nextMessages.filter((message) => {
        if (message.recipient_id !== session.user.id || message.read_at) {
          return false;
        }
        if (isLeagueThread) {
          return true;
        }
        return message.sender_id === selectedUserId;
      }).length;
      const threadUnreadCount = isLeagueThread
        ? leagueUnreadCount
        : unreadByMember[selectedUserId] ?? 0;
      const markCount = Math.max(unreadInThread, threadUnreadCount);
      if (markCount > 0) {
        const readAt = new Date().toISOString();
        await fetch("/api/messages", {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`
          },
          body: JSON.stringify({
            leagueId: selectedLeagueId,
            userId: selectedUserId === LEAGUE_BROADCAST_ID ? undefined : selectedUserId,
            scope: isLeagueThread ? "league" : "direct"
          })
        });
        setMessages((current) =>
          current.map((message) =>
            message.recipient_id === session.user.id && !message.read_at
              ? { ...message, read_at: readAt }
              : message
          )
        );
        setUnreadCount((current) => Math.max(0, current - markCount));
        if (isLeagueThread) {
          setLeagueUnreadCount(0);
        } else {
          setUnreadByMember((current) => ({ ...current, [selectedUserId]: 0 }));
        }
      }
    } catch (_error) {
      setMessages([]);
      setError("Unable to load messages.");
    } finally {
      setMessagesLoading(false);
    }
  }, [
    session?.access_token,
    selectedLeagueId,
    selectedUserId,
    session?.user?.id,
    unreadByMember,
    leagueUnreadCount
  ]);

  const loadUnreadCount = useCallback(async () => {
    if (!session?.access_token) {
      return;
    }
    try {
      const response = await fetch("/api/messages/unread", {
        headers: {
          Authorization: `Bearer ${session.access_token}`
        }
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        return;
      }
      setUnreadCount(Number(result.unread ?? 0));
    } catch (_error) {
      // ignore unread count errors
    }
  }, [session?.access_token]);

  const loadUnreadByLeague = useCallback(async () => {
    if (!session?.access_token) {
      return;
    }
    try {
      const response = await fetch("/api/messages/unread-by-league", {
        headers: {
          Authorization: `Bearer ${session.access_token}`
        }
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        return;
      }
      const entries = Array.isArray(result.leagues) ? result.leagues : [];
      const next: Record<string, number> = {};
      entries.forEach((entry: { leagueId?: string; unread?: number }) => {
        if (entry.leagueId) {
          next[entry.leagueId] = Number(entry.unread ?? 0);
        }
      });
      setUnreadByLeague(next);
      const top = Object.entries(next).sort((a, b) => b[1] - a[1])[0];
      setHighlightLeagueId(top ? top[0] : null);
    } catch (_error) {
      // ignore
    }
  }, [session?.access_token]);

  useEffect(() => {
    if (!session?.access_token) {
      setLeagues([]);
      return;
    }
    loadLeagues();
  }, [session?.access_token, loadLeagues]);

  useEffect(() => {
    if (!selectedLeagueId) {
      setMembers([]);
      setSelectedUserId("");
      setMessages([]);
      setMessageInput("");
      setUnreadByMember({});
      setLeagueUnreadCount(0);
      return;
    }
    loadMembers(selectedLeagueId);
    loadUnreadByMember(selectedLeagueId);
  }, [selectedLeagueId, loadMembers, loadUnreadByMember]);

  useEffect(() => {
    if (!open || !selectedLeagueId || !selectedUserId) {
      return;
    }
    loadMessages();
    const interval = window.setInterval(loadMessages, 15000);
    return () => {
      window.clearInterval(interval);
    };
  }, [open, selectedLeagueId, selectedUserId, loadMessages]);

  useEffect(() => {
    if (!session?.access_token) {
      return;
    }
    if (open) {
      return;
    }
    loadUnreadCount();
    const interval = window.setInterval(loadUnreadCount, 20000);
    return () => {
      window.clearInterval(interval);
    };
  }, [session?.access_token, loadUnreadCount, open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    setUnreadCount(0);
    loadUnreadByLeague();
    if (selectedLeagueId) {
      loadUnreadByMember(selectedLeagueId);
    }
    const interval = window.setInterval(loadUnreadByLeague, 20000);
    return () => {
      window.clearInterval(interval);
    };
  }, [open, loadUnreadByLeague, loadUnreadByMember, selectedLeagueId]);

  useEffect(() => {
    if (!open || selectedLeagueId || !highlightLeagueId) {
      return;
    }
    setSelectedLeagueId(highlightLeagueId);
    setSelectedUserId("");
    setMessages([]);
    setMessageInput("");
  }, [open, selectedLeagueId, highlightLeagueId]);

  useEffect(() => {
    if (!open || !selectedLeagueId || selectedUserId || !members.length) {
      return;
    }
    const topMember = Object.entries(unreadByMember).sort((a, b) => b[1] - a[1])[0];
    if (topMember?.[0]) {
      const exists = members.some((member) => member.id === topMember[0]);
      if (exists) {
        setSelectedUserId(topMember[0]);
      }
    }
  }, [open, selectedLeagueId, selectedUserId, unreadByMember, members]);

  useEffect(() => {
    if (!open || !messagesRef.current) {
      return;
    }
    messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
  }, [messages.length, open]);

  const handleSend = async () => {
    if (!session?.access_token || !selectedLeagueId || !selectedUserId) {
      return;
    }
    const payload = messageInput.trim();
    if (!payload) {
      return;
    }

    setError(null);
    setMessageInput("");
    try {
      const response = await fetch("/api/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`
        },
        body: JSON.stringify({
          leagueId: selectedLeagueId,
          recipientId: selectedUserId === LEAGUE_BROADCAST_ID ? undefined : selectedUserId,
          scope: selectedUserId === LEAGUE_BROADCAST_ID ? "league" : "direct",
          message: payload
        })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(result.error ?? "Unable to send message.");
        return;
      }
      const createdAt = result.created_at ?? new Date().toISOString();
      setMessages((current) => [
        ...current,
        {
          id: result.id ?? `${Date.now()}`,
          league_id: selectedLeagueId,
          sender_id: session.user.id,
          recipient_id:
            selectedUserId === LEAGUE_BROADCAST_ID
              ? session.user.id
              : selectedUserId,
          message: payload,
          created_at: createdAt,
          read_at: null
        }
      ]);
    } catch (_error) {
      setError("Unable to send message.");
    }
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    handleSend();
  };

  const selectedUser = members.find((member) => member.id === selectedUserId);
  const isLeagueThread = selectedUserId === LEAGUE_BROADCAST_ID;
  const canSend =
    Boolean(selectedLeagueId) &&
    (isLeagueThread || Boolean(selectedUserId && selectedUserId !== ""));
  const unreadLeagueLabel = highlightLeagueId
    ? leagues.find((league) => league.id === highlightLeagueId)?.name ??
      "League"
    : null;
  const topUnreadMember = Object.entries(unreadByMember).sort((a, b) => b[1] - a[1])[0];
  const unreadMemberLabel = topUnreadMember
    ? members.find((member) => member.id === topUnreadMember[0])?.display_name ?? null
    : null;
  const wrapperClassName = inline
    ? `flex flex-col items-end gap-3 ${className ?? ""}`
    : `fixed bottom-40 right-6 z-[60] flex flex-col items-end gap-3 ${className ?? ""}`;

  return (
    <div className={wrapperClassName}>
      {session?.user && open ? (
        <div
          ref={panelRef}
          className="w-[min(92vw,360px)] rounded-3xl border border-white/20 bg-slate-900/80 p-4 shadow-2xl shadow-slate-900/35 backdrop-blur"
        >
          <div className="mb-3 flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-[0.35em] text-white">
              Messages
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-full border border-white/20 bg-white/80 px-2.5 py-1 text-xs font-semibold text-navy shadow-sm shadow-navy/10 transition hover:border-white/40 hover:bg-white hover:text-navy"
            >
              Close
            </button>
          </div>
          {unreadLeagueLabel ? (
            <p className="mb-2 text-[11px] text-slate-200">
              Unread: {unreadLeagueLabel}
              {unreadMemberLabel ? ` · ${unreadMemberLabel}` : ""}
            </p>
          ) : null}
          <div className="space-y-3">
            <label className="block text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-200">
              League
              {leagues.length ? (
                <select
                  className="mt-2 w-full rounded-xl border border-white/20 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm shadow-white/10"
                  value={selectedLeagueId}
                  onChange={(event) => {
                    setSelectedLeagueId(event.target.value);
                    setSelectedUserId("");
                    setMessages([]);
                    setMessageInput("");
                  }}
                >
                  <option value="">Select a league</option>
                  {leagues.map((league) => {
                    const count = unreadByLeague[league.id] ?? 0;
                    return (
                      <option key={league.id} value={league.id}>
                        {league.name}
                        {count > 0 ? ` (${count})` : ""}
                      </option>
                    );
                  })}
                </select>
              ) : (
                <p className="mt-2 rounded-xl border border-white/10 bg-white/90 px-3 py-2 text-sm text-slate-900">
                  No leagues yet.
                </p>
              )}
            </label>
            <label className="block text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-200">
              Member
              <select
                className="mt-2 w-full rounded-xl border border-white/20 bg-white px-3 py-2 text-sm normal-case text-slate-900 shadow-sm shadow-white/10"
                value={selectedUserId}
                onChange={(event) => {
                  setSelectedUserId(event.target.value);
                  setMessages([]);
                  setMessageInput("");
                }}
                disabled={!selectedLeagueId || membersLoading}
              >
                <option value="">
                  {membersLoading ? "Loading members..." : "Select a member"}
                </option>
                {selectedLeagueId ? (
                  <option value={LEAGUE_BROADCAST_ID}>
                    Message league{leagueUnreadCount > 0 ? ` (${leagueUnreadCount})` : ""}
                  </option>
                ) : null}
                {members.map((member) => {
                  const count = unreadByMember[member.id] ?? 0;
                  const label = member.display_name ?? "Member";
                  return (
                    <option key={member.id} value={member.id}>
                      {label}
                      {count > 0 ? ` • ${count} new` : ""}
                    </option>
                  );
                })}
              </select>
            </label>
          </div>
          {error ? <p className="mt-3 text-xs text-amber-200">{error}</p> : null}
          <form onSubmit={handleSubmit} className="mt-3 flex items-center gap-2">
            <input
              ref={inputRef}
              value={messageInput}
              onChange={(event) => setMessageInput(event.target.value)}
              placeholder={
                isLeagueThread
                  ? "Message league"
                  : selectedUserId
                    ? `Message ${selectedUser?.display_name ?? "member"}`
                    : "Message"
              }
              className="flex-1 rounded-full border border-slate-200 !bg-white px-3 py-2 text-sm !text-slate-900 placeholder:text-slate-600 caret-slate-900 shadow-sm"
              style={{ color: "#0f172a" }}
            />
            <button
              type="submit"
              disabled={!canSend || !messageInput.trim()}
              className="flex h-10 w-10 items-center justify-center rounded-full border border-teal-500 bg-teal-500 text-white shadow-md shadow-teal-500/30 transition hover:scale-105 hover:border-teal-600 hover:bg-teal-600 hover:shadow-teal-500/40 disabled:cursor-not-allowed disabled:opacity-60"
              aria-label="Send message"
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
                <path d="M4 7h9a3 3 0 0 1 3 3v5a3 3 0 0 1-3 3H8l-4 3v-3H4a3 3 0 0 1-3-3v-5a3 3 0 0 1 3-3z" />
                <path d="M13 7h4a4 4 0 0 1 4 4v3a3 3 0 0 1-3 3h-1" />
              </svg>
            </button>
          </form>
          {selectedLeagueId &&
          selectedUserId &&
          (messagesLoading || messages.length > 0) ? (
            <div
              ref={messagesRef}
              className="mt-3 max-h-64 space-y-3 overflow-y-auto rounded-2xl border border-white/20 bg-white/10 p-3 text-sm text-white cursor-text"
              onMouseDown={() => {
                inputRef.current?.focus();
              }}
            >
              {messagesLoading ? (
                <p className="text-sm text-slate-200">Loading conversation...</p>
              ) : messages.length === 0 ? (
                <p className="text-sm text-slate-200">
                  No messages yet. Say hello to{" "}
                  {isLeagueThread
                    ? "your league"
                    : selectedUser?.display_name ?? "a member"}
                  .
                </p>
              ) : (
                messages.map((message) => {
                  const isSender = message.sender_id === session?.user?.id;
                  const unread =
                    !isSender &&
                    message.recipient_id === session?.user?.id &&
                    !message.read_at;
                  const senderLabel = isSender
                    ? "You"
                    : members.find((member) => member.id === message.sender_id)
                        ?.display_name ?? "Member";
                  return (
                    <div
                      key={message.id}
                      className={`flex ${isSender ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${
                          isSender
                            ? "bg-navy-soft text-white"
                            : unread
                              ? "border border-amber-200 bg-amber-50 text-amber-900"
                              : "bg-white/10 text-slate-100"
                        }`}
                      >
                        {isLeagueThread && !isSender ? (
                          <p className="text-[10px] uppercase tracking-[0.2em] text-slate-300">
                            {senderLabel}
                          </p>
                        ) : null}
                        <p>{message.message}</p>
                        <div className="mt-1 flex items-center justify-between text-[10px] uppercase tracking-[0.2em]">
                          <span>{formatTime(message.created_at)}</span>
                          {isSender ? (
                            <span>{message.read_at ? "Read" : "Sent"}</span>
                          ) : unread ? (
                            <span>Unread</span>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          ) : null}
          <button
            type="button"
            onClick={() => {
              const mailto = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(
                "Wizyrd Help"
              )}`;
              if (typeof window !== "undefined") {
                window.location.href = mailto;
              }
            }}
            className="mt-3 w-full rounded-xl border border-white/20 bg-white/85 px-3 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-navy transition hover:border-white/40 hover:bg-white"
          >
            Email Wizyrd support
          </button>
        </div>
      ) : null}
      {session?.user ? (
        <button
          ref={buttonRef}
          type="button"
          aria-expanded={open}
          aria-label="Open messenger"
          title="Messenger"
          onClick={() => setOpen((prev) => !prev)}
          className="group relative flex h-14 w-14 items-center justify-center rounded-full border border-teal-500 bg-teal-500 text-white shadow-xl shadow-teal-500/40 transition hover:scale-105 hover:border-teal-600 hover:bg-teal-600"
        >
          {unreadCount > 0 ? (
            <span className="absolute -top-1 -right-1 flex h-5 min-w-[20px] items-center justify-center rounded-full border border-red-300 bg-white px-1 text-[10px] font-semibold text-red-600">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          ) : null}
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
            <path d="M4 7h9a3 3 0 0 1 3 3v5a3 3 0 0 1-3 3H8l-4 3v-3H4a3 3 0 0 1-3-3v-5a3 3 0 0 1 3-3z" />
            <path d="M13 7h4a4 4 0 0 1 4 4v3a3 3 0 0 1-3 3h-1" />
          </svg>
        </button>
      ) : null}
    </div>
  );
}

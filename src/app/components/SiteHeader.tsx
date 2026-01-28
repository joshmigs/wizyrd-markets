"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type MouseEvent
} from "react";
import type { Session } from "@supabase/supabase-js";
import LogoMark from "@/app/components/LogoMark";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type NavMenuItem =
  | { href: string; label: string; disabled?: boolean; isDivider?: false }
  | { isDivider: true };

type NavItem = {
  key: string;
  href: string;
  label: string;
  items?: NavMenuItem[];
};

type LeagueLink = {
  id: string;
  name: string;
};

const PLAYGROUND_ITEMS = [
  { href: "/playground?view=track-record#track-record", label: "Track record" },
  { href: "/playground?view=optimal#optimal-lineup", label: "Optimal lineup" },
  { href: "/playground?view=overlay#overlay-chart", label: "Overlay chart" },
  { href: "/playground?view=snapshot#company-snapshot", label: "Company snapshot" },
  { href: "/playground?view=screener#stock-screener", label: "Stock screener" }
];

const MATCHUP_ITEMS = [
  { href: "/matchup#matchup-live", label: "Live matchup" },
  { href: "/matchup#matchup-history", label: "Past weeks" }
];

const LINEUP_ITEMS = [
  { href: "/lineup#lineup-live", label: "Live lineup" },
  { href: "/lineup#lineup-history", label: "Past lineups" }
];

export default function SiteHeader() {
  const pathname = usePathname();
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [leagueLinks, setLeagueLinks] = useState<LeagueLink[]>([]);
  const [loadingLeagues, setLoadingLeagues] = useState(false);
  const [powerUser, setPowerUser] = useState(false);
  const [supportsHover, setSupportsHover] = useState(() => {
    if (typeof window === "undefined") {
      return true;
    }
    return window.matchMedia("(hover: hover)").matches;
  });
  const closeTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session ?? null);
      setLoading(false);
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
      setLeagueLinks([]);
      return;
    }

    const controller = new AbortController();
    const loadLeagues = async () => {
      setLoadingLeagues(true);
      try {
        const response = await fetch("/api/league/list", {
          headers: {
            Authorization: `Bearer ${session.access_token}`
          },
          signal: controller.signal
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
          return;
        }
        const list = (result.leagues ?? []) as LeagueLink[];
        setLeagueLinks(list);
      } finally {
        setLoadingLeagues(false);
      }
    };

    loadLeagues();

    return () => {
      controller.abort();
    };
  }, [session?.access_token]);

  useEffect(() => {
    setOpenMenu(null);
  }, [pathname]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const query = window.matchMedia("(hover: hover)");
    const update = () => setSupportsHover(query.matches);
    update();
    query.addEventListener("change", update);
    return () => {
      query.removeEventListener("change", update);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (closeTimeoutRef.current) {
        window.clearTimeout(closeTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!session?.access_token) {
      setPowerUser(false);
      return;
    }

    const controller = new AbortController();
    const loadStatus = async () => {
      try {
        const response = await fetch("/api/account/status", {
          headers: {
            Authorization: `Bearer ${session.access_token}`
          },
          signal: controller.signal
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
          return;
        }
        setPowerUser(Boolean(result?.powerUser));
      } catch (_error) {
        // ignore errors
      }
    };

    loadStatus();

    return () => {
      controller.abort();
    };
  }, [session?.access_token]);

  const leagueItems = useMemo(() => {
    const items: NavMenuItem[] = [];
    if (loadingLeagues && !leagueLinks.length) {
      items.push({ href: "/league", label: "Loading leagues...", disabled: true });
    }
    if (leagueLinks.length) {
      leagueLinks.forEach((league) => {
        items.push({
          href: `/league?leagueId=${league.id}`,
          label: league.name
        });
      });
      items.push({ isDivider: true });
    }
    items.push({ href: "/league/create", label: "Create league" });
    items.push({ href: "/league/join", label: "Join league" });
    return items;
  }, [leagueLinks, loadingLeagues]);

  const settingsItems = useMemo<NavMenuItem[]>(() => {
    const items: NavMenuItem[] = [
      { href: "/settings#settings-profile", label: "Profile" }
    ];
    if (powerUser) {
      items.push({ href: "/settings#settings-admin", label: "Admin tools" });
    } else {
      items.push({ href: "/settings#settings-safety", label: "Safety controls" });
    }
    return items;
  }, [powerUser]);

  const navLinks: NavItem[] = [
    { key: "home", href: "/", label: "Home" },
    { key: "league", href: "/league", label: "League", items: leagueItems },
    { key: "playground", href: "/playground", label: "Playground", items: PLAYGROUND_ITEMS },
    { key: "lineup", href: "/lineup", label: "Lineup", items: LINEUP_ITEMS },
    { key: "matchup", href: "/matchup", label: "Matchup", items: MATCHUP_ITEMS },
    { key: "settings", href: "/settings", label: "Settings", items: settingsItems }
  ];

  const displayLinks = session
    ? navLinks.filter((link) => link.href !== "/")
    : navLinks;

  const handleSignOut = async () => {
    const supabase = createSupabaseBrowserClient();
    try {
      await supabase.auth.signOut();
    } finally {
      setSession(null);
      window.location.assign("/login?reason=signout");
    }
  };

  const cancelCloseMenu = () => {
    if (closeTimeoutRef.current) {
      window.clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
  };

  const scheduleCloseMenu = (key: string) => {
    if (closeTimeoutRef.current) {
      window.clearTimeout(closeTimeoutRef.current);
    }
    closeTimeoutRef.current = window.setTimeout(() => {
      setOpenMenu((current) => (current === key ? null : current));
    }, 300);
  };

  const handleMenuTrigger = (
    event: MouseEvent<HTMLAnchorElement>,
    key: string
  ) => {
    if (!supportsHover && openMenu !== key) {
      event.preventDefault();
      setOpenMenu(key);
    }
  };

  const handleMenuBlur = (event: FocusEvent<HTMLDivElement>, key: string) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
      return;
    }
    setOpenMenu((current) => (current === key ? null : current));
  };

  if (pathname === "/") {
    return null;
  }

  return (
    <header className="sticky top-0 z-50 border-b border-white/20 bg-navy/40 px-6 pt-5 pb-4 shadow-[0_12px_30px_rgba(15,23,42,0.12)] backdrop-blur-xl">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-full border border-white/30 bg-white/80 px-5 py-2 shadow-lg shadow-navy/10 backdrop-blur">
          {session ? (
            <Link className="flex items-center gap-3" href="/league">
              <LogoMark size={18} scale={3.2} className="-mr-1" />
              <span className="text-xs uppercase tracking-[0.2em] text-navy">
                Fantasy Markets
              </span>
            </Link>
          ) : (
            <div className="flex items-center gap-3">
              <LogoMark size={18} scale={3.2} className="-mr-1" />
              <span className="text-xs uppercase tracking-[0.2em] text-navy">
                Fantasy Markets
              </span>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-3 text-sm text-navy">
            <nav className="flex flex-wrap items-center gap-3">
              {displayLinks.map((link) => {
                const isActive =
                  pathname === link.href ||
                  (link.href !== "/" && pathname.startsWith(link.href));
                const isOpen = openMenu === link.key;
                const hasDropdown = Boolean(link.items?.length);
                if (!hasDropdown) {
                  return (
                    <Link
                      key={link.key}
                      href={link.href}
                      className={`rounded-full border px-3 py-1.5 font-semibold shadow-sm shadow-navy/10 transition ${
                        isActive
                          ? "border-navy bg-navy-soft text-white hover:bg-white hover:text-navy"
                          : "border-navy/20 bg-white text-navy hover:border-navy hover:bg-navy-soft hover:text-white"
                      }`}
                    >
                      {link.label}
                    </Link>
                  );
                }

                return (
                  <div
                    key={link.key}
                    className="relative"
                    onMouseEnter={() => {
                      cancelCloseMenu();
                      setOpenMenu(link.key);
                    }}
                    onMouseLeave={() => scheduleCloseMenu(link.key)}
                    onFocusCapture={() => setOpenMenu(link.key)}
                    onBlurCapture={(event) => handleMenuBlur(event, link.key)}
                  >
                    <Link
                      href={link.href}
                      aria-haspopup="menu"
                      aria-expanded={isOpen}
                      onClick={(event) => handleMenuTrigger(event, link.key)}
                      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 font-semibold shadow-sm shadow-navy/10 transition ${
                        isActive || isOpen
                          ? "border-navy bg-navy-soft text-white hover:bg-white hover:text-navy"
                          : "border-navy/20 bg-white text-navy hover:border-navy hover:bg-navy-soft hover:text-white"
                      }`}
                    >
                      <span>{link.label}</span>
                      <svg
                        viewBox="0 0 20 20"
                        className={`h-3 w-3 transition ${
                          isOpen ? "rotate-180" : ""
                        }`}
                        fill="currentColor"
                        aria-hidden="true"
                      >
                        <path
                          fillRule="evenodd"
                          d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 10.94l3.71-3.71a.75.75 0 1 1 1.06 1.06l-4.24 4.24a.75.75 0 0 1-1.06 0L5.21 8.29a.75.75 0 0 1 .02-1.06z"
                          clipRule="evenodd"
                        />
                      </svg>
                    </Link>
                    {isOpen ? (
                      <div
                        className="absolute left-0 top-full z-50 mt-2 min-w-[220px] rounded-2xl border border-amber-100 bg-white/95 p-2 text-xs text-navy shadow-lg shadow-navy/15 backdrop-blur"
                        role="menu"
                        onMouseEnter={cancelCloseMenu}
                        onMouseLeave={() => scheduleCloseMenu(link.key)}
                      >
                        {link.items?.map((item, index) => {
                          if ("isDivider" in item && item.isDivider) {
                            return (
                              <div
                                key={`divider-${link.key}-${index}`}
                                role="separator"
                                className="my-1 h-px bg-amber-100/80"
                              />
                            );
                          }
                          return (
                            <Link
                              key={item.href}
                              href={item.href}
                              onClick={(event) => {
                                if (item.disabled) {
                                  event.preventDefault();
                                  return;
                                }
                                setOpenMenu(null);
                              }}
                              className={`block rounded-xl px-3 py-2 font-semibold transition ${
                                item.disabled
                                  ? "cursor-not-allowed text-steel/70"
                                  : "hover:bg-navy-soft hover:text-white"
                              }`}
                              role="menuitem"
                              aria-disabled={item.disabled}
                              tabIndex={item.disabled ? -1 : 0}
                              onMouseEnter={cancelCloseMenu}
                            >
                              {item.label}
                            </Link>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </nav>
            {!loading && session ? (
              <button
                type="button"
                onClick={handleSignOut}
                className="rounded-full border border-amber-300 bg-amber-100 px-3 py-1.5 text-xs font-semibold text-navy shadow-sm shadow-navy/10 transition hover:border-amber-400 hover:bg-amber-200"
              >
                Sign out
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </header>
  );
}

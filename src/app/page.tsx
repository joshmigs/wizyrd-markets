"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import LogoMark from "@/app/components/LogoMark";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export default function Home() {
  const [session, setSession] = useState<Session | null>(null);
  const [loadingSession, setLoadingSession] = useState(true);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session ?? null);
      setLoadingSession(false);
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

  const handleSignOut = async () => {
    const supabase = createSupabaseBrowserClient();
    try {
      await supabase.auth.signOut();
    } finally {
      setSession(null);
      window.location.assign("/login?reason=signout");
    }
  };

  return (
    <main className="px-6 pt-8 pb-6 md:px-12">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-col gap-8">
          <header className="flex flex-col gap-4 rounded-3xl border border-white/20 bg-navy/40 px-4 py-3 text-sm shadow-[0_12px_30px_rgba(15,23,42,0.12)] backdrop-blur-xl md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-4">
              <LogoMark size={44} priority />
              <span className="text-xs font-semibold uppercase tracking-[0.35em] text-white drop-shadow-[0_2px_10px_rgba(9,24,44,0.45)]">
                Fantasy Markets
              </span>
            </div>
            <div className="flex w-full flex-col items-end gap-2 md:w-auto md:justify-self-end">
              {!loadingSession ? (
                session ? (
                  <>
                    <div className="flex flex-wrap items-center justify-end gap-3">
                      <Link
                        className="rounded-full border border-navy/30 bg-white px-4 py-2 text-navy shadow-sm shadow-navy/10 transition hover:border-navy hover:bg-navy-soft hover:text-white"
                        href="/league"
                      >
                        Go to league
                      </Link>
                      <button
                        className="rounded-full border border-amber-300 bg-amber-100 px-4 py-2 text-navy shadow-sm shadow-navy/10 transition hover:border-amber-400 hover:bg-amber-200"
                        type="button"
                        onClick={handleSignOut}
                      >
                        Sign out
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex flex-wrap items-center justify-end gap-3">
                      <Link
                        className="rounded-full border border-navy/30 bg-white px-4 py-2 text-navy shadow-sm shadow-navy/10 transition hover:border-navy hover:bg-navy-soft hover:text-white"
                        href="/login"
                      >
                        Log in
                      </Link>
                      <Link
                        className="rounded-full border border-navy/30 bg-white px-4 py-2 text-navy shadow-sm shadow-navy/10 transition hover:border-navy hover:bg-navy-soft hover:text-white"
                        href="/signup"
                      >
                        Sign up
                      </Link>
                    </div>
                  </>
                )
              ) : null}
            </div>
          </header>
          <header className="rounded-3xl border border-amber-200/70 bg-white/85 p-6 shadow-[0_20px_60px_rgba(20,20,20,0.12)] backdrop-blur">
            <p className="text-xs uppercase tracking-[0.32em] text-navy">
              Wizyrd Fantasy Markets
            </p>
            <h1 className="mt-3 font-display text-4xl leading-tight text-ink md:text-5xl">
              Draft stock lineups. Win your week.
            </h1>
            <p className="mt-2 max-w-2xl text-lg text-steel">
              Build a weighted portfolio each week, lock it before the bell, and
              compete head-to-head. No trading. Just strategy.
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <Link
                href="/league/create"
                className="rounded-full border border-navy/30 bg-white px-6 py-3 text-sm font-semibold text-navy shadow-lg shadow-navy/15 transition hover:border-navy hover:bg-navy-soft hover:text-white"
              >
                Create a league
              </Link>
              <Link
                href="/league/join"
                className="rounded-full border border-navy/30 bg-white px-6 py-3 text-sm font-semibold text-navy shadow-sm shadow-navy/10 transition hover:border-navy hover:bg-navy-soft hover:text-white"
              >
                Join with invite code
              </Link>
            </div>
          </header>

          <section className="grid gap-6 md:grid-cols-3">
            {[
              {
                title: "Weekly lineups",
                body: "Pick 5 stocks, set weights, lock Sunday 4:00 PM ET."
              },
              {
                title: "Head-to-head",
                body: "Each matchup scores by weekly portfolio return."
              },
              {
                title: "Fair play",
                body: "Static S&P 500 universe with deterministic scoring."
              }
            ].map((card) => (
              <div
                key={card.title}
                className="rounded-2xl border border-amber-100 bg-paper p-6"
              >
                <h3 className="font-display text-2xl text-ink">{card.title}</h3>
                <p className="mt-2 text-sm text-steel">{card.body}</p>
              </div>
            ))}
          </section>
        </div>
      </div>
    </main>
  );
}

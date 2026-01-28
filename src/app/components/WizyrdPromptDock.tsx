"use client";

import { useEffect, useRef, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import NewsDock from "@/app/components/NewsDock";
import MessengerDock from "@/app/components/MessengerDock";
import WizyrdPrompt from "@/app/components/WizyrdPrompt";

export default function WizyrdPromptDock() {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    let mounted = true;

    const applyAuthState = (session: { user: { id: string } } | null) => {
      if (!mounted || typeof window === "undefined") {
        return;
      }
      if (!session?.user) {
        setOpen(false);
        window.localStorage.setItem("wizyrd-open", "false");
        return;
      }
      const stored = window.localStorage.getItem("wizyrd-open");
      if (stored === "true") {
        setOpen(true);
      }
    };

    supabase.auth
      .getSession()
      .then(({ data }) => {
        applyAuthState(data.session ?? null);
      })
      .catch(() => {
        applyAuthState(null);
      });

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
    window.localStorage.setItem("wizyrd-open", open ? "true" : "false");
  }, [open]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const handleClose = (_event: Event) => setOpen(false);
    window.addEventListener("wizyrd:close", handleClose);
    return () => {
      window.removeEventListener("wizyrd:close", handleClose);
    };
  }, []);

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
      if (target instanceof Element) {
        const anchor = target.closest("a");
        if (anchor?.getAttribute("href")) {
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

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (open) {
      window.dispatchEvent(new CustomEvent("news:close"));
      window.dispatchEvent(new CustomEvent("messenger:close"));
    }
  }, [open]);

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3">
      {open ? (
        <div
          ref={panelRef}
          className="w-[min(92vw,420px)] rounded-3xl border border-white/30 bg-navy/40 p-4 shadow-2xl shadow-navy/25 backdrop-blur"
        >
          <div className="mb-3 flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-[0.35em] text-white">
              Wizyrd
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-full border border-navy/20 bg-white/80 px-2.5 py-1 text-xs font-semibold text-navy shadow-sm shadow-navy/10 transition hover:border-navy hover:bg-navy-soft hover:text-white"
            >
              Close
            </button>
          </div>
          <WizyrdPrompt className="max-w-none" showLabel={false} />
        </div>
      ) : null}
      <NewsDock inline />
      <MessengerDock inline />
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-label="Open Wizyrd prompt"
        title="Wizyrd"
        onClick={() => setOpen((prev) => !prev)}
        className="group flex h-14 w-14 items-center justify-center rounded-full border border-white/30 bg-navy/60 text-white shadow-xl shadow-navy/25 transition hover:scale-105 hover:border-white/50 hover:bg-navy/75"
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
          <path d="M3 21l7.5-7.5" />
          <path d="M12 4l.9 1.9 1.9.9-1.9.9L12 9.6l-.9-1.9-1.9-.9 1.9-.9L12 4z" />
          <path d="M17 10.5l.6 1.2 1.2.6-1.2.6-.6 1.2-.6-1.2-1.2-.6 1.2-.6.6-1.2z" />
        </svg>
      </button>
    </div>
  );
}

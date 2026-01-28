"use client";

import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export default function OnlineStatus() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

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

  if (loading) {
    return null;
  }

  return (
    <span className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.25em] text-white/80">
      <span
        className="inline-block h-3 w-3 shrink-0 rounded-full"
        style={{
          backgroundColor: session ? "#10B981" : "#CBD5E1"
        }}
      />
      {session ? "Online" : "Offline"}
    </span>
  );
}

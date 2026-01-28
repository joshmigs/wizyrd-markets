"use client";

import { useEffect, useState } from "react";
import SelfExclusionNotice from "@/app/components/SelfExclusionNotice";
import BanNotice from "@/app/components/BanNotice";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export default function AuthGuard({
  children,
  fallback,
  loading
}: {
  children: React.ReactNode;
  fallback: React.ReactNode;
  loading?: React.ReactNode;
}) {
  const [ready, setReady] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [excludedUntil, setExcludedUntil] = useState<string | null>(null);
  const [bannedUntil, setBannedUntil] = useState<string | null>(null);
  const [isBanned, setIsBanned] = useState(false);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();

    const checkSelfExclusion = async (accessToken: string) => {
      const response = await fetch("/api/account/status", {
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      });
      const result = await response.json();
      if (result?.excluded) {
        setExcludedUntil(result.endsAt ?? null);
        setIsBanned(false);
        await supabase.auth.signOut();
        setSignedIn(false);
        return;
      }
      if (result?.banned) {
        setExcludedUntil(null);
        setBannedUntil(result.bannedUntil ?? null);
        setIsBanned(true);
        await supabase.auth.signOut();
        setSignedIn(false);
        return;
      }
      setIsBanned(false);
      setBannedUntil(null);
    };

    supabase.auth.getSession().then(({ data }) => {
      const session = data.session ?? null;
      setSignedIn(Boolean(session));
      if (session?.access_token) {
        checkSelfExclusion(session.access_token).finally(() => setReady(true));
      } else {
        setReady(true);
      }
    });

    const { data: subscription } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setSignedIn(Boolean(session));
        if (session?.access_token) {
          checkSelfExclusion(session.access_token).finally(() => setReady(true));
        } else {
          setReady(true);
        }
      }
    );

    return () => {
      subscription.subscription.unsubscribe();
    };
  }, []);

  if (!ready) {
    return loading ?? <p className="text-sm text-steel">Checking session...</p>;
  }

  if (excludedUntil) {
    return <SelfExclusionNotice endsAt={excludedUntil} />;
  }
  if (isBanned) {
    return <BanNotice endsAt={bannedUntil} />;
  }

  return signedIn ? children : fallback;
}

"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type League = {
  id: string;
  name: string;
  invite_code: string;
};

export default function JoinLeagueForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [inviteCode, setInviteCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const codeParam = searchParams?.get("code");
    if (codeParam) {
      setInviteCode(codeParam.toUpperCase());
    }
  }, [searchParams]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setLoading(true);

    const supabase = createSupabaseBrowserClient();
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token;

    const response = await fetch("/api/league/join", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {})
      },
      credentials: "include",
      body: JSON.stringify({ inviteCode })
    });

    const result = await response.json();

    if (!response.ok) {
      setLoading(false);
      setError(result.error ?? "Failed to join league.");
      return;
    }

    router.push("/league");
  };

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <label className="block text-sm font-semibold text-ink">
        Invite code
        <input
          className="mt-2 w-full rounded-xl border border-amber-100 bg-white px-4 py-3 text-sm tracking-[0.2em]"
          type="text"
          value={inviteCode}
          onChange={(event) => setInviteCode(event.target.value.toUpperCase())}
        />
      </label>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <button
        className="w-full rounded-full border border-navy/30 bg-white px-6 py-3 text-sm font-semibold text-navy shadow-sm shadow-navy/10 transition hover:border-navy hover:bg-navy-soft hover:text-white"
        disabled={loading}
        type="submit"
      >
        {loading ? "Joining..." : "Join league"}
      </button>
    </form>
  );
}

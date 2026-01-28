"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export default function CreateLeagueForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [seasonLengthWeeks, setSeasonLengthWeeks] = useState(12);
  const [maxMembers, setMaxMembers] = useState(10);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setLoading(true);

    const supabase = createSupabaseBrowserClient();
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token;

    const response = await fetch("/api/league/create", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {})
      },
      credentials: "include",
      body: JSON.stringify({ name, seasonLengthWeeks, maxMembers })
    });

    const result = await response.json();

    if (!response.ok) {
      setLoading(false);
      setError(result.error ?? "Failed to create league.");
      return;
    }

    router.push("/league");
  };

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <label className="block text-sm font-semibold text-ink">
        League name
        <input
          className="mt-2 w-full rounded-xl border border-amber-100 bg-white px-4 py-3 text-sm"
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <label className="block text-sm font-semibold text-ink">
        Season length
        <select
          className="mt-2 w-full rounded-xl border border-amber-100 bg-white px-4 py-3 text-sm"
          value={seasonLengthWeeks}
          onChange={(event) => setSeasonLengthWeeks(Number(event.target.value))}
        >
          <option value={4}>4 weeks</option>
          <option value={6}>6 weeks</option>
          <option value={8}>8 weeks</option>
          <option value={10}>10 weeks</option>
          <option value={12}>12 weeks</option>
          <option value={16}>16 weeks</option>
          <option value={20}>20 weeks</option>
          <option value={26}>26 weeks</option>
          <option value={39}>39 weeks</option>
          <option value={52}>52 weeks (1 year)</option>
        </select>
      </label>
      <label className="block text-sm font-semibold text-ink">
        Max members
        <select
          className="mt-2 w-full rounded-xl border border-amber-100 bg-white px-4 py-3 text-sm"
          value={maxMembers}
          onChange={(event) => setMaxMembers(Number(event.target.value))}
        >
          <option value={4}>4 members</option>
          <option value={6}>6 members</option>
          <option value={8}>8 members</option>
          <option value={10}>10 members</option>
          <option value={12}>12 members</option>
          <option value={16}>16 members</option>
          <option value={20}>20 members</option>
          <option value={24}>24 members</option>
          <option value={32}>32 members</option>
          <option value={40}>40 members</option>
          <option value={50}>50 members</option>
        </select>
      </label>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <button
        className="w-full rounded-full border border-navy/30 bg-white px-6 py-3 text-sm font-semibold text-navy shadow-sm shadow-navy/10 transition hover:border-navy hover:bg-navy-soft hover:text-white"
        disabled={loading}
        type="submit"
      >
        {loading ? "Creating league..." : "Create league"}
      </button>
    </form>
  );
}

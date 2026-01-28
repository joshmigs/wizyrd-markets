"use client";

import { useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

const OPTIONS = [
  { value: "1_week", label: "1 week" },
  { value: "2_weeks", label: "2 weeks" },
  { value: "3_weeks", label: "3 weeks" },
  { value: "4_weeks", label: "4 weeks" },
  { value: "3_months", label: "3 months" },
  { value: "6_months", label: "6 months" },
  { value: "9_months", label: "9 months" },
  { value: "1_year", label: "1 year" }
];

export default function SelfExclusionForm({
  accessToken,
  onExcluded
}: {
  accessToken: string;
  onExcluded: (endsAt: string) => void;
}) {
  const [selection, setSelection] = useState("1_week");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setLoading(true);

    const response = await fetch("/api/account/self-exclude", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`
      },
      body: JSON.stringify({ duration: selection })
    });

    const result = await response.json();
    setLoading(false);

    if (!response.ok) {
      setError(result.error ?? "Unable to start self-exclusion.");
      return;
    }

    if (result?.endsAt) {
      onExcluded(result.endsAt);
    }

    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
  };

  return (
    <form className="mt-4 space-y-4" onSubmit={handleSubmit}>
      <label className="block text-sm font-semibold text-ink">
        Self-exclusion length
        <select
          className="mt-2 w-full rounded-xl border border-amber-100 bg-white px-4 py-3 text-sm"
          value={selection}
          onChange={(event) => setSelection(event.target.value)}
        >
          {OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <p className="text-sm text-steel">
        This will immediately lock your account for the selected duration.
      </p>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <button
        className="w-full rounded-full border border-navy/30 bg-white px-6 py-3 text-sm font-semibold text-navy shadow-sm shadow-navy/10 transition hover:border-navy hover:bg-navy-soft hover:text-white"
        disabled={loading}
        type="submit"
      >
        {loading ? "Starting..." : "Start self-exclusion"}
      </button>
    </form>
  );
}

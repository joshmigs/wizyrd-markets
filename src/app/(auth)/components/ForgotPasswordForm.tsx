"use client";

import { useState } from "react";
import { createSupabasePublicClient } from "@/lib/supabase/public";

export default function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    setLoading(true);

    const supabase = createSupabasePublicClient();
    const redirectTo = `${window.location.origin}/reset-password`;

    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo
    });

    setLoading(false);

    if (resetError) {
      setError(resetError.message);
      return;
    }

    setSuccess("Check your email for a reset link.");
  };

  return (
    <form className="space-y-4" onSubmit={handleSubmit} autoComplete="on">
      <label className="block text-sm font-semibold text-ink">
        Email
        <input
          className="mt-2 w-full rounded-xl border border-amber-100 bg-white px-4 py-3 text-sm"
          type="email"
          name="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </label>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {success ? <p className="text-sm text-navy">{success}</p> : null}
      <button
        className="w-full rounded-full border border-navy/30 bg-white px-6 py-3 text-sm font-semibold text-navy shadow-sm shadow-navy/10 transition hover:border-navy hover:bg-navy-soft hover:text-white"
        disabled={loading}
        type="submit"
      >
        {loading ? "Sending..." : "Send reset link"}
      </button>
    </form>
  );
}

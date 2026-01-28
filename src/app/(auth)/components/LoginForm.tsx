"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export default function LoginForm({ redirectTo }: { redirectTo?: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const normalizeError = (message: string) => {
    if (message.toLowerCase().includes("invalid login credentials")) {
      return "Invalid password.";
    }
    if (message.toLowerCase().includes("email not confirmed")) {
      return "Email not confirmed. Check your inbox.";
    }
    return message;
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setLoading(true);

    const formData = new FormData(event.currentTarget);
    const resolvedEmail = (formData.get("email")?.toString() ?? email).trim();
    const resolvedPassword = formData.get("password")?.toString() ?? password;
    setEmail(resolvedEmail);
    setPassword(resolvedPassword);

    try {
      const supabase = createSupabaseBrowserClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: resolvedEmail,
        password: resolvedPassword
      });

      if (signInError) {
        setLoading(false);
        setError(normalizeError(signInError.message));
        return;
      }

      const { data } = await supabase.auth.getUser();
      const user = data.user;
      if (user) {
        const fallbackName = user.email?.split("@")[0] ?? "Player";
        const displayName =
          (user.user_metadata?.display_name as string | undefined) ?? fallbackName;
        await supabase.from("profiles").upsert(
          {
            id: user.id,
            display_name: displayName
          },
          {
            onConflict: "id",
            ignoreDuplicates: true
          }
        );
      }

      router.push(redirectTo ?? "/league");
    } catch (err) {
      setLoading(false);
      setError("Unable to sign in. Please try again.");
    }
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
      <label className="block text-sm font-semibold text-ink">
        Password
        <input
          className="mt-2 w-full rounded-xl border border-amber-100 bg-white px-4 py-3 text-sm"
          type="password"
          name="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </label>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <button
        className="w-full rounded-full border border-navy/30 bg-white px-6 py-3 text-sm font-semibold text-navy shadow-sm shadow-navy/10 transition hover:border-navy hover:bg-navy-soft hover:text-white"
        disabled={loading}
        type="submit"
      >
        {loading ? "Signing in..." : "Sign in"}
      </button>
    </form>
  );
}

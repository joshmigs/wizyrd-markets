"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import TeamLogo from "@/app/components/TeamLogo";

export default function SignupForm({ redirectTo }: { redirectTo?: string }) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!logoPreview) {
      return;
    }
    return () => {
      URL.revokeObjectURL(logoPreview);
    };
  }, [logoPreview]);

  const handleLogoChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    setLogoFile(file);
    if (logoPreview) {
      URL.revokeObjectURL(logoPreview);
    }
    setLogoPreview(file ? URL.createObjectURL(file) : null);
  };

  const handleLogoClear = () => {
    if (logoPreview) {
      URL.revokeObjectURL(logoPreview);
    }
    setLogoPreview(null);
    setLogoFile(null);
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setLoading(true);

    const supabase = createSupabaseBrowserClient();
    const trimmedName = displayName.trim();
    const normalizedEmail = email.trim().toLowerCase();
    const fallbackName = normalizedEmail.split("@")[0] || "Player";
    const displayNameToUse = trimmedName || fallbackName;

    const checkResponse = await fetch("/api/auth/check", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ displayName: displayNameToUse, email: normalizedEmail })
    });

    if (!checkResponse.ok) {
      setLoading(false);
      setError("Unable to validate display name. Try again.");
      return;
    }

    const { displayNameTaken, emailTaken } = (await checkResponse.json()) as {
      displayNameTaken?: boolean;
      emailTaken?: boolean;
    };

    if (emailTaken) {
      setLoading(false);
      setError("An account with this email already exists. Try logging in.");
      return;
    }

    if (displayNameTaken) {
      setLoading(false);
      setError(
        trimmedName
          ? "Display name already in use. Choose another."
          : "That display name is taken. Enter a different display name."
      );
      return;
    }

    const { data, error: signUpError } = await supabase.auth.signUp({
      email: normalizedEmail,
      password,
      options: {
        data: {
          display_name: displayNameToUse
        }
      }
    });

    if (signUpError || !data.user) {
      setLoading(false);
      const message = signUpError?.message ?? "Sign up failed.";
      const normalizedMessage = message.toLowerCase();
      if (
        normalizedMessage.includes("already registered") ||
        normalizedMessage.includes("already exists")
      ) {
        setError("An account with this email already exists. Try logging in.");
        return;
      }
      setError(message);
      return;
    }

    if ((data.user.identities ?? []).length === 0) {
      setLoading(false);
      setError("An account with this email already exists. Try logging in.");
      return;
    }

    if (!data.session) {
      setLoading(false);
      setNotice(
        "Confirmation email sent. Check your inbox (and spam) to confirm, then sign in."
      );
      return;
    }

    const { error: profileError } = await supabase.from("profiles").insert({
      id: data.user.id,
      display_name: displayNameToUse
    });

    if (profileError) {
      setLoading(false);
      const message = profileError.message ?? "Unable to save profile.";
      if (
        message.toLowerCase().includes("duplicate key") ||
        message.toLowerCase().includes("unique")
      ) {
        setError("Display name already in use. Choose another.");
        return;
      }
      setError(message);
      return;
    }

    if (logoFile && data.session) {
      const filePath = `${data.user.id}/team-logo`;
      const { error: uploadError } = await supabase.storage
        .from("team-logos")
        .upload(filePath, logoFile, { upsert: true });
      if (!uploadError) {
        const { data: publicData } = supabase.storage
          .from("team-logos")
          .getPublicUrl(filePath);
        const publicUrl = publicData?.publicUrl ?? null;
        if (publicUrl) {
          await supabase
            .from("profiles")
            .update({ team_logo_url: publicUrl })
            .eq("id", data.user.id);
        }
      }
    }

    router.push(redirectTo ?? "/league");
  };

  return (
    <form className="space-y-4" onSubmit={handleSubmit} autoComplete="on">
      <label className="block text-sm font-semibold text-ink">
        Display name
        <input
          className="mt-2 w-full rounded-xl border border-amber-100 bg-white px-4 py-3 text-sm"
          type="text"
          name="displayName"
          autoComplete="name"
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
        />
      </label>
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
          autoComplete="new-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </label>
      <div className="rounded-2xl border border-amber-100 bg-white p-4">
        <p className="text-sm font-semibold text-ink">Team logo (optional)</p>
        <p className="mt-1 text-xs text-steel">
          Upload a logo now or add one later in settings.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-4">
          <TeamLogo src={logoPreview} size={64} />
          <div className="flex flex-wrap items-center gap-2">
            <label className="cursor-pointer rounded-full border border-navy/20 bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-navy shadow-sm shadow-navy/10 transition hover:border-navy hover:bg-navy-soft hover:text-white">
              Choose logo
              <input
                type="file"
                accept="image/*"
                onChange={handleLogoChange}
                disabled={loading}
                className="sr-only"
              />
            </label>
            {logoPreview ? (
              <button
                type="button"
                onClick={handleLogoClear}
                className="rounded-full border border-amber-100 bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-navy shadow-sm shadow-navy/10 transition hover:border-navy hover:bg-navy-soft hover:text-white"
                disabled={loading}
              >
                Remove
              </button>
            ) : null}
          </div>
        </div>
      </div>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {notice ? (
        <p className="text-sm text-navy">{notice}</p>
      ) : null}
      <button
        className="w-full rounded-full border border-navy/30 bg-white px-6 py-3 text-sm font-semibold text-navy shadow-sm shadow-navy/10 transition hover:border-navy hover:bg-navy-soft hover:text-white"
        disabled={loading}
        type="submit"
      >
        {loading ? "Creating account..." : "Create account"}
      </button>
    </form>
  );
}

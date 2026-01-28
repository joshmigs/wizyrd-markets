"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabasePublicClient } from "@/lib/supabase/public";

export default function ResetPasswordForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [hasSession, setHasSession] = useState<boolean | null>(null);
  const [recoveryParams, setRecoveryParams] = useState<{
    type?: string;
    code?: string;
    tokenHash?: string;
    token?: string;
    email?: string;
    accessToken?: string;
    refreshToken?: string;
  } | null>(null);
  const [checkingLink, setCheckingLink] = useState(true);

  const establishSession = async (
    supabase: ReturnType<typeof createSupabasePublicClient>,
    params: {
      type?: string;
      code?: string;
      tokenHash?: string;
      token?: string;
      email?: string;
      accessToken?: string;
      refreshToken?: string;
    }
  ) => {
    const setSessionFromResponse = async (session: {
      access_token: string;
      refresh_token: string;
    } | null) => {
      if (session?.access_token && session?.refresh_token) {
        await supabase.auth.setSession({
          access_token: session.access_token,
          refresh_token: session.refresh_token
        });
      }
    };

    if (params.type === "recovery" && params.tokenHash) {
      const { data, error } = await supabase.auth.verifyOtp({
        type: "recovery",
        token_hash: params.tokenHash
      });
      if (error) {
        throw error;
      }
      await setSessionFromResponse(data?.session ?? null);
      return true;
    }

    if (params.type === "recovery" && params.token && params.email) {
      const { data, error } = await supabase.auth.verifyOtp({
        type: "recovery",
        token: params.token,
        email: params.email
      });
      if (error) {
        throw error;
      }
      await setSessionFromResponse(data?.session ?? null);
      return true;
    }

    if (params.type === "recovery" && params.token) {
      const { data, error } = await supabase.auth.verifyOtp({
        type: "recovery",
        token_hash: params.token
      });
      if (error) {
        throw error;
      }
      await setSessionFromResponse(data?.session ?? null);
      return true;
    }

    if (params.code) {
      const { data, error } = await supabase.auth.exchangeCodeForSession(
        params.code
      );
      if (error) {
        throw error;
      }
      await setSessionFromResponse(data?.session ?? null);
      return true;
    }

    if (params.accessToken && params.refreshToken) {
      await supabase.auth.setSession({
        access_token: params.accessToken,
        refresh_token: params.refreshToken
      });
      return true;
    }

    return false;
  };

  useEffect(() => {
    const supabase = createSupabasePublicClient();

    const syncSessionFromUrl = async () => {
      const url = new URL(window.location.href);
      const hashParams = new URLSearchParams(window.location.hash.slice(1));
      const queryParams = new URLSearchParams(window.location.search);

      const params = {
        type: url.searchParams.get("type") ?? hashParams.get("type") ?? undefined,
        code: url.searchParams.get("code") ?? undefined,
        tokenHash:
          url.searchParams.get("token_hash") ??
          hashParams.get("token_hash") ??
          undefined,
        token: url.searchParams.get("token") ?? hashParams.get("token") ?? undefined,
        email: url.searchParams.get("email") ?? hashParams.get("email") ?? undefined,
        accessToken:
          hashParams.get("access_token") ?? queryParams.get("access_token") ?? undefined,
        refreshToken:
          hashParams.get("refresh_token") ??
          queryParams.get("refresh_token") ??
          undefined
      };

      const hasRecoveryData = Boolean(
        params.code ||
          params.tokenHash ||
          params.token ||
          params.accessToken ||
          params.refreshToken
      );

      setRecoveryParams(hasRecoveryData ? params : null);

      const { data } = await supabase.auth.getSession();
      if (data.session) {
        setHasSession(true);
        setCheckingLink(false);
        return;
      }

      if (hasRecoveryData) {
        try {
          await establishSession(supabase, params);
        } catch (sessionError) {
          console.error(sessionError);
        }
      }

      const { data: finalData } = await supabase.auth.getSession();
      setHasSession(Boolean(finalData.session));
      setCheckingLink(false);
    };

    syncSessionFromUrl();

    const { data: subscription } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setHasSession(Boolean(session));
      }
    );

    return () => {
      subscription.subscription.unsubscribe();
    };
  }, []);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    if (!password || password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    const supabase = createSupabasePublicClient();
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session) {
      if (!recoveryParams) {
        setLoading(false);
        setError("Reset link expired. Request another reset email.");
        return;
      }

      try {
        const established = await establishSession(supabase, recoveryParams);
        if (!established) {
          setLoading(false);
          setError("Reset link expired. Request another reset email.");
          return;
        }
      } catch (sessionError) {
        console.error(sessionError);
        setLoading(false);
        setError("Reset link expired. Request another reset email.");
        return;
      }

      const { data: refreshed } = await supabase.auth.getSession();
      if (!refreshed.session) {
        setLoading(false);
        setError("Reset link expired. Request another reset email.");
        return;
      }
    }

    const { error: updateError } = await supabase.auth.updateUser({
      password
    });

    setLoading(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    await supabase.auth.signOut();
    setSuccess("Password updated. Please log in with your new password.");
    router.push("/login?reset=success");
  };

  const canAttemptReset = hasSession || recoveryParams;

  if (!checkingLink && !canAttemptReset) {
    return (
      <div className="space-y-4 text-sm text-steel">
        <p>
          We could not verify your reset link. This usually means the redirect
          URL is not allowed in Supabase, so no recovery token was included.
        </p>
        <p>
          Fix it in Supabase Auth URL settings, then request a new reset link.
        </p>
        <p>
          Need a new link?{" "}
          <a className="font-semibold text-navy" href="/forgot-password">
            Request another reset
          </a>
        </p>
      </div>
    );
  }

  if (checkingLink) {
    return <p className="text-sm text-steel">Checking reset link...</p>;
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit} autoComplete="on">
      <label className="block text-sm font-semibold text-ink">
        New password
        <input
          className="mt-2 w-full rounded-xl border border-amber-100 bg-white px-4 py-3 text-sm"
          type="password"
          name="newPassword"
          autoComplete="new-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </label>
      <label className="block text-sm font-semibold text-ink">
        Confirm password
        <input
          className="mt-2 w-full rounded-xl border border-amber-100 bg-white px-4 py-3 text-sm"
          type="password"
          name="confirmPassword"
          autoComplete="new-password"
          required
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
        />
      </label>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {success ? <p className="text-sm text-navy">{success}</p> : null}
      <button
        className="w-full rounded-full border border-navy/30 bg-white px-6 py-3 text-sm font-semibold text-navy shadow-sm shadow-navy/10 transition hover:border-navy hover:bg-navy-soft hover:text-white"
        disabled={loading}
        type="submit"
      >
        {loading ? "Updating..." : "Update password"}
      </button>
    </form>
  );
}

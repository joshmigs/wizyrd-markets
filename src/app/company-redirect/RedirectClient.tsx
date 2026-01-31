"use client";

import { useEffect, useState } from "react";

type RedirectClientProps = {
  ticker: string;
};

const normalizeWebsite = (value?: string | null) => {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }
  return `https://${trimmed}`;
};

export default function RedirectClient({ ticker }: RedirectClientProps) {
  const [status, setStatus] = useState<"loading" | "missing" | "error">("loading");

  useEffect(() => {
    if (!ticker) {
      setStatus("missing");
      return;
    }
    const run = async () => {
      try {
        const response = await fetch(
          `/api/company/website?ticker=${encodeURIComponent(ticker)}`
        );
        const result = await response.json().catch(() => ({}));
        const url = normalizeWebsite(result?.website ?? null);
        if (url) {
          window.location.replace(url);
          return;
        }
        setStatus("missing");
      } catch {
        setStatus("error");
      }
    };
    void run();
  }, [ticker]);

  if (status === "loading") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 text-white">
        <p className="text-sm uppercase tracking-[0.2em] text-white/70">
          Finding company website…
        </p>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-6 text-center text-white">
      <div className="max-w-md space-y-3">
        <h1 className="text-xl font-semibold">Website unavailable</h1>
        <p className="text-sm text-white/70">
          We couldn’t find a website for {ticker || "this company"}.
        </p>
      </div>
    </main>
  );
}

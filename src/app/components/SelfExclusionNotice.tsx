"use client";

import Link from "next/link";

export default function SelfExclusionNotice({ endsAt }: { endsAt?: string | null }) {
  const formatted = endsAt
    ? new Date(endsAt).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short"
      })
    : null;

  return (
    <div className="mx-auto w-full max-w-md rounded-3xl border border-amber-200/70 bg-white/95 p-6 text-sm text-steel shadow-[0_20px_60px_rgba(20,20,20,0.15)]">
      <p className="text-xs uppercase tracking-[0.2em] text-navy">
        Account locked
      </p>
      <h1 className="mt-2 font-display text-2xl text-ink">
        Self-exclusion active
      </h1>
      <p className="mt-1">
        You set a self-exclusion and can’t access your account until it expires.
      </p>
      {formatted ? (
        <p className="mt-2 font-semibold text-navy">
          Ends: {formatted}
        </p>
      ) : null}
      <p className="mt-3">
        Need help? Contact{" "}
        <a className="font-semibold text-navy" href="mailto:support@wizyrd.com">
          support@wizyrd.com
        </a>
        .
      </p>
      <p className="mt-3">
        <Link className="font-semibold text-navy" href="/">
          Back to home
        </Link>
      </p>
    </div>
  );
}

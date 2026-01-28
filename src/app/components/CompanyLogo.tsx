"use client";

import { useEffect, useMemo, useState } from "react";

type CompanyLogoProps = {
  ticker?: string | null;
  size?: number;
  className?: string;
  rounded?: boolean;
  muted?: boolean;
};

const buildLogoUrl = (ticker: string) =>
  `https://storage.googleapis.com/iex/api/logos/${ticker.toUpperCase()}.png`;

export default function CompanyLogo({
  ticker,
  size = 32,
  className = "",
  rounded = true,
  muted = false
}: CompanyLogoProps) {
  const [useFallback, setUseFallback] = useState(false);
  const normalized = useMemo(
    () => (ticker ? ticker.trim().toUpperCase() : ""),
    [ticker]
  );

  useEffect(() => {
    setUseFallback(false);
  }, [normalized]);

  const hasTicker = Boolean(normalized);
  const spLogo = normalized === "SPY" ? "/brand/sp500-logo.svg" : null;
  const src =
    spLogo ??
    (useFallback || !hasTicker ? "/brand/wizyrd-logo.png" : buildLogoUrl(normalized));
  const containerClasses = [
    "flex shrink-0 items-center justify-center overflow-hidden border border-white/40 bg-white/80 shadow-sm shadow-navy/10",
    rounded ? "rounded-xl" : "rounded-md",
    muted ? "opacity-70" : "",
    className
  ]
    .filter(Boolean)
    .join(" ");
  const imageClasses = [
    "h-full w-full object-contain",
    rounded ? "rounded-xl" : "rounded-md",
    muted ? "grayscale" : ""
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={containerClasses} style={{ width: size, height: size }}>
      <img
        src={src}
        alt={normalized ? `${normalized} logo` : "Wizyrd logo"}
        className={imageClasses}
        loading="lazy"
        onError={() => setUseFallback(true)}
      />
    </div>
  );
}

"use client";

import type { MouseEvent } from "react";

type TickerNewsButtonProps = {
  ticker: string;
  className?: string;
  label?: string;
  as?: "button" | "span";
};

export default function TickerNewsButton({
  ticker,
  className,
  label,
  as = "button"
}: TickerNewsButtonProps) {
  const handleClick = (event: MouseEvent<HTMLButtonElement | HTMLSpanElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (typeof window === "undefined") {
      return;
    }
    window.dispatchEvent(
      new CustomEvent("news:open", {
        detail: { ticker: ticker.toUpperCase() }
      })
    );
  };

  const content = (
    <>
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="h-3.5 w-3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="4" y="5" width="16" height="14" rx="2" />
        <path d="M8 8h5" />
        <path d="M8 11h5" />
        <path d="M8 14h5" />
        <path d="M14 8h4" />
        <path d="M14 11h4" />
        <path d="M14 14h4" />
      </svg>
    </>
  );

  const baseClassName = `flex h-5 w-5 items-center justify-center rounded-full border border-amber-200 bg-amber-50 text-amber-900 shadow-sm shadow-amber-200/40 transition hover:border-amber-300 hover:bg-amber-100 ${className ?? ""}`;
  const ariaLabel = label ?? `Open ${ticker} news`;

  if (as === "span") {
    return (
      <span
        role="button"
        tabIndex={0}
        aria-label={ariaLabel}
        onClick={handleClick}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            handleClick(event as unknown as MouseEvent<HTMLSpanElement>);
          }
        }}
        className={baseClassName}
      >
        {content}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={ariaLabel}
      className={baseClassName}
    >
      {content}
    </button>
  );
}

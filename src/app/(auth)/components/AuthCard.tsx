import type { ReactNode } from "react";
import LogoMark from "@/app/components/LogoMark";

export default function AuthCard({
  title,
  subtitle,
  children
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-md rounded-3xl border border-amber-200/70 bg-white/90 p-6 shadow-[0_20px_60px_rgba(20,20,20,0.15)]">
      <div className="flex items-center gap-3 -ml-6">
        <LogoMark size={52} priority className="-mr-4" />
        <p className="min-w-0 flex-1 text-xs uppercase tracking-[0.2em] text-navy leading-snug">
          Fantasy Markets
        </p>
      </div>
      <h1 className="mt-2 font-display text-3xl text-ink">{title}</h1>
      <p className="mt-1 text-sm text-steel">{subtitle}</p>
      <div className="mt-4">{children}</div>
    </div>
  );
}

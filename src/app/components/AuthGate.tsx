import Link from "next/link";
import LogoMark from "@/app/components/LogoMark";

export default function AuthGate({
  title,
  subtitle,
  nextPath
}: {
  title: string;
  subtitle: string;
  nextPath: string;
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
      <div className="mt-4 flex flex-col gap-3">
        <Link
          className="w-full rounded-full border border-navy/30 bg-white px-6 py-3 text-center text-sm font-semibold text-navy shadow-sm shadow-navy/10 transition hover:border-navy hover:bg-navy-soft hover:text-white"
          href={`/login?next=${encodeURIComponent(nextPath)}`}
        >
          Log in
        </Link>
        <Link
          className="w-full rounded-full border border-navy/30 bg-white px-6 py-3 text-center text-sm font-semibold text-navy shadow-sm shadow-navy/10 transition hover:border-navy hover:bg-navy-soft hover:text-white"
          href={`/signup?next=${encodeURIComponent(nextPath)}`}
        >
          Sign up
        </Link>
      </div>
    </div>
  );
}

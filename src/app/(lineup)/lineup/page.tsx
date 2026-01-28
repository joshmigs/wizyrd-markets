import AuthGate from "@/app/components/AuthGate";
import AuthGuard from "@/app/components/AuthGuard";
import LogoMark from "@/app/components/LogoMark";
import LineupForm from "@/app/(lineup)/components/LineupForm";

export default function LineupPage() {
  return (
    <main className="px-6 py-8">
      <AuthGuard
        fallback={
          <AuthGate
            title="Set your lineup"
            subtitle="Sign in or create an account to submit picks."
            nextPath="/lineup"
          />
        }
      >
        <div className="mx-auto max-w-3xl space-y-6">
          <header className="rounded-3xl border border-amber-200/70 bg-white/90 p-4 shadow-[0_20px_60px_rgba(20,20,20,0.12)]">
            <div className="flex flex-col items-center gap-3 text-center md:flex-row md:items-center md:text-left">
              <LogoMark size={44} />
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.35em] text-navy">
                  Weekly lineup
                </p>
                <h1 className="mt-1 font-display text-3xl text-ink">
                  Set your weights
                </h1>
                <p className="mt-1 text-sm text-steel">
                  Final lineup locks Sunday 4:00 PM ET. Weights must sum to 100%.
                </p>
              </div>
            </div>
          </header>

          <div
            id="lineup-live"
            className="rounded-2xl border border-amber-100 bg-white p-6"
          >
            <LineupForm />
          </div>
        </div>
      </AuthGuard>
    </main>
  );
}

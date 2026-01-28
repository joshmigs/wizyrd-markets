import AuthGate from "@/app/components/AuthGate";
import AuthGuard from "@/app/components/AuthGuard";
import LogoMark from "@/app/components/LogoMark";
import JoinLeagueForm from "@/app/(league)/components/JoinLeagueForm";

export default function JoinLeaguePage({
  searchParams
}: {
  searchParams?: { code?: string };
}) {
  const inviteCode = searchParams?.code;
  const nextPath = inviteCode
    ? `/league/join?code=${encodeURIComponent(inviteCode)}`
    : "/league/join";

  return (
    <main className="px-6 py-8">
      <AuthGuard
        fallback={
          <AuthGate
            title="Join league"
            subtitle="Sign in or create an account to continue."
            nextPath={nextPath}
          />
        }
      >
        <div className="mx-auto w-full max-w-md rounded-3xl border border-amber-200/70 bg-white/90 p-6 shadow-[0_20px_60px_rgba(20,20,20,0.15)]">
          <div className="text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.35em] text-navy underline decoration-navy/40 underline-offset-8">
              League setup
            </p>
            <div className="mt-3 flex justify-center">
              <LogoMark size={52} />
            </div>
          </div>
          <h1 className="mt-2 font-display text-3xl text-ink">Join league</h1>
          <p className="mt-1 text-sm text-steel">
            Enter a private invite code to join a league.
          </p>
          <div className="mt-4">
            <JoinLeagueForm />
          </div>
        </div>
      </AuthGuard>
    </main>
  );
}

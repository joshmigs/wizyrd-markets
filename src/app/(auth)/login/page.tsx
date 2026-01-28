import Link from "next/link";
import AuthCard from "@/app/(auth)/components/AuthCard";
import LoginForm from "@/app/(auth)/components/LoginForm";
import { getSafeRedirect } from "@/lib/redirect";

export default function LoginPage({
  searchParams
}: {
  searchParams?: { next?: string; reset?: string; reason?: string };
}) {
  const safeNext =
    searchParams?.reason === "signout" ? null : getSafeRedirect(searchParams?.next);
  const redirectTo = safeNext && safeNext !== "/" ? safeNext : "/league";
  const resetSuccess = searchParams?.reset === "success";

  return (
    <main className="px-6 py-8">
      <AuthCard
        title="Welcome back"
        subtitle="Lock your lineup before the bell."
      >
        <LoginForm redirectTo={redirectTo} />
        {resetSuccess ? (
          <p className="mt-4 rounded-xl border border-navy/30 bg-navy/10 px-4 py-3 text-sm text-navy">
            Password updated. Log in with your new password.
          </p>
        ) : null}
        <p className="mt-4 text-center text-sm text-steel">
          <Link className="font-semibold text-navy" href="/forgot-password">
            Forgot password?
          </Link>
        </p>
        <p className="mt-2 text-center text-sm text-steel">
          New here?{" "}
          <Link
            className="font-semibold text-navy"
            href={`/signup?next=${encodeURIComponent(redirectTo)}`}
          >
            Create an account
          </Link>
        </p>
      </AuthCard>
    </main>
  );
}

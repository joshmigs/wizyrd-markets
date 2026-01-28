import Link from "next/link";
import AuthCard from "@/app/(auth)/components/AuthCard";
import SignupForm from "@/app/(auth)/components/SignupForm";
import { getSafeRedirect } from "@/lib/redirect";

export default function SignupPage({
  searchParams
}: {
  searchParams?: { next?: string };
}) {
  const redirectTo = getSafeRedirect(searchParams?.next) ?? "/league";

  return (
    <main className="px-6 py-8">
      <AuthCard
        title="Create your account"
        subtitle="Start a private league or join one in minutes."
      >
        <SignupForm redirectTo={redirectTo} />
        <p className="mt-4 text-center text-sm text-steel">
          Already have an account?{" "}
          <Link
            className="font-semibold text-navy"
            href={`/login?next=${encodeURIComponent(redirectTo)}`}
          >
            Log in
          </Link>
        </p>
      </AuthCard>
    </main>
  );
}

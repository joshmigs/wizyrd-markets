import Link from "next/link";
import AuthCard from "@/app/(auth)/components/AuthCard";
import ForgotPasswordForm from "@/app/(auth)/components/ForgotPasswordForm";

export default function ForgotPasswordPage() {
  return (
    <main className="px-6 py-8">
      <AuthCard
        title="Reset your password"
        subtitle="We will email you a reset link."
      >
        <ForgotPasswordForm />
        <p className="mt-4 text-center text-sm text-steel">
          Remembered it?{" "}
          <Link className="font-semibold text-navy" href="/login">
            Log in
          </Link>
        </p>
      </AuthCard>
    </main>
  );
}

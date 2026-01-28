import Link from "next/link";
import AuthCard from "@/app/(auth)/components/AuthCard";
import ResetPasswordForm from "@/app/(auth)/components/ResetPasswordForm";

export default function ResetPasswordPage() {
  return (
    <main className="px-6 py-8">
      <AuthCard
        title="Set a new password"
        subtitle="Choose something secure and memorable."
      >
        <ResetPasswordForm />
        <p className="mt-4 text-center text-sm text-steel">
          Back to{" "}
          <Link className="font-semibold text-navy" href="/login">
            Log in
          </Link>
        </p>
      </AuthCard>
    </main>
  );
}

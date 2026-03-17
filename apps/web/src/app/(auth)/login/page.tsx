import { LoginForm } from "@/components/auth/login-form";

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="w-full max-w-sm space-y-6 rounded-lg border border-[var(--border)] bg-[var(--card)] p-8">
        <div className="text-center">
          <h1 className="text-2xl font-bold">TriageIt</h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            AI-Powered Ticket Triage
          </p>
        </div>
        <LoginForm />
      </div>
    </div>
  );
}

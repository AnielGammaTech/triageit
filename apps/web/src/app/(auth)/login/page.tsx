import { LoginForm } from "@/components/auth/login-form";

export default function LoginPage() {
  return (
    <div
      className="flex min-h-screen items-center justify-center"
      style={{ backgroundColor: "#13082E" }}
    >
      <div className="w-full max-w-sm space-y-6 rounded-xl border border-white/10 bg-[#1a0f35] p-8 shadow-2xl">
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-[#6366f1] text-sm font-bold text-white">
            T
          </div>
          <h1 className="text-2xl font-bold text-white">TriageIt</h1>
          <p className="mt-1 text-sm text-white/50">
            AI-Powered Ticket Triage
          </p>
        </div>
        <LoginForm />
      </div>
    </div>
  );
}

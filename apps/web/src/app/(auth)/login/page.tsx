import { LoginForm } from "@/components/auth/login-form";

export default function LoginPage() {
  return (
    <div
      className="flex min-h-screen items-center justify-center"
      style={{ backgroundColor: "#1a0a0a" }}
    >
      <div className="w-full max-w-sm space-y-6 rounded-xl border border-white/10 bg-[#241010] p-8 shadow-2xl">
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-[#b91c1c]">
            <svg width="24" height="24" viewBox="0 0 16 16" fill="none">
              <text x="3" y="12.5" fontFamily="Inter, system-ui, sans-serif" fontSize="12" fontWeight="800" fill="white">T</text>
              <circle cx="13" cy="11.5" r="1.5" fill="#ef4444" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-white">
            Triage<span className="text-[#b91c1c]">IT</span>
          </h1>
          <p className="mt-1 text-sm text-white/50">
            AI-Powered Ticket Triage
          </p>
        </div>
        <LoginForm />
      </div>
    </div>
  );
}

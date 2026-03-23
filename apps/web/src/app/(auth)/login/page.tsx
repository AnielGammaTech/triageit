import { LoginForm } from "@/components/auth/login-form";

export default function LoginPage() {
  return (
    <div
      className="flex min-h-screen items-center justify-center"
      style={{ backgroundColor: "#1a0a0a" }}
    >
      <div className="w-full max-w-sm space-y-6 rounded-xl border border-white/10 bg-[#241010] p-8 shadow-2xl">
        <div className="text-center">
          <div className="relative mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-[#b91c1c] text-base font-extrabold text-white">
            T
            <span
              className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2"
              style={{ backgroundColor: "#ef4444", borderColor: "#241010" }}
            />
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

import { LoginForm } from "@/components/auth/login-form";
import { Radar, ShieldCheck, Zap } from "lucide-react";

/**
 * Login — split hero layout. Left: brand hero with live-ops flavor.
 * Right: clean form panel. Mirrors the QuoteIT login structure with
 * TriageIT's violet identity.
 */
export default function LoginPage() {
  return (
    <div className="flex min-h-screen">
      <HeroPanel />

      {/* ── Form panel ─────────────────────────────────────── */}
      <div className="flex w-full flex-col bg-white lg:w-[45%]">
        <div className="flex flex-1 flex-col items-center justify-center px-8 sm:px-16">
          <div className="w-full max-w-md">
            {/* Mobile brand */}
            <div className="mb-8 flex items-center justify-center gap-2.5 lg:hidden">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-[#f87171] to-[#b91c1c]">
                <Radar className="h-5 w-5 text-white" />
              </div>
              <span className="text-lg font-bold tracking-tight text-[#171233]">
                Triage<span className="text-[#b91c1c]">IT</span>
              </span>
            </div>

            <h1 className="mb-1 text-3xl font-bold tracking-tight text-[#171233]">
              Welcome back
            </h1>
            <p className="mb-8 text-slate-500">
              Sign in to your triage command center.
            </p>

            <LoginForm />

            <p className="mt-6 text-center text-xs text-slate-500">
              Need access?{" "}
              <span className="cursor-pointer font-semibold text-[#b91c1c] hover:underline">
                Ask your administrator
              </span>
            </p>
          </div>

          <div className="mt-12 flex items-center gap-4 text-[11px] text-slate-400">
            <span>
              Powered by{" "}
              <span className="font-medium text-slate-600">Gamma Tech Services</span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Hero Panel ──────────────────────────────────────────────────────────

function HeroPanel() {
  return (
    <div
      className="relative hidden overflow-hidden lg:flex lg:w-[55%]"
      style={{ background: "linear-gradient(135deg, #0a0505, #1c0a0a 45%, #3b0d0d)" }}
    >
      {/* Ambient orbs */}
      <div
        className="absolute -right-40 -top-40 h-[500px] w-[500px] rounded-full blur-3xl"
        style={{ background: "rgba(248,113,113,0.16)" }}
      />
      <div
        className="absolute -bottom-40 -left-20 h-[400px] w-[400px] rounded-full blur-3xl"
        style={{ background: "rgba(185,28,28,0.12)" }}
      />
      {/* Dot grid */}
      <div
        className="absolute inset-0 opacity-[0.05]"
        style={{
          backgroundImage: "radial-gradient(circle, white 1px, transparent 1px)",
          backgroundSize: "28px 28px",
        }}
      />

      <div className="relative z-10 flex w-full flex-col justify-between p-14">
        {/* Brand */}
        <div className="flex items-center gap-3">
          <div
            className="flex h-10 w-10 items-center justify-center rounded-xl"
            style={{
              background: "linear-gradient(135deg, #f87171, #b91c1c)",
              boxShadow: "0 0 30px -8px rgba(248,113,113,0.7)",
            }}
          >
            <Radar className="h-5 w-5 text-white" />
          </div>
          <span className="text-lg font-bold tracking-tight text-white">
            Triage<span className="text-[#fca5a5]">IT</span>
          </span>
        </div>

        {/* Headline + live card */}
        <div className="relative max-w-xl">
          <div
            className="mb-6 inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px] font-semibold text-white"
            style={{
              background: "rgba(248,113,113,0.16)",
              border: "1px solid rgba(248,113,113,0.4)",
            }}
          >
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#f87171]" />
            Live · every ticket triaged in under 2 minutes
          </div>

          <h2 className="mb-5 text-[48px] font-extrabold leading-[1.05] tracking-tight text-white">
            Every ticket,
            <br />
            <span className="text-[#fca5a5]">already understood.</span>
          </h2>
          <p className="max-w-md text-lg leading-relaxed text-slate-300/90">
            Thirteen AI specialists read, investigate, and prioritize every
            ticket before your techs even open it.
          </p>

          {/* Live pipeline card */}
          <div
            className="relative mt-10 max-w-md rounded-2xl border border-white/10 p-5"
            style={{
              background: "rgba(255,255,255,0.05)",
              backdropFilter: "blur(12px)",
              boxShadow: "0 20px 60px -12px rgba(0,0,0,0.5)",
            }}
          >
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-white/60">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                Triage pipeline
              </div>
              <span className="font-mono text-[10px] text-white/40">Live</span>
            </div>

            <div className="mb-4 flex items-baseline gap-3">
              <span className="text-3xl font-extrabold text-white">245</span>
              <span className="text-xs font-semibold text-emerald-400">
                triages today
              </span>
            </div>

            {/* Severity distribution */}
            <div className="space-y-2.5">
              {[
                { label: "Critical", pct: 8, color: "#ff4d5e" },
                { label: "High", pct: 22, color: "#ff8a3d" },
                { label: "Routine", pct: 70, color: "#3ddc84" },
              ].map((row) => (
                <div key={row.label} className="flex items-center gap-3">
                  <span className="w-14 font-mono text-[10px] text-white/50">
                    {row.label}
                  </span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${row.pct}%`,
                        background: `linear-gradient(90deg, ${row.color}99, ${row.color})`,
                      }}
                    />
                  </div>
                  <span className="w-8 text-right font-mono text-[10px] text-white/40">
                    {row.pct}%
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Floating agent chip */}
          <div className="absolute -right-6 top-[25rem] flex animate-[float_6s_ease-in-out_infinite] items-center gap-2.5 rounded-xl border border-white/20 bg-white/95 p-3 shadow-2xl backdrop-blur">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#b91c1c] text-xs font-bold text-white">
              AM
            </div>
            <div>
              <div className="text-xs font-semibold text-slate-900">
                Angela flagged a security risk
              </div>
              <div className="text-[10px] text-slate-500">
                MFA disabled on breached account · just now
              </div>
            </div>
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-red-100">
              <ShieldCheck className="h-3 w-3 text-red-600" />
            </div>
          </div>
        </div>

        {/* Footer stats */}
        <div className="flex items-center gap-8">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10">
              <Zap className="h-4 w-4 text-[#fca5a5]" />
            </div>
            <div>
              <div className="text-xs font-semibold text-white">
                13 AI specialists on every ticket
              </div>
              <div className="text-[11px] text-white/50">
                Hudu · Datto · M365 · UniFi · security &amp; more
              </div>
            </div>
          </div>
        </div>
      </div>

      <style>{`@keyframes float { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-8px); } }`}</style>
    </div>
  );
}

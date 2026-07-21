import { FileSearch, Mic2, ShieldCheck, Sparkles } from "lucide-react";
import { PasswordLogin } from "@/components/password-login";
import { ScreenItLogo } from "@/components/screenit-logo";

export default function LoginPage() {
  return <main className="grid min-h-screen bg-white lg:grid-cols-[1.05fr_.95fr]">
    <section className="screenit-dot-grid relative hidden overflow-hidden bg-[linear-gradient(145deg,#10241f_0%,#123b33_58%,#0c5f57_125%)] p-12 text-white lg:flex lg:flex-col lg:justify-between">
      <span className="screenit-hero-orb pointer-events-none absolute -right-24 top-1/4 h-80 w-80 rounded-full border border-teal-100/10 bg-teal-300/[0.06]" />
      <span className="pointer-events-none absolute -left-36 bottom-12 h-80 w-80 rounded-full border-[42px] border-white/[0.025]" />
      <div className="relative z-10"><ScreenItLogo /></div>
      <div className="relative z-10 max-w-xl">
        <div className="inline-flex items-center gap-2 rounded-full border border-teal-200/15 bg-teal-300/[0.07] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-teal-200"><Sparkles className="h-3.5 w-3.5" />Structured interview operations</div>
        <h1 className="mt-6 text-5xl font-bold leading-[1.02] tracking-[-0.055em]">Hear the person.<br /><span className="text-teal-300">Keep the evidence.</span></h1>
        <p className="mt-5 max-w-lg text-lg leading-8 text-slate-300">Resume-aware screening conversations and clear recruiter reports—without replacing the human decision.</p>
        <div className="mt-8 grid max-w-lg gap-2 sm:grid-cols-3">
          {[{ icon: FileSearch, label: "Reads the résumé", detail: "Grounded questions" }, { icon: Mic2, label: "Listens naturally", detail: "Candidate-led calls" }, { icon: ShieldCheck, label: "Reports evidence", detail: "Humans decide" }].map((item) => { const Icon = item.icon; return <div key={item.label} className="rounded-xl border border-white/10 bg-white/[0.05] p-3 backdrop-blur"><Icon className="h-4 w-4 text-teal-300" /><p className="mt-3 text-xs font-semibold text-white">{item.label}</p><p className="mt-1 text-[10px] text-slate-400">{item.detail}</p></div>; })}
        </div>
      </div>
      <div className="relative z-10 flex items-center justify-between text-[10px] text-slate-500"><span>Gamma Tech Services · Internal recruiting system</span><span className="flex items-center gap-1.5 text-teal-200/70"><span className="h-1.5 w-1.5 rounded-full bg-teal-300" />Secure staff workspace</span></div>
    </section>
    <section className="relative grid place-items-center overflow-hidden bg-[radial-gradient(circle_at_80%_10%,rgba(20,184,166,.08),transparent_20rem)] p-6">
      <span className="pointer-events-none absolute -right-20 -top-20 h-56 w-56 rounded-full border-[36px] border-teal-50" />
      <div className="relative z-10 w-full max-w-md">
        <div className="mb-8 lg:hidden"><ScreenItLogo dark /></div>
        <div className="screenit-panel rounded-[24px] p-6 shadow-[0_28px_70px_-44px_rgba(15,67,59,.5)] sm:p-8">
          <div className="flex items-center justify-between"><p className="text-[10px] font-bold uppercase tracking-[0.2em] text-teal-700">Staff access</p><span className="flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-bold text-emerald-700"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />Online</span></div>
          <h2 className="mt-3 text-3xl font-bold tracking-[-0.04em] text-slate-950">Welcome to ScreenIT</h2>
          <p className="mt-2 text-sm leading-6 text-slate-500">Sign in to manage positions, candidate interviews, and recruiter-ready evidence.</p>
          <div className="mt-7"><PasswordLogin /></div>
          <div className="mt-6 border-t border-slate-100 pt-5 text-center"><p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">Authorized Gamma Tech staff only</p></div>
        </div>
      </div>
    </section>
  </main>;
}

import Link from "next/link";
import { ArrowRight, CheckCircle2, CircleAlert, FileCheck2, MessageSquareText, ShieldCheck, Sparkles } from "lucide-react";
import { PageHeading } from "@/components/page-heading";
import { getWorkspaceSnapshot } from "@/lib/data";
import type { CandidateReport } from "@/lib/screenit-types";

export const dynamic = "force-dynamic";

const alignmentStyle: Record<CandidateReport["roleAlignment"], string> = {
  strong_alignment: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  partial_alignment: "bg-blue-50 text-blue-700 ring-blue-200",
  limited_alignment: "bg-amber-50 text-amber-700 ring-amber-200",
  insufficient_evidence: "bg-slate-100 text-slate-600 ring-slate-200",
};

const answerQualityStyle: Record<CandidateReport["answerQuality"], string> = {
  strong: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  mixed: "bg-blue-50 text-blue-700 ring-blue-200",
  weak: "bg-rose-50 text-rose-700 ring-rose-200",
  insufficient: "bg-amber-50 text-amber-700 ring-amber-200",
  not_assessed: "bg-slate-100 text-slate-600 ring-slate-200",
};

export default async function ReportsPage() {
  const workspace = await getWorkspaceSnapshot();
  const strong = workspace.reports.filter((report) => report.roleAlignment === "strong_alignment").length;
  const signals = workspace.reports.reduce((total, report) => total + report.conversationSignals.length, 0);
  const clarifications = workspace.reports.reduce((total, report) => total + report.clarifications.length, 0);

  return <div className="screenit-rise space-y-5">
    <PageHeading eyebrow="Human review" title="Interview reports" description="See the evidence, working-style signals, and open questions behind every recruiter decision." />

    <section className="grid gap-3 sm:grid-cols-3">
      {[{ label: "Reports ready", value: workspace.reports.length, detail: "Completed screenings", icon: FileCheck2, tone: "bg-teal-50 text-teal-700" }, { label: "Strong alignment", value: strong, detail: "Evidence still requires review", icon: ShieldCheck, tone: "bg-emerald-50 text-emerald-700" }, { label: "Open clarifications", value: clarifications, detail: `${signals} working-style signals captured`, icon: CircleAlert, tone: "bg-amber-50 text-amber-700" }].map((metric) => { const Icon = metric.icon; return <article key={metric.label} className="screenit-panel screenit-panel-hover flex items-center gap-4 rounded-2xl p-4"><span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${metric.tone}`}><Icon className="h-4.5 w-4.5" /></span><div><p className="text-xl font-bold tracking-[-0.03em] text-slate-950">{metric.value}</p><p className="text-xs font-semibold text-slate-700">{metric.label}</p><p className="mt-0.5 text-[10px] text-slate-400">{metric.detail}</p></div></article>; })}
    </section>

    {workspace.reports.length ? <div className="grid gap-4 xl:grid-cols-2">{workspace.reports.map((report) => {
      const candidate = workspace.candidates.find((item) => item.id === report.candidateId);
      const position = workspace.positions.find((item) => item.id === candidate?.positionId);
      const demonstrated = report.evidence.filter((item) => item.level === "demonstrated").length;
      const evidenceRate = report.evidence.length ? Math.round((demonstrated / report.evidence.length) * 100) : 0;
      return <Link key={report.id} href={`/candidates/${report.candidateId}`} className="screenit-panel screenit-panel-hover group overflow-hidden rounded-[20px]">
        <div className="h-1 bg-gradient-to-r from-teal-500 via-emerald-400 to-teal-200" />
        <div className="p-5">
          <div className="flex items-start justify-between gap-3"><div className="flex min-w-0 items-center gap-3"><span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-emerald-950 to-teal-700 text-xs font-bold text-white shadow-sm">{(candidate?.name ?? "Candidate").split(" ").map((part) => part[0]).join("")}</span><div className="min-w-0"><p className="truncate text-lg font-bold tracking-[-0.02em] text-slate-950">{candidate?.name ?? "Candidate"}</p><p className="mt-0.5 truncate text-xs text-slate-500">{position?.title ?? "Position"} · {new Date(report.generatedAt).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}</p></div></div><span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold capitalize ring-1 ${alignmentStyle[report.roleAlignment]}`}>{report.roleAlignment.replaceAll("_", " ")}</span></div>
          <p className="mt-4 line-clamp-3 text-sm leading-6 text-slate-600">{report.summary}</p>
          <div className={`mt-4 rounded-xl p-3 ring-1 ${answerQualityStyle[report.answerQuality]}`}><div className="flex flex-wrap items-center justify-between gap-2"><span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider"><CircleAlert className="h-3.5 w-3.5" />Answer quality</span><span className="rounded-full bg-white/70 px-2 py-0.5 text-[10px] font-bold capitalize">{report.answerQuality.replaceAll("_", " ")}</span></div><p className="mt-1.5 line-clamp-2 text-xs leading-5">{report.answerQualityRationale}</p>{report.answerConcerns.length > 0 && <p className="mt-1 text-[10px] font-semibold">{report.answerConcerns.length} concrete concern{report.answerConcerns.length === 1 ? "" : "s"} to review</p>}</div>
          <div className="mt-4 rounded-xl border border-teal-100 bg-teal-50/55 p-3"><div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-teal-700"><Sparkles className="h-3.5 w-3.5" />Candidate-stated motivation</div><p className="mt-1.5 line-clamp-2 text-xs leading-5 text-slate-600">{report.statedMotivation}</p></div>
          <div className="mt-4"><div className="mb-1.5 flex items-center justify-between text-[10px] font-semibold"><span className="text-slate-500">Demonstrated evidence</span><span className="text-slate-700">{demonstrated} of {report.evidence.length}</span></div><div className="h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-gradient-to-r from-teal-500 to-emerald-400" style={{ width: `${evidenceRate}%` }} /></div></div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4"><span className="flex flex-wrap gap-3 text-xs text-slate-500"><span className="flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />{report.evidence.length} evidence areas</span><span className="flex items-center gap-1"><MessageSquareText className="h-3.5 w-3.5 text-teal-600" />{report.conversationSignals.length} signals</span><span className="flex items-center gap-1"><CircleAlert className="h-3.5 w-3.5 text-amber-600" />{report.clarifications.length} clarifications</span></span><span className="inline-flex items-center gap-1 text-xs font-semibold text-teal-700">Review report <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" /></span></div>
        </div>
      </Link>;
    })}</div> : <section className="screenit-panel grid min-h-64 place-items-center rounded-2xl p-8 text-center"><div><span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-teal-50 text-teal-700"><FileCheck2 className="h-5 w-5" /></span><h2 className="mt-4 text-base font-bold text-slate-900">No reports yet</h2><p className="mt-1 max-w-sm text-sm leading-6 text-slate-500">Completed browser and phone interviews will appear here with evidence and recruiter clarifications.</p></div></section>}
  </div>;
}

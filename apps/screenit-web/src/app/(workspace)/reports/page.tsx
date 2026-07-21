import Link from "next/link";
import { ArrowRight, CheckCircle2, CircleAlert } from "lucide-react";
import { PageHeading } from "@/components/page-heading";
import { getWorkspaceSnapshot } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  const workspace = await getWorkspaceSnapshot();
  return <div className="screenit-rise space-y-5"><PageHeading eyebrow="Human review" title="Interview reports" description="Compare structured, job-related evidence without a hidden candidate score." />
    <div className="grid gap-4 xl:grid-cols-2">{workspace.reports.map((report) => { const candidate = workspace.candidates.find((item) => item.id === report.candidateId); const position = workspace.positions.find((item) => item.id === candidate?.positionId); return <Link key={report.id} href={`/candidates/${report.candidateId}`} className="group rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-teal-300 hover:shadow-md"><div className="flex items-start justify-between gap-3"><div><p className="text-lg font-bold text-slate-950">{candidate?.name ?? "Candidate"}</p><p className="mt-1 text-xs text-slate-500">{position?.title ?? "Position"} · Generated {new Date(report.generatedAt).toLocaleString()}</p></div><span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-bold capitalize text-emerald-700">{report.roleAlignment.replaceAll("_", " ")}</span></div><p className="mt-4 line-clamp-3 text-sm leading-6 text-slate-600">{report.summary}</p><div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4"><span className="flex gap-3 text-xs text-slate-500"><span className="flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />{report.evidence.length} evidence areas</span><span className="flex items-center gap-1"><CircleAlert className="h-3.5 w-3.5 text-amber-600" />{report.clarifications.length} clarifications</span></span><span className="inline-flex items-center gap-1 text-xs font-semibold text-teal-700">Review <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" /></span></div></Link>; })}</div>
  </div>;
}

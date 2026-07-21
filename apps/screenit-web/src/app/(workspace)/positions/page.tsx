import { CheckCircle2, CircleHelp, ClipboardCheck, MapPin, MessageCircleQuestion, Users } from "lucide-react";
import { PageHeading } from "@/components/page-heading";
import { getWorkspaceSnapshot } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function PositionsPage() {
  const workspace = await getWorkspaceSnapshot();
  const active = workspace.positions.filter((position) => position.status === "active").length;
  const candidates = workspace.positions.reduce((total, position) => total + position.candidateCount, 0);
  const ready = workspace.positions.reduce((total, position) => total + position.reviewCount, 0);

  return (
    <div className="screenit-rise space-y-5">
      <PageHeading eyebrow="Interview design" title="Positions" description="Build a clear evidence rubric once, then give every candidate a consistent and natural interview." />

      <section className="grid gap-3 sm:grid-cols-3">
        {[{ label: "Active roles", value: active, detail: `${workspace.positions.length} total positions`, icon: ClipboardCheck, tone: "bg-teal-50 text-teal-700" }, { label: "Candidates", value: candidates, detail: "Across every position", icon: Users, tone: "bg-blue-50 text-blue-700" }, { label: "Ready to review", value: ready, detail: "Human decision queue", icon: MessageCircleQuestion, tone: "bg-amber-50 text-amber-700" }].map((metric) => { const Icon = metric.icon; return <article key={metric.label} className="screenit-panel screenit-panel-hover flex items-center gap-4 rounded-2xl p-4"><span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${metric.tone}`}><Icon className="h-4.5 w-4.5" /></span><div><p className="text-xl font-bold tracking-[-0.03em] text-slate-950">{metric.value}</p><p className="text-xs font-semibold text-slate-700">{metric.label}</p><p className="mt-0.5 text-[10px] text-slate-400">{metric.detail}</p></div></article>; })}
      </section>

      <div className="grid gap-5 xl:grid-cols-2">
        {workspace.positions.map((position) => (
          <article key={position.id} className="screenit-panel overflow-hidden rounded-[20px]">
            <div className={`h-1 w-full ${position.status === "active" ? "bg-gradient-to-r from-teal-500 via-emerald-400 to-teal-200" : "bg-slate-200"}`} />
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 p-5">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-bold tracking-[-0.02em] text-slate-950">{position.title}</h2>
                  <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold capitalize ${position.status === "active" ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200" : "bg-slate-100 text-slate-600"}`}>{position.status}</span>
                </div>
                <p className="mt-1.5 flex items-center gap-1.5 text-xs text-slate-500"><MapPin className="h-3.5 w-3.5 text-teal-600" />{position.department} · {position.location}</p>
              </div>
              <div className="rounded-xl bg-slate-50 px-3 py-2 text-center"><p className="text-xl font-bold text-slate-950">{position.candidateCount}</p><p className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Candidates</p></div>
            </div>
            <div className="grid gap-5 p-5 md:grid-cols-2">
              <section>
                <div className="flex items-center justify-between"><h3 className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Required evidence</h3><span className="rounded-md bg-teal-50 px-1.5 py-0.5 text-[9px] font-bold text-teal-700">{position.requirements.length}</span></div>
                <div className="mt-3 space-y-2.5">
                  {position.requirements.map((requirement) => <p key={requirement} className="flex gap-2 text-sm leading-5 text-slate-700"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-teal-600" />{requirement}</p>)}
                  {!position.requirements.length && <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4 text-center"><p className="text-sm font-semibold text-slate-600">No rubric yet</p><p className="mt-1 text-xs text-slate-400">Add evidence requirements before activating.</p></div>}
                </div>
              </section>
              <section>
                <div className="flex items-center justify-between"><h3 className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Interview prompts</h3><span className="rounded-md bg-violet-50 px-1.5 py-0.5 text-[9px] font-bold text-violet-700">{position.questions.length}</span></div>
                <div className="mt-3 space-y-2.5">
                  {position.questions.map((question) => <div key={question.id} className="rounded-xl border border-slate-100 bg-slate-50/80 p-3"><p className="flex gap-2 text-sm font-medium leading-5 text-slate-800"><CircleHelp className="mt-0.5 h-4 w-4 shrink-0 text-teal-600" />{question.prompt}</p><p className="mt-1.5 pl-6 text-xs leading-5 text-slate-500">{question.reason}</p></div>)}
                  {!position.questions.length && <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4 text-center"><CircleHelp className="mx-auto h-5 w-5 text-slate-300" /><p className="mt-2 text-sm font-semibold text-slate-600">No prompts drafted</p><p className="mt-1 text-xs text-slate-400">AI will still build résumé-specific questions.</p></div>}
                </div>
              </section>
            </div>
            <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50/55 px-5 py-3 text-xs"><span className="text-slate-500"><strong className="text-slate-800">{position.reviewCount}</strong> reports waiting for review</span><span className="font-semibold text-teal-700">Evidence-led · human decision</span></div>
          </article>
        ))}
      </div>
    </div>
  );
}

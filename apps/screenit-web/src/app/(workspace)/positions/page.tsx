import { CheckCircle2, CircleHelp, MapPin } from "lucide-react";
import { PageHeading } from "@/components/page-heading";
import { getWorkspaceSnapshot } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function PositionsPage() {
  const workspace = await getWorkspaceSnapshot();

  return (
    <div className="screenit-rise space-y-5">
      <PageHeading eyebrow="Interview design" title="Positions" description="Define the job evidence ScreenIT may ask about before inviting candidates." />
      <div className="grid gap-5 xl:grid-cols-2">
        {workspace.positions.map((position) => (
          <article key={position.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 p-5">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-bold text-slate-950">{position.title}</h2>
                  <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${position.status === "active" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>{position.status}</span>
                </div>
                <p className="mt-1.5 flex items-center gap-1.5 text-xs text-slate-500"><MapPin className="h-3.5 w-3.5" />{position.department} · {position.location}</p>
              </div>
              <div className="text-right"><p className="text-2xl font-bold text-slate-950">{position.candidateCount}</p><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Candidates</p></div>
            </div>
            <div className="grid gap-5 p-5 md:grid-cols-2">
              <section>
                <h3 className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">Required evidence</h3>
                <div className="mt-3 space-y-2.5">
                  {position.requirements.map((requirement) => <p key={requirement} className="flex gap-2 text-sm leading-5 text-slate-700"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-teal-600" />{requirement}</p>)}
                  {!position.requirements.length && <p className="text-sm text-slate-400">Add requirements before activating this role.</p>}
                </div>
              </section>
              <section>
                <h3 className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">Interview questions</h3>
                <div className="mt-3 space-y-2.5">
                  {position.questions.map((question) => <div key={question.id} className="rounded-xl bg-slate-50 p-3"><p className="flex gap-2 text-sm font-medium leading-5 text-slate-800"><CircleHelp className="mt-0.5 h-4 w-4 shrink-0 text-teal-600" />{question.prompt}</p><p className="mt-1 pl-6 text-xs text-slate-500">{question.reason}</p></div>)}
                  {!position.questions.length && <p className="text-sm text-slate-400">No questions drafted yet.</p>}
                </div>
              </section>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

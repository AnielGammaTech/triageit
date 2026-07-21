"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  ArrowRight,
  BriefcaseBusiness,
  CalendarClock,
  CheckCircle2,
  FileCheck2,
  Headphones,
  MapPin,
  Phone,
  Plus,
  ScanLine,
  ShieldCheck,
  Sparkles,
  Upload,
  UserRoundSearch,
  Users,
  Video,
  X,
} from "lucide-react";
import type { Position, WorkspaceSnapshot } from "@/lib/screenit-types";

const stageStyles = {
  new: "bg-slate-100 text-slate-600",
  invited: "bg-blue-50 text-blue-700",
  interviewing: "bg-violet-50 text-violet-700",
  review: "bg-amber-50 text-amber-700",
  advanced: "bg-emerald-50 text-emerald-700",
  closed: "bg-slate-100 text-slate-500",
} as const;

function friendlyDate(value: string | null): string {
  if (!value) return "Not scheduled";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function NewPositionDialog({ onClose, onCreate }: { readonly onClose: () => void; readonly onCreate: (position: Position) => void }) {
  const [title, setTitle] = useState("");
  const [department, setDepartment] = useState("Technical Operations");
  const [location, setLocation] = useState("Naples, FL");

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/45 p-4 backdrop-blur-[2px]" role="presentation" onMouseDown={onClose}>
      <form
        className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          const createdAt = new Date().toISOString();
          onCreate({
            id: `local-${Date.now()}`,
            title: title.trim(),
            department,
            location,
            status: "draft",
            candidateCount: 0,
            reviewCount: 0,
            requirements: [],
            questions: [],
            createdAt,
          });
        }}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-teal-700">New position</p>
            <h2 className="mt-1 text-xl font-bold tracking-[-0.02em] text-slate-950">Start an interview workspace</h2>
            <p className="mt-1 text-sm text-slate-500">Add the role first. Requirements and questions come next.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Close dialog"><X className="h-4 w-4" /></button>
        </div>
        <div className="mt-6 grid gap-4">
          <label className="grid gap-1.5 text-xs font-semibold text-slate-700">
            Position title
            <input required value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Service Desk Technician" className="h-11 rounded-xl border border-slate-200 px-3.5 text-sm outline-none transition focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10" />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-1.5 text-xs font-semibold text-slate-700">
              Department
              <input value={department} onChange={(event) => setDepartment(event.target.value)} className="h-11 rounded-xl border border-slate-200 px-3.5 text-sm outline-none transition focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10" />
            </label>
            <label className="grid gap-1.5 text-xs font-semibold text-slate-700">
              Location
              <input value={location} onChange={(event) => setLocation(event.target.value)} className="h-11 rounded-xl border border-slate-200 px-3.5 text-sm outline-none transition focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10" />
            </label>
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="h-10 rounded-xl border border-slate-200 px-4 text-sm font-semibold text-slate-600 hover:bg-slate-50">Cancel</button>
          <button type="submit" className="h-10 rounded-xl bg-teal-700 px-4 text-sm font-semibold text-white shadow-sm hover:bg-teal-800">Create position</button>
        </div>
      </form>
    </div>
  );
}

export function WorkspaceDashboard({ initial }: { readonly initial: WorkspaceSnapshot }) {
  const [positions, setPositions] = useState<readonly Position[]>(initial.positions);
  const [showPositionDialog, setShowPositionDialog] = useState(false);
  const activePositions = positions.filter((position) => position.status === "active").length;
  const reviewCandidates = initial.candidates.filter((candidate) => candidate.stage === "review");
  const upcoming = initial.candidates.filter((candidate) => candidate.scheduledAt && !candidate.completedAt);
  const metrics = useMemo(() => [
    { label: "Open positions", value: activePositions, detail: `${positions.length - activePositions} draft or paused`, icon: BriefcaseBusiness, tone: "teal" },
    { label: "Active candidates", value: initial.candidates.length, detail: `${initial.candidates.filter((candidate) => candidate.stage === "new").length} need an invitation`, icon: Users, tone: "blue" },
    { label: "Recruiter review", value: reviewCandidates.length, detail: "Evidence reports ready", icon: FileCheck2, tone: "amber" },
    { label: "Upcoming interviews", value: upcoming.length, detail: "Browser and phone", icon: CalendarClock, tone: "violet" },
  ], [activePositions, initial.candidates, positions.length, reviewCandidates.length, upcoming.length]);

  return (
    <div className="screenit-rise space-y-6">
      {initial.source === "demo" && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-teal-950">
          <span className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-teal-700" /><strong>Demo workspace</strong><span className="text-teal-800/75">ScreenIT is ready to explore while its dedicated database is attached.</span></span>
          <span className="rounded-full bg-white px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-teal-700 shadow-sm">No TriageIT data used</span>
        </div>
      )}

      <section className="screenit-dot-grid relative isolate overflow-hidden rounded-[24px] border border-emerald-950/20 bg-[linear-gradient(118deg,#112720_0%,#174b40_68%,#0f766e_140%)] p-5 text-white shadow-[0_26px_62px_-42px_rgba(6,59,50,.95)] lg:p-7">
        <span className="screenit-hero-orb pointer-events-none absolute -right-10 -top-20 h-56 w-56 rounded-full border border-teal-100/15 bg-teal-300/10" />
        <div className="relative z-10 flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="max-w-2xl">
            <div className="flex items-center gap-2"><span className="grid h-8 w-8 place-items-center rounded-xl border border-teal-200/15 bg-teal-300/10 text-teal-200"><ScanLine className="h-4 w-4" /></span><p className="text-[10px] font-bold uppercase tracking-[0.22em] text-teal-200">Interview operations</p></div>
            <h1 className="mt-4 text-2xl font-bold tracking-[-0.04em] text-white lg:text-[32px]">The next hiring decision,<br className="hidden sm:block" /> backed by better evidence.</h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-slate-300">Start with the review queue, prepare upcoming interviews, and keep every candidate conversation consistent without losing the human judgment.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/candidates" className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/15 bg-white/[0.07] px-4 text-sm font-semibold text-white shadow-sm backdrop-blur transition hover:bg-white/[0.13]"><Upload className="h-4 w-4 text-teal-200" />Add candidate</Link>
            <button onClick={() => setShowPositionDialog(true)} className="inline-flex h-10 items-center gap-2 rounded-xl bg-teal-300 px-4 text-sm font-bold text-emerald-950 shadow-lg shadow-emerald-950/20 transition hover:bg-teal-200"><Plus className="h-4 w-4" />New position</button>
          </div>
        </div>
        <div className="relative z-10 mt-6 grid gap-2 border-t border-white/10 pt-4 sm:grid-cols-3">
          {[{ icon: Upload, label: "Resume intake", detail: "Role-specific evidence" }, { icon: Headphones, label: "Natural screening", detail: "Candidate-led conversation" }, { icon: ShieldCheck, label: "Recruiter report", detail: "Human decision required" }].map((step, index) => { const Icon = step.icon; return <div key={step.label} className="flex items-center gap-3 rounded-xl border border-white/[0.07] bg-white/[0.045] px-3 py-2.5"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-teal-300/10 text-teal-200"><Icon className="h-3.5 w-3.5" /></span><span><span className="block text-xs font-semibold text-white"><span className="mr-1.5 text-teal-300">0{index + 1}</span>{step.label}</span><span className="mt-0.5 block text-[10px] text-slate-400">{step.detail}</span></span></div>; })}
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric) => {
          const Icon = metric.icon;
          const tone = metric.tone === "teal" ? "bg-teal-50 text-teal-700" : metric.tone === "blue" ? "bg-blue-50 text-blue-700" : metric.tone === "amber" ? "bg-amber-50 text-amber-700" : "bg-violet-50 text-violet-700";
          return (
            <article key={metric.label} className="screenit-panel screenit-panel-hover relative overflow-hidden rounded-2xl p-4">
              <span className={`absolute inset-y-0 left-0 w-0.5 ${metric.tone === "teal" ? "bg-teal-500" : metric.tone === "blue" ? "bg-blue-500" : metric.tone === "amber" ? "bg-amber-500" : "bg-violet-500"}`} />
              <div className="flex items-start justify-between"><span className={`grid h-9 w-9 place-items-center rounded-xl ${tone}`}><Icon className="h-4.5 w-4.5" /></span><span className="text-2xl font-bold tracking-[-0.03em] text-slate-950">{metric.value}</span></div>
              <p className="mt-4 text-sm font-semibold text-slate-800">{metric.label}</p>
              <p className="mt-0.5 text-xs text-slate-500">{metric.detail}</p>
            </article>
          );
        })}
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(330px,.75fr)]">
        <div className="screenit-panel overflow-hidden rounded-2xl">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <div><h2 className="text-sm font-bold text-slate-900">Recruiter review queue</h2><p className="mt-0.5 text-xs text-slate-500">Reports with evidence ready for a human decision.</p></div>
            <Link href="/reports" className="text-xs font-semibold text-teal-700 hover:text-teal-900">View all</Link>
          </div>
          {reviewCandidates.length ? (
            <div className="divide-y divide-slate-100">
              {reviewCandidates.map((candidate) => {
                const position = positions.find((item) => item.id === candidate.positionId);
                return (
                  <Link key={candidate.id} href={`/candidates/${candidate.id}`} className="group grid gap-3 px-5 py-4 transition hover:bg-teal-50/45 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-emerald-950 to-teal-700 text-xs font-bold text-white shadow-sm">{candidate.name.split(" ").map((part) => part[0]).join("")}</span>
                      <span className="min-w-0"><span className="block truncate text-sm font-semibold text-slate-900">{candidate.name}</span><span className="block truncate text-xs text-slate-500">{position?.title ?? "Position"}</span></span>
                    </div>
                    <span className="text-xs text-slate-500">Completed {friendlyDate(candidate.completedAt)}</span>
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-teal-700">Review report <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" /></span>
                  </Link>
                );
              })}
            </div>
          ) : (
            <div className="grid min-h-48 place-items-center p-8 text-center"><div><CheckCircle2 className="mx-auto h-8 w-8 text-emerald-500" /><p className="mt-3 text-sm font-semibold text-slate-800">Review queue is clear</p><p className="mt-1 text-xs text-slate-500">Completed interviews will appear here.</p></div></div>
          )}
        </div>

        <aside className="screenit-panel rounded-2xl">
          <div className="border-b border-slate-100 px-5 py-4"><h2 className="text-sm font-bold text-slate-900">Upcoming interviews</h2><p className="mt-0.5 text-xs text-slate-500">The next scheduled candidate contacts.</p></div>
          <div className="space-y-3 p-4">
            {upcoming.map((candidate) => (
              <Link key={candidate.id} href={`/candidates/${candidate.id}`} className="block rounded-xl border border-slate-200 p-3.5 transition hover:border-teal-300 hover:bg-teal-50/40">
                <div className="flex items-center justify-between gap-2"><span className="text-sm font-semibold text-slate-900">{candidate.name}</span><span className={`rounded-full px-2 py-1 text-[10px] font-bold ${stageStyles[candidate.stage]}`}>{candidate.stage}</span></div>
                <div className="mt-2 flex items-center justify-between text-xs text-slate-500"><span>{friendlyDate(candidate.scheduledAt)}</span><span className="flex items-center gap-1">{candidate.interviewMode === "phone" ? <Phone className="h-3.5 w-3.5" /> : <Video className="h-3.5 w-3.5" />}{candidate.interviewMode}</span></div>
              </Link>
            ))}
            {!upcoming.length && <p className="py-8 text-center text-xs text-slate-500">No interviews scheduled.</p>}
          </div>
        </aside>
      </section>

      <section className="screenit-panel rounded-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4"><div><h2 className="text-sm font-bold text-slate-900">Positions</h2><p className="mt-0.5 text-xs text-slate-500">Role rubrics and candidate coverage.</p></div><Link href="/positions" className="text-xs font-semibold text-teal-700">Manage positions</Link></div>
        <div className="grid gap-3 p-4 lg:grid-cols-2">
          {positions.map((position) => (
            <Link key={position.id} href="/positions" className="screenit-panel-hover rounded-xl border border-slate-200 bg-white/70 p-4">
              <div className="flex items-start justify-between gap-3"><div><p className="text-sm font-bold text-slate-900">{position.title}</p><p className="mt-1 flex items-center gap-1 text-xs text-slate-500"><MapPin className="h-3.5 w-3.5" />{position.location}</p></div><span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${position.status === "active" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>{position.status}</span></div>
              <div className="mt-4 flex items-center gap-5 text-xs text-slate-500"><span><strong className="text-slate-800">{position.candidateCount}</strong> candidates</span><span><strong className="text-slate-800">{position.reviewCount}</strong> ready to review</span><span><strong className="text-slate-800">{position.requirements.length}</strong> requirements</span></div>
            </Link>
          ))}
        </div>
      </section>

      <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs text-slate-500"><UserRoundSearch className="h-4 w-4 text-teal-700" /><strong className="text-slate-700">Human review required.</strong> ScreenIT records job-related evidence and clarification needs; it does not make hiring decisions.</div>

      {showPositionDialog && <NewPositionDialog onClose={() => setShowPositionDialog(false)} onCreate={(position) => { setPositions((current) => [position, ...current]); setShowPositionDialog(false); }} />}
    </div>
  );
}

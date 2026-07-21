"use client";

import Link from "next/link";
import { useState } from "react";
import { CalendarClock, CheckCircle2, ChevronDown, FileText, Mail, Phone, Send, ShieldCheck, Video } from "lucide-react";
import type { Candidate, CandidateReport, Position } from "@/lib/screenit-types";

const evidenceStyle = {
  demonstrated: "bg-emerald-50 text-emerald-700 border-emerald-200",
  partial: "bg-amber-50 text-amber-700 border-amber-200",
  unclear: "bg-slate-50 text-slate-600 border-slate-200",
  not_demonstrated: "bg-rose-50 text-rose-700 border-rose-200",
};

export function CandidateDetail({ candidate, position, report }: { readonly candidate: Candidate; readonly position: Position | null; readonly report: CandidateReport | null }) {
  const [showResume, setShowResume] = useState(false);
  const [copied, setCopied] = useState(false);
  const inviteUrl = typeof window === "undefined" ? `/interview/${candidate.inviteToken}` : `${window.location.origin}/interview/${candidate.inviteToken}`;

  async function copyInvite() {
    await navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="screenit-rise space-y-5">
      <Link href="/candidates" className="text-sm font-medium text-slate-500 hover:text-teal-700">← Back to candidates</Link>
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-5 bg-[#172521] p-5 text-white lg:flex-row lg:items-center lg:justify-between lg:p-6">
          <div className="flex min-w-0 items-center gap-4"><span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-teal-400/15 text-lg font-bold text-teal-200">{candidate.name.split(" ").map((part) => part[0]).join("")}</span><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h1 className="truncate text-2xl font-bold">{candidate.name}</h1><span className="rounded-full bg-white/10 px-2.5 py-1 text-[10px] font-bold capitalize text-teal-200">{candidate.stage}</span></div><p className="mt-1 text-sm text-slate-300">{position?.title ?? "Unassigned position"}</p><div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400"><span className="flex items-center gap-1"><Mail className="h-3.5 w-3.5" />{candidate.email}</span>{candidate.phone && <span className="flex items-center gap-1"><Phone className="h-3.5 w-3.5" />{candidate.phone}</span>}</div></div></div>
          <div className="flex flex-wrap gap-2"><button onClick={copyInvite} className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/15 bg-white/[0.06] px-4 text-sm font-semibold hover:bg-white/10"><Send className="h-4 w-4" />{copied ? "Copied" : "Copy invite"}</button><Link href={`/interview/${candidate.inviteToken}`} className="inline-flex h-10 items-center gap-2 rounded-xl bg-teal-500 px-4 text-sm font-semibold text-slate-950 hover:bg-teal-400"><Video className="h-4 w-4" />Open interview</Link></div>
        </div>
        <div className="grid divide-y divide-slate-100 sm:grid-cols-3 sm:divide-x sm:divide-y-0"><div className="p-4"><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Interview mode</p><p className="mt-1 text-sm font-semibold capitalize text-slate-800">{candidate.interviewMode ?? "Not selected"}</p></div><div className="p-4"><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Scheduled</p><p className="mt-1 text-sm font-semibold text-slate-800">{candidate.scheduledAt ? new Date(candidate.scheduledAt).toLocaleString() : "Not scheduled"}</p></div><div className="p-4"><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Resume</p><p className="mt-1 truncate text-sm font-semibold text-slate-800">{candidate.resumeFileName}</p></div></div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(330px,.75fr)]">
        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 p-5"><div><h2 className="text-sm font-bold text-slate-900">Evidence report</h2><p className="mt-0.5 text-xs text-slate-500">Job-related evidence only. Recruiter decision required.</p></div>{report && <span className="flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-bold text-emerald-700"><ShieldCheck className="h-3.5 w-3.5" />Ready</span>}</div>
          {report ? <div className="p-5"><p className="text-sm leading-6 text-slate-700">{report.summary}</p><div className="mt-5 space-y-3">{report.evidence.map((item) => <article key={item.requirement} className="rounded-xl border border-slate-200 p-4"><div className="flex flex-wrap items-start justify-between gap-2"><h3 className="text-sm font-semibold text-slate-900">{item.requirement}</h3><span className={`rounded-full border px-2 py-1 text-[10px] font-bold capitalize ${evidenceStyle[item.level]}`}>{item.level.replace("_", " ")}</span></div><p className="mt-2 text-sm leading-5 text-slate-600">{item.evidence}</p></article>)}</div></div> : <div className="grid min-h-64 place-items-center p-8 text-center"><div><CalendarClock className="mx-auto h-8 w-8 text-slate-300" /><p className="mt-3 text-sm font-semibold text-slate-800">Interview not complete</p><p className="mt-1 text-xs text-slate-500">The evidence report appears after the structured interview.</p></div></div>}
        </section>
        <aside className="space-y-5">
          <section className="rounded-2xl border border-slate-200 bg-white shadow-sm"><button onClick={() => setShowResume((current) => !current)} className="flex w-full items-center justify-between p-5 text-left"><span><span className="block text-sm font-bold text-slate-900">Resume evidence</span><span className="mt-0.5 block text-xs text-slate-500">{candidate.resumeFileName}</span></span><ChevronDown className={`h-4 w-4 text-slate-400 transition ${showResume ? "rotate-180" : ""}`} /></button>{showResume && <div className="border-t border-slate-100 p-5"><div className="space-y-3">{candidate.resumeHighlights.map((highlight) => <p key={highlight} className="flex gap-2 text-sm leading-5 text-slate-700"><FileText className="mt-0.5 h-4 w-4 shrink-0 text-teal-600" />{highlight}</p>)}</div></div>}</section>
          {report && <section className="rounded-2xl border border-amber-200 bg-amber-50/60 p-5"><h2 className="text-sm font-bold text-amber-950">Recruiter clarifications</h2><div className="mt-3 space-y-2.5">{report.clarifications.map((item) => <p key={item} className="flex gap-2 text-sm leading-5 text-amber-900"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />{item}</p>)}</div></section>}
        </aside>
      </div>
    </div>
  );
}

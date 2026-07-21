"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { ArrowRight, FileUp, Mail, Plus, Search, X } from "lucide-react";
import type { Candidate, Position } from "@/lib/screenit-types";

const stageClass: Record<Candidate["stage"], string> = {
  new: "bg-slate-100 text-slate-600", invited: "bg-blue-50 text-blue-700", interviewing: "bg-violet-50 text-violet-700",
  review: "bg-amber-50 text-amber-700", advanced: "bg-emerald-50 text-emerald-700", closed: "bg-slate-100 text-slate-500",
};

export function CandidatesWorkspace({ initialCandidates, positions }: { readonly initialCandidates: readonly Candidate[]; readonly positions: readonly Position[] }) {
  const [candidates, setCandidates] = useState(initialCandidates);
  const [query, setQuery] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const visible = useMemo(() => candidates.filter((candidate) => `${candidate.name} ${candidate.email}`.toLowerCase().includes(query.toLowerCase())), [candidates, query]);

  async function submitCandidate(formData: FormData) {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/candidates", { method: "POST", body: formData });
      const payload = await response.json() as { candidate?: Candidate; error?: string };
      if (!response.ok || !payload.candidate) throw new Error(payload.error ?? "Candidate could not be added");
      const candidate = payload.candidate;
      setCandidates((current) => [candidate, ...current]);
      formRef.current?.reset();
      setShowAdd(false);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Candidate could not be added");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-xl border border-slate-200 px-3 text-slate-400 sm:max-w-md"><Search className="h-4 w-4" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search candidates…" className="min-w-0 flex-1 bg-transparent text-sm text-slate-800 outline-none" /></label>
        <button onClick={() => setShowAdd(true)} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-teal-700 px-4 text-sm font-semibold text-white shadow-sm hover:bg-teal-800"><Plus className="h-4 w-4" />Add candidate</button>
      </div>
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="hidden grid-cols-[minmax(240px,1.4fr)_minmax(180px,1fr)_130px_150px_100px] gap-4 border-b border-slate-100 bg-slate-50/80 px-5 py-3 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500 lg:grid"><span>Candidate</span><span>Position</span><span>Stage</span><span>Interview</span><span /></div>
        <div className="divide-y divide-slate-100">
          {visible.map((candidate) => {
            const position = positions.find((item) => item.id === candidate.positionId);
            return <Link key={candidate.id} href={`/candidates/${candidate.id}`} className="group grid gap-3 px-5 py-4 hover:bg-slate-50 lg:grid-cols-[minmax(240px,1.4fr)_minmax(180px,1fr)_130px_150px_100px] lg:items-center">
              <span className="flex min-w-0 items-center gap-3"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-slate-900 text-xs font-bold text-white">{candidate.name.split(" ").map((part) => part[0]).join("")}</span><span className="min-w-0"><strong className="block truncate text-sm text-slate-900">{candidate.name}</strong><span className="flex items-center gap-1 truncate text-xs text-slate-500"><Mail className="h-3 w-3" />{candidate.email}</span></span></span>
              <span className="text-sm text-slate-600">{position?.title ?? "Unassigned"}</span>
              <span><span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${stageClass[candidate.stage]}`}>{candidate.stage}</span></span>
              <span className="text-xs text-slate-500">{candidate.scheduledAt ? new Date(candidate.scheduledAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "Not scheduled"}</span>
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-teal-700">Open <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" /></span>
            </Link>;
          })}
          {!visible.length && <div className="p-12 text-center text-sm text-slate-500">No candidates match this search.</div>}
        </div>
      </div>
      {showAdd && <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/45 p-4 backdrop-blur-[2px]" onMouseDown={() => setShowAdd(false)}>
        <form ref={formRef} action={submitCandidate} onMouseDown={(event) => event.stopPropagation()} className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
          <div className="flex items-start justify-between gap-4"><div><p className="text-[11px] font-bold uppercase tracking-[0.16em] text-teal-700">Candidate intake</p><h2 className="mt-1 text-xl font-bold text-slate-950">Add a resume</h2><p className="mt-1 text-sm text-slate-500">ScreenIT extracts job-related experience for recruiter review.</p></div><button type="button" onClick={() => setShowAdd(false)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100"><X className="h-4 w-4" /></button></div>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <label className="grid gap-1.5 text-xs font-semibold text-slate-700">Full name<input name="name" required className="h-11 rounded-xl border border-slate-200 px-3.5 text-sm outline-none focus:border-teal-500" /></label>
            <label className="grid gap-1.5 text-xs font-semibold text-slate-700">Email<input name="email" required type="email" className="h-11 rounded-xl border border-slate-200 px-3.5 text-sm outline-none focus:border-teal-500" /></label>
            <label className="grid gap-1.5 text-xs font-semibold text-slate-700 sm:col-span-2">Position<select name="positionId" required className="h-11 rounded-xl border border-slate-200 bg-white px-3.5 text-sm outline-none focus:border-teal-500">{positions.map((position) => <option value={position.id} key={position.id}>{position.title}</option>)}</select></label>
            <label className="grid gap-1.5 text-xs font-semibold text-slate-700 sm:col-span-2"><span>Resume</span><span className="flex min-h-24 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-center text-slate-500 hover:border-teal-400"><FileUp className="mb-2 h-5 w-5 text-teal-600" /><span className="text-sm font-semibold text-slate-700">Choose PDF or DOCX</span><input name="resume" required type="file" accept=".pdf,.doc,.docx" className="mt-2 text-xs" /></span></label>
          </div>
          {error && <p className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
          <div className="mt-6 flex justify-end gap-2"><button type="button" onClick={() => setShowAdd(false)} className="h-10 rounded-xl border border-slate-200 px-4 text-sm font-semibold text-slate-600">Cancel</button><button disabled={saving} className="h-10 rounded-xl bg-teal-700 px-4 text-sm font-semibold text-white disabled:opacity-50">{saving ? "Adding…" : "Add candidate"}</button></div>
        </form>
      </div>}
    </>
  );
}

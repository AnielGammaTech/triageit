"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { CalendarClock, CheckCircle2, ChevronDown, CircleAlert, CircleHelp, FileText, LoaderCircle, Mail, Phone, PhoneCall, RefreshCw, Send, ShieldCheck, Video } from "lucide-react";
import type { Candidate, CandidateReport, InterviewQuestion, Position } from "@/lib/screenit-types";

interface ScreeningPlanPayload {
  readonly highlights: readonly string[];
  readonly clarifications: readonly string[];
  readonly questions: readonly InterviewQuestion[];
}

const evidenceStyle = {
  demonstrated: "bg-emerald-50 text-emerald-700 border-emerald-200",
  partial: "bg-amber-50 text-amber-700 border-amber-200",
  unclear: "bg-slate-50 text-slate-600 border-slate-200",
  not_demonstrated: "bg-rose-50 text-rose-700 border-rose-200",
};

const alignmentStyle = {
  strong_alignment: "border-emerald-200 bg-emerald-50 text-emerald-700",
  partial_alignment: "border-blue-200 bg-blue-50 text-blue-700",
  limited_alignment: "border-amber-200 bg-amber-50 text-amber-700",
  insufficient_evidence: "border-slate-200 bg-slate-50 text-slate-600",
};

const answerQualityStyle: Record<CandidateReport["answerQuality"], string> = {
  strong: "border-emerald-200 bg-emerald-50 text-emerald-800",
  mixed: "border-blue-200 bg-blue-50 text-blue-800",
  weak: "border-rose-200 bg-rose-50 text-rose-800",
  insufficient: "border-amber-200 bg-amber-50 text-amber-800",
  not_assessed: "border-slate-200 bg-slate-50 text-slate-700",
};

export function CandidateDetail({ candidate, position, report }: { readonly candidate: Candidate; readonly position: Position | null; readonly report: CandidateReport | null }) {
  const [showResume, setShowResume] = useState(false);
  const [copied, setCopied] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [phone, setPhone] = useState(candidate.phone ?? "");
  const [placingCall, setPlacingCall] = useState(false);
  const [callState, setCallState] = useState<{ status: string; error?: string | null } | null>(null);
  const [callError, setCallError] = useState<string | null>(null);
  const [resumeHighlights, setResumeHighlights] = useState(candidate.resumeHighlights);
  const [resumeClarifications, setResumeClarifications] = useState(candidate.resumeClarifications);
  const [screeningQuestions, setScreeningQuestions] = useState(candidate.screeningQuestions);
  const [checkingPlan, setCheckingPlan] = useState(candidate.screeningQuestions.length === 0 && !report);
  const router = useRouter();
  const inviteUrl = typeof window === "undefined" ? `/interview/${candidate.inviteToken}` : `${window.location.origin}/interview/${candidate.inviteToken}`;

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    const load = async () => {
      try {
        const response = await fetch(`/api/candidates/${candidate.id}/call`, { cache: "no-store" });
        const payload = await response.json() as { call?: { status: string; error?: string | null } | null };
        if (!cancelled && payload.call) {
          setCallState(payload.call);
          if (["pending", "calling", "connected"].includes(payload.call.status)) timer = window.setTimeout(load, 3000);
          if (payload.call.status === "completed") router.refresh();
        }
      } catch {
        // The primary call action surfaces failures. Polling stays quiet.
      }
    };
    void load();
    return () => { cancelled = true; if (timer) window.clearTimeout(timer); };
  }, [candidate.id, router]);

  useEffect(() => {
    if (screeningQuestions.length > 0 || report) return;

    let cancelled = false;
    let attempts = 0;
    let timer: number | undefined;
    const checkPlan = async () => {
      attempts += 1;
      try {
        const response = await fetch(`/api/candidates/${candidate.id}/analyze`, { cache: "no-store" });
        const payload = await response.json() as { ready?: boolean; analysis?: ScreeningPlanPayload };
        if (!cancelled && response.ok && payload.analysis) {
          setResumeHighlights(payload.analysis.highlights);
          setResumeClarifications(payload.analysis.clarifications);
          setScreeningQuestions(payload.analysis.questions);
          if (payload.ready) {
            setCheckingPlan(false);
            return;
          }
        }
      } catch {
        // The manual generation action remains available if background analysis fails.
      }

      if (!cancelled && attempts < 30) timer = window.setTimeout(checkPlan, 2000);
      else if (!cancelled) setCheckingPlan(false);
    };

    timer = window.setTimeout(checkPlan, 500);
    return () => { cancelled = true; if (timer) window.clearTimeout(timer); };
  }, [candidate.id, report, screeningQuestions.length]);

  async function copyInvite() {
    await navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  async function generateScreeningPlan() {
    if (analyzing) return;
    setAnalyzing(true);
    setAnalysisError(null);
    try {
      const response = await fetch(`/api/candidates/${candidate.id}/analyze`, { method: "POST" });
      const payload = await response.json() as { analysis?: ScreeningPlanPayload; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Screening plan could not be generated");
      if (payload.analysis) {
        setResumeHighlights(payload.analysis.highlights);
        setResumeClarifications(payload.analysis.clarifications);
        setScreeningQuestions(payload.analysis.questions);
        setCheckingPlan(false);
      }
      router.refresh();
    } catch (error) {
      setAnalysisError(error instanceof Error ? error.message : "Screening plan could not be generated");
    } finally {
      setAnalyzing(false);
    }
  }

  async function callCandidate() {
    if (placingCall) return;
    setPlacingCall(true);
    setCallError(null);
    try {
      const response = await fetch(`/api/candidates/${candidate.id}/call`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone }) });
      const payload = await response.json() as { call?: { status: string; error?: string | null }; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "The screening call could not be started");
      setCallState(payload.call ?? { status: "calling" });
      window.setTimeout(() => router.refresh(), 1500);
    } catch (error) {
      setCallError(error instanceof Error ? error.message : "The screening call could not be started");
    } finally {
      setPlacingCall(false);
    }
  }

  return (
    <div className="screenit-rise space-y-5">
      <Link href="/candidates" className="text-sm font-medium text-slate-500 hover:text-teal-700">← Back to candidates</Link>
      <section className="screenit-panel overflow-hidden rounded-[22px]">
        <div className="screenit-dot-grid relative flex flex-col gap-5 overflow-hidden bg-[linear-gradient(115deg,#112820,#17473d)] p-5 text-white lg:flex-row lg:items-center lg:justify-between lg:p-6">
          <div className="flex min-w-0 items-center gap-4"><span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-teal-400/15 text-lg font-bold text-teal-200">{candidate.name.split(" ").map((part) => part[0]).join("")}</span><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h1 className="truncate text-2xl font-bold">{candidate.name}</h1><span className="rounded-full bg-white/10 px-2.5 py-1 text-[10px] font-bold capitalize text-teal-200">{candidate.stage}</span></div><p className="mt-1 text-sm text-slate-300">{position?.title ?? "Unassigned position"}</p><div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400"><span className="flex items-center gap-1"><Mail className="h-3.5 w-3.5" />{candidate.email}</span>{candidate.phone && <span className="flex items-center gap-1"><Phone className="h-3.5 w-3.5" />{candidate.phone}</span>}</div></div></div>
          <div className="flex flex-wrap gap-2"><button onClick={copyInvite} className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/15 bg-white/[0.06] px-4 text-sm font-semibold hover:bg-white/10"><Send className="h-4 w-4" />{copied ? "Copied" : "Copy invite"}</button><Link href={`/interview/${candidate.inviteToken}`} className="inline-flex h-10 items-center gap-2 rounded-xl bg-teal-500 px-4 text-sm font-semibold text-slate-950 hover:bg-teal-400"><Video className="h-4 w-4" />Open interview</Link></div>
        </div>
        <div className="grid divide-y divide-slate-100 sm:grid-cols-3 sm:divide-x sm:divide-y-0"><div className="p-4"><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Interview mode</p><p className="mt-1 text-sm font-semibold capitalize text-slate-800">{candidate.interviewMode ?? "Not selected"}</p></div><div className="p-4"><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Scheduled</p><p className="mt-1 text-sm font-semibold text-slate-800">{candidate.scheduledAt ? new Date(candidate.scheduledAt).toLocaleString() : "Not scheduled"}</p></div><div className="p-4"><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Resume</p><p className="mt-1 truncate text-sm font-semibold text-slate-800">{candidate.resumeFileName}</p></div></div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(330px,.75fr)]">
        <section className="screenit-panel rounded-2xl">
          <div className="flex items-center justify-between border-b border-slate-100 p-5"><div><h2 className="text-sm font-bold text-slate-900">Evidence report</h2><p className="mt-0.5 text-xs text-slate-500">Job-related evidence only. Recruiter decision required.</p></div>{report && <span className="flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-bold text-emerald-700"><ShieldCheck className="h-3.5 w-3.5" />Ready</span>}</div>
          {report && <div className={`mx-5 mt-5 rounded-xl border p-4 ${answerQualityStyle[report.answerQuality]}`}>
            <div className="flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-2"><CircleAlert className="h-4 w-4" /><p className="text-xs font-bold uppercase tracking-wider">Answer quality</p></div><span className="rounded-full bg-white/70 px-2.5 py-1 text-[10px] font-bold capitalize">{report.answerQuality.replaceAll("_", " ")}</span></div>
            <p className="mt-2 text-sm leading-5">{report.answerQualityRationale}</p>
            {report.answerConcerns.length > 0 && <div className="mt-3 space-y-2 border-t border-current/15 pt-3">{report.answerConcerns.map((concern) => <p key={concern} className="flex gap-2 text-xs leading-5"><CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />{concern}</p>)}</div>}
            <p className="mt-3 text-[10px] font-semibold uppercase tracking-wide opacity-70">Based on response relevance, specificity, consistency, and concrete examples—not voice, accent, or personality.</p>
          </div>}
          {report ? <div className="p-5"><div className={`mb-5 rounded-xl border p-4 ${alignmentStyle[report.roleAlignment]}`}><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs font-bold uppercase tracking-wider">Role alignment</p><span className="rounded-full bg-white/70 px-2.5 py-1 text-[10px] font-bold capitalize">{report.roleAlignment.replaceAll("_", " ")}</span></div><p className="mt-2 text-sm leading-5">{report.fitRationale}</p><p className="mt-2 text-[10px] font-semibold uppercase tracking-wide opacity-70">Evidence aid only · Human decision required</p></div><p className="text-sm leading-6 text-slate-700">{report.summary}</p><div className="mt-4 rounded-xl border border-teal-100 bg-teal-50/50 p-4"><p className="text-[10px] font-bold uppercase tracking-wider text-teal-700">Candidate-stated motivation</p><p className="mt-2 text-sm leading-5 text-slate-700">{report.statedMotivation}</p><p className="mt-2 text-[10px] text-slate-500">Based on the candidate&apos;s words, not voice or tone.</p></div>{report.conversationSignals.length > 0 && <div className="mt-4"><p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Working style signals</p><div className="mt-2 grid gap-2 sm:grid-cols-2">{report.conversationSignals.map((item) => <article key={`${item.signal}-${item.evidence}`} className="rounded-xl border border-slate-200 bg-slate-50 p-3"><p className="text-xs font-bold text-slate-800">{item.signal}</p><p className="mt-1 text-xs leading-5 text-slate-600">{item.evidence}</p></article>)}</div><p className="mt-2 text-[10px] text-slate-500">Observable job-related evidence only; not a personality score.</p></div>}<div className="mt-5 space-y-3">{report.evidence.map((item) => <article key={item.requirement} className="rounded-xl border border-slate-200 p-4"><div className="flex flex-wrap items-start justify-between gap-2"><h3 className="text-sm font-semibold text-slate-900">{item.requirement}</h3><span className={`rounded-full border px-2 py-1 text-[10px] font-bold capitalize ${evidenceStyle[item.level]}`}>{item.level.replace("_", " ")}</span></div><p className="mt-2 text-sm leading-5 text-slate-600">{item.evidence}</p></article>)}</div></div> : <div className="grid min-h-64 place-items-center p-8 text-center"><div><CalendarClock className="mx-auto h-8 w-8 text-slate-300" /><p className="mt-3 text-sm font-semibold text-slate-800">Interview not complete</p><p className="mt-1 text-xs text-slate-500">The evidence report appears after the structured interview.</p></div></div>}
        </section>
        <aside className="space-y-5">
          {report ? <section className="screenit-panel rounded-2xl border-emerald-200 bg-emerald-50/50 p-5">
            <div className="flex items-start gap-3"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-100 text-emerald-700"><CheckCircle2 className="h-5 w-5" /></span><div><h2 className="text-sm font-bold text-slate-900">Screening complete</h2><p className="mt-1 text-xs leading-5 text-slate-500">The interview is closed and the recruiter evidence report is ready. The original screening record is preserved.</p>{candidate.completedAt && <p className="mt-2 text-[10px] font-bold uppercase tracking-wider text-emerald-700">Completed {new Date(candidate.completedAt).toLocaleString()}</p>}</div></div>
          </section> : <section className="screenit-panel rounded-2xl border-teal-200 bg-teal-50/50 p-5">
            <div className="flex items-start justify-between gap-3"><div><h2 className="text-sm font-bold text-slate-900">Phone screening</h2><p className="mt-0.5 text-xs leading-5 text-slate-500">ScreenIT calls through 3CX, listens, asks one question at a time, and saves the recruiter report.</p></div><span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-teal-100 text-teal-700"><PhoneCall className="h-4 w-4" /></span></div>
            <label className="mt-4 block text-[10px] font-bold uppercase tracking-wider text-slate-500">Candidate phone</label>
            <div className="mt-1.5 flex gap-2"><input value={phone} onChange={(event) => setPhone(event.target.value)} type="tel" placeholder="(239) 555-0123" className="h-10 min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-100" /><button type="button" onClick={callCandidate} disabled={placingCall || !screeningQuestions.length || ["pending", "calling", "connected"].includes(callState?.status ?? "")} className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl bg-[#164e63] px-4 text-xs font-bold text-white shadow-sm hover:bg-[#0e3e50] disabled:cursor-not-allowed disabled:opacity-50">{placingCall ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <PhoneCall className="h-3.5 w-3.5" />}{placingCall ? "Calling…" : "Call"}</button></div>
            {!screeningQuestions.length && !report && <p className="mt-2 text-xs text-amber-700">{checkingPlan ? "Preparing the résumé screening plan…" : "Generate the résumé screening plan before calling."}</p>}
            {callState && <p className={`mt-3 rounded-lg px-3 py-2 text-xs font-semibold ${callState.status === "completed" ? "bg-emerald-100 text-emerald-800" : callState.status === "failed" || callState.status === "no_answer" ? "bg-rose-100 text-rose-800" : "bg-blue-100 text-blue-800"}`}>Call status: <span className="capitalize">{callState.status.replaceAll("_", " ")}</span>{callState.error ? ` · ${callState.error}` : ""}</p>}
            {callError && <p className="mt-2 rounded-lg bg-rose-100 p-2 text-xs text-rose-800">{callError}</p>}
          </section>}
          <section className="screenit-panel rounded-2xl">
            <button onClick={() => setShowResume((current) => !current)} className="flex w-full items-center justify-between p-5 text-left"><span><span className="block text-sm font-bold text-slate-900">Resume evidence</span><span className="mt-0.5 block text-xs text-slate-500">{candidate.resumeFileName}</span></span><ChevronDown className={`h-4 w-4 text-slate-400 transition ${showResume ? "rotate-180" : ""}`} /></button>
            {showResume && <div className="border-t border-slate-100 p-5"><div className="space-y-3">{resumeHighlights.map((highlight) => <p key={highlight} className="flex gap-2 text-sm leading-5 text-slate-700"><FileText className="mt-0.5 h-4 w-4 shrink-0 text-teal-600" />{highlight}</p>)}{!resumeHighlights.length && <p className="text-sm text-slate-400">Résumé analysis is still processing or no explicit evidence was found.</p>}</div>{resumeClarifications.length > 0 && <div className="mt-4 border-t border-slate-100 pt-4"><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Items to clarify</p><div className="mt-2 space-y-2">{resumeClarifications.map((item) => <p key={item} className="flex gap-2 text-sm leading-5 text-amber-800"><CircleHelp className="mt-0.5 h-4 w-4 shrink-0" />{item}</p>)}</div></div>}</div>}
          </section>
          {!report && <section className="screenit-panel rounded-2xl p-5">
            <div className="flex items-start justify-between gap-3"><div><h2 className="text-sm font-bold text-slate-900">AI screening plan</h2><p className="mt-0.5 text-xs text-slate-500">Résumé-specific questions used by the voice interview.</p></div><span className="shrink-0 rounded-full bg-teal-50 px-2.5 py-1 text-[10px] font-bold text-teal-700">{checkingPlan && !screeningQuestions.length ? "Preparing…" : `${screeningQuestions.length} questions`}</span></div>
            <button type="button" onClick={generateScreeningPlan} disabled={analyzing || checkingPlan} className="mt-4 inline-flex h-9 w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:border-teal-300 hover:text-teal-700 disabled:cursor-wait disabled:opacity-60">{analyzing || checkingPlan ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}{analyzing ? "Reading résumé and drafting questions…" : checkingPlan ? "Checking résumé analysis…" : screeningQuestions.length ? "Regenerate from résumé" : "Generate from résumé"}</button>
            {analysisError && <p className="mt-2 rounded-lg bg-rose-50 p-2 text-xs text-rose-700">{analysisError}</p>}
            <div className="mt-4 space-y-3">{screeningQuestions.map((question, index) => <div key={question.id} className="rounded-xl bg-slate-50 p-3"><p className="text-sm font-semibold leading-5 text-slate-800">{index + 1}. {question.prompt}</p><p className="mt-1 text-xs leading-4 text-slate-500">{question.reason}</p></div>)}</div>
          </section>}
          {report && <section className="rounded-2xl border border-amber-200 bg-amber-50/60 p-5"><h2 className="text-sm font-bold text-amber-950">Recruiter clarifications</h2><div className="mt-3 space-y-2.5">{report.clarifications.map((item) => <p key={item} className="flex gap-2 text-sm leading-5 text-amber-900"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />{item}</p>)}</div></section>}
        </aside>
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import { Bot, CheckCircle2, Database, FileSearch, LoaderCircle, Mic2, PhoneCall, RefreshCw, ShieldCheck } from "lucide-react";
import type { AiConfiguration, AiConnectionStatus, VoiceBridgeStatus } from "@/lib/ai-status";

interface AiSettingsPayload {
  readonly configuration: AiConfiguration;
  readonly connection: AiConnectionStatus;
  readonly voiceBridge: VoiceBridgeStatus;
  readonly database: "connected" | "demo";
}

const stateClass = {
  connected: "border-emerald-200 bg-emerald-50 text-emerald-700",
  degraded: "border-amber-200 bg-amber-50 text-amber-700",
  not_configured: "border-rose-200 bg-rose-50 text-rose-700",
};

export function AiSettingsPanel({ initial }: { readonly initial: AiSettingsPayload }) {
  const [status, setStatus] = useState(initial);
  const [testing, setTesting] = useState(false);

  async function runTest() {
    setTesting(true);
    try {
      const response = await fetch("/api/settings/ai/test", { method: "POST" });
      if (!response.ok) throw new Error("Connection test failed");
      setStatus(await response.json() as AiSettingsPayload);
    } finally {
      setTesting(false);
    }
  }

  return <div className="space-y-5">
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl border ${stateClass[status.connection.state]}`}><Bot className="h-5 w-5" /></span>
          <div><div className="flex flex-wrap items-center gap-2"><h2 className="text-base font-bold text-slate-950">OpenAI connection</h2><span className={`rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${stateClass[status.connection.state]}`}>{status.connection.state.replace("_", " ")}</span></div><p className="mt-1 text-sm text-slate-500">{status.connection.message}</p><p className="mt-1 text-xs text-slate-400">Checked {new Date(status.connection.checkedAt).toLocaleString()}{status.connection.latencyMs !== null ? ` · ${status.connection.latencyMs} ms` : ""}</p></div>
        </div>
        <button type="button" onClick={runTest} disabled={testing} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-[#203043] px-4 text-sm font-semibold text-white shadow-sm hover:bg-[#2a3d52] disabled:opacity-50">{testing ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}{testing ? "Testing…" : "Run live test"}</button>
      </div>
    </section>

    <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center justify-between"><span className="grid h-10 w-10 place-items-center rounded-xl bg-teal-50 text-teal-700"><Mic2 className="h-5 w-5" /></span><span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${status.connection.realtimeReady ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{status.connection.realtimeReady ? "Ready" : "Check needed"}</span></div><h3 className="mt-4 text-sm font-bold text-slate-950">Voice interviewer</h3><p className="mt-1 text-xs leading-5 text-slate-500">Realtime WebRTC interview with server-issued temporary access.</p><dl className="mt-4 space-y-2 border-t border-slate-100 pt-4 text-xs"><div className="flex justify-between gap-3"><dt className="text-slate-400">Model</dt><dd className="font-semibold text-slate-700">{status.configuration.realtimeModel}</dd></div><div className="flex justify-between gap-3"><dt className="text-slate-400">Voice</dt><dd className="font-semibold capitalize text-slate-700">{status.configuration.realtimeVoice}</dd></div></dl></section>
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center justify-between"><span className="grid h-10 w-10 place-items-center rounded-xl bg-blue-50 text-blue-700"><FileSearch className="h-5 w-5" /></span><span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${status.connection.reportModelReady ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{status.connection.reportModelReady ? "Ready" : "Check needed"}</span></div><h3 className="mt-4 text-sm font-bold text-slate-950">Resume and report AI</h3><p className="mt-1 text-xs leading-5 text-slate-500">Extracts role evidence from resumes and creates structured recruiter reports.</p><dl className="mt-4 space-y-2 border-t border-slate-100 pt-4 text-xs"><div className="flex justify-between gap-3"><dt className="text-slate-400">Resume</dt><dd className="font-semibold text-slate-700">{status.configuration.resumeModel}</dd></div><div className="flex justify-between gap-3"><dt className="text-slate-400">Reports</dt><dd className="font-semibold text-slate-700">{status.configuration.reportModel}</dd></div></dl></section>
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center justify-between"><span className="grid h-10 w-10 place-items-center rounded-xl bg-violet-50 text-violet-700"><Database className="h-5 w-5" /></span><span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${status.database === "connected" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{status.database === "connected" ? "Connected" : "Demo only"}</span></div><h3 className="mt-4 text-sm font-bold text-slate-950">Candidate storage</h3><p className="mt-1 text-xs leading-5 text-slate-500">Candidates, interview transcripts, resumes, and reports persist in ScreenIT tables.</p><div className="mt-4 flex items-center gap-2 border-t border-slate-100 pt-4 text-xs font-semibold text-slate-700">{status.database === "connected" ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <Database className="h-4 w-4 text-amber-600" />}{status.database === "connected" ? "Durable storage active" : "Configure storage before testing"}</div></section>
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center justify-between"><span className="grid h-10 w-10 place-items-center rounded-xl bg-cyan-50 text-cyan-800"><PhoneCall className="h-5 w-5" /></span><span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${status.voiceBridge.state === "connected" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{status.voiceBridge.state === "connected" ? "Ready" : "Check needed"}</span></div><h3 className="mt-4 text-sm font-bold text-slate-950">3CX outbound calling</h3><p className="mt-1 text-xs leading-5 text-slate-500">{status.voiceBridge.message}</p><dl className="mt-4 space-y-2 border-t border-slate-100 pt-4 text-xs"><div className="flex justify-between gap-3"><dt className="text-slate-400">3CX bridge</dt><dd className="font-semibold text-slate-700">{status.voiceBridge.threeCxReady ? "Connected" : "Needs attention"}</dd></div><div className="flex justify-between gap-3"><dt className="text-slate-400">Route point</dt><dd className="font-semibold text-slate-700">{status.voiceBridge.routePoint ?? "Not detected"}</dd></div></dl></section>
    </div>

    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex gap-3"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-700"><ShieldCheck className="h-5 w-5" /></span><div><h2 className="text-sm font-bold text-slate-950">Hiring guardrails</h2><p className="mt-1 text-sm leading-6 text-slate-500">API keys stay server-side. Resume analysis and interview reports are limited to explicit job-related evidence. ScreenIT does not infer protected traits or make the hiring decision.</p></div></div></section>
  </div>;
}

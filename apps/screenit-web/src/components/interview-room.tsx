"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { Check, LoaderCircle, MessageSquareText, Mic, MicOff, ShieldCheck, Volume2 } from "lucide-react";
import { ScreenItLogo } from "@/components/screenit-logo";
import type { Candidate, Position, CandidateReport } from "@/lib/screenit-types";

type Phase = "welcome" | "connecting" | "live" | "complete" | "error";
type TranscriptLine = { readonly speaker: "ScreenIT" | "Candidate"; readonly text: string };

export function InterviewRoom({ candidate, position }: { readonly candidate: Candidate; readonly position: Position }) {
  const [phase, setPhase] = useState<Phase>("welcome");
  const [consented, setConsented] = useState(false);
  const [mode, setMode] = useState<"voice" | "text">("voice");
  const [muted, setMuted] = useState(false);
  const [message, setMessage] = useState("");
  const [questionIndex, setQuestionIndex] = useState(0);
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [report, setReport] = useState<CandidateReport | null>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => () => { peerRef.current?.close(); streamRef.current?.getTracks().forEach((track) => track.stop()); }, []);

  async function begin() {
    if (!consented) return;
    if (mode === "text") {
      setTranscript([{ speaker: "ScreenIT", text: position.questions[0]?.prompt ?? "Tell me about your experience for this role." }]);
      setPhase("live");
      return;
    }
    setPhase("connecting");
    try {
      const sessionResponse = await fetch("/api/realtime/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: candidate.inviteToken, consented: true }) });
      const session = await sessionResponse.json() as { configured?: boolean; clientSecret?: string; error?: string };
      if (!sessionResponse.ok) throw new Error(session.error ?? "Could not prepare the interview");
      if (!session.configured || !session.clientSecret) {
        setMode("text");
        setTranscript([{ speaker: "ScreenIT", text: position.questions[0]?.prompt ?? "Tell me about your experience for this role." }]);
        setPhase("live");
        return;
      }

      const pc = new RTCPeerConnection();
      peerRef.current = pc;
      const audio = new Audio();
      audio.autoplay = true;
      pc.ontrack = (event) => { audio.srcObject = event.streams[0]; };
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));
      const events = pc.createDataChannel("oai-events");
      events.addEventListener("open", () => events.send(JSON.stringify({ type: "response.create" })));
      events.addEventListener("message", (event) => {
        const item = JSON.parse(event.data) as { type?: string; transcript?: string };
        if (item.type === "conversation.item.input_audio_transcription.completed" && item.transcript) setTranscript((current) => [...current, { speaker: "Candidate", text: item.transcript! }]);
        if (item.type === "response.output_audio_transcript.done" && item.transcript) setTranscript((current) => [...current, { speaker: "ScreenIT", text: item.transcript! }]);
      });
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const answerResponse = await fetch("https://api.openai.com/v1/realtime/calls", { method: "POST", body: offer.sdp, headers: { Authorization: `Bearer ${session.clientSecret}`, "Content-Type": "application/sdp" } });
      if (!answerResponse.ok) throw new Error("The voice connection could not start");
      await pc.setRemoteDescription({ type: "answer", sdp: await answerResponse.text() });
      setPhase("live");
    } catch (error) {
      console.error(error);
      setPhase("error");
    }
  }

  function sendText(event: FormEvent) {
    event.preventDefault();
    const answer = message.trim();
    if (!answer) return;
    const next = questionIndex + 1;
    const updated: TranscriptLine[] = [...transcript, { speaker: "Candidate", text: answer }];
    if (next < position.questions.length) updated.push({ speaker: "ScreenIT", text: position.questions[next].prompt });
    setTranscript(updated);
    setMessage("");
    setQuestionIndex(next);
  }

  async function finish() {
    peerRef.current?.close();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    setPhase("connecting");
    const response = await fetch("/api/interviews/complete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: candidate.inviteToken, transcript }) });
    const payload = await response.json() as { report?: CandidateReport; error?: string };
    if (!response.ok || !payload.report) {
      console.error(payload.error ?? "Interview could not be completed");
      setPhase("error");
      return;
    }
    setReport(payload.report ?? null);
    setPhase("complete");
  }

  function toggleMute() {
    const next = !muted;
    streamRef.current?.getAudioTracks().forEach((track) => { track.enabled = !next; });
    setMuted(next);
  }

  return <main className="min-h-screen bg-[#f4f7f6]">
    <header className="border-b border-slate-700 bg-[#172521] px-5 py-4"><div className="mx-auto flex max-w-5xl items-center justify-between"><ScreenItLogo /><span className="text-xs text-slate-400">Candidate interview</span></div></header>
    <div className="mx-auto max-w-5xl px-5 py-8 lg:py-12">
      {phase === "welcome" && <section className="mx-auto max-w-2xl overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xl shadow-slate-900/5">
        <div className="bg-gradient-to-br from-[#17342d] to-[#0f766e] p-7 text-white sm:p-9"><p className="text-xs font-bold uppercase tracking-[0.18em] text-teal-200">Structured screening</p><h1 className="mt-3 text-3xl font-bold tracking-[-0.03em]">Hi {candidate.name.split(" ")[0]}, let’s talk about your experience.</h1><p className="mt-3 max-w-xl text-sm leading-6 text-teal-50/80">This interview is for the <strong>{position.title}</strong> position. It takes about 15–20 minutes and asks the same core job questions for every candidate.</p></div>
        <div className="p-6 sm:p-8"><div className="space-y-3"><p className="flex gap-3 text-sm leading-6 text-slate-700"><ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-teal-600" />With your consent, ScreenIT transcribes your answers to prepare an evidence report for a human recruiter. It does not make the hiring decision.</p><p className="flex gap-3 text-sm leading-6 text-slate-700"><Volume2 className="mt-0.5 h-5 w-5 shrink-0 text-teal-600" />You may use voice or switch to text. Voice recordings are not retained by default.</p></div>
          <label className="mt-6 flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4"><input type="checkbox" checked={consented} onChange={(event) => setConsented(event.target.checked)} className="mt-0.5 h-4 w-4 accent-teal-700" /><span className="text-sm leading-5 text-slate-700">I consent to AI-assisted transcription and analysis of my job-related answers for this screening. I understand a human will review the report.</span></label>
          <div className="mt-5 grid grid-cols-2 gap-2 rounded-xl bg-slate-100 p-1"><button onClick={() => setMode("voice")} className={`flex h-10 items-center justify-center gap-2 rounded-lg text-sm font-semibold ${mode === "voice" ? "bg-white text-teal-800 shadow-sm" : "text-slate-500"}`}><Mic className="h-4 w-4" />Voice</button><button onClick={() => setMode("text")} className={`flex h-10 items-center justify-center gap-2 rounded-lg text-sm font-semibold ${mode === "text" ? "bg-white text-teal-800 shadow-sm" : "text-slate-500"}`}><MessageSquareText className="h-4 w-4" />Text</button></div>
          <button disabled={!consented} onClick={begin} className="mt-5 h-12 w-full rounded-xl bg-teal-700 text-sm font-bold text-white shadow-sm hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-40">Begin interview</button>
        </div>
      </section>}

      {phase === "connecting" && <div className="grid min-h-[55vh] place-items-center text-center"><div><LoaderCircle className="mx-auto h-9 w-9 animate-spin text-teal-600" /><p className="mt-4 text-sm font-semibold text-slate-800">Preparing your interview…</p></div></div>}
      {phase === "error" && <div className="mx-auto max-w-md rounded-2xl border border-rose-200 bg-white p-7 text-center shadow-sm"><p className="font-bold text-slate-900">Voice could not connect</p><p className="mt-2 text-sm text-slate-500">You can continue with the same questions in text mode.</p><button onClick={() => { setMode("text"); setPhase("welcome"); }} className="mt-5 h-10 rounded-xl bg-teal-700 px-4 text-sm font-semibold text-white">Use text interview</button></div>}
      {phase === "live" && <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="flex items-center justify-between border-b border-slate-100 p-5"><div><h1 className="font-bold text-slate-950">{position.title} interview</h1><p className="mt-0.5 text-xs text-slate-500">Answer naturally. Ask for a question to be repeated at any time.</p></div><span className="flex items-center gap-2 text-xs font-semibold text-emerald-700"><span className="screenit-voice-pulse h-2.5 w-2.5 rounded-full bg-emerald-500" />Live</span></div><div className="max-h-[440px] min-h-[360px] space-y-3 overflow-y-auto bg-slate-50/60 p-5">{transcript.map((line, index) => <div key={`${line.speaker}-${index}`} className={`max-w-[86%] rounded-2xl px-4 py-3 text-sm leading-6 ${line.speaker === "Candidate" ? "ml-auto bg-teal-700 text-white" : "border border-slate-200 bg-white text-slate-700"}`}><p className={`mb-1 text-[10px] font-bold uppercase tracking-wider ${line.speaker === "Candidate" ? "text-teal-100" : "text-teal-700"}`}>{line.speaker}</p>{line.text}</div>)}</div>{mode === "text" && <form onSubmit={sendText} className="flex gap-2 border-t border-slate-100 p-4"><textarea value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Type your answer…" className="min-h-20 flex-1 resize-none rounded-xl border border-slate-200 p-3 text-sm outline-none focus:border-teal-500" /><button className="self-end rounded-xl bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white">Send</button></form>}</section>
        <aside className="space-y-4"><section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Progress</p><p className="mt-2 text-sm font-semibold text-slate-800">{mode === "text" ? `${Math.min(questionIndex + 1, position.questions.length)} of ${position.questions.length} questions` : "Voice interview in progress"}</p><div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-teal-500 transition-all" style={{ width: mode === "text" ? `${Math.min(100, ((questionIndex + 1) / Math.max(1, position.questions.length)) * 100)}%` : "55%" }} /></div></section>{mode === "voice" && <button onClick={toggleMute} className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-700 shadow-sm">{muted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}{muted ? "Unmute" : "Mute"}</button>}<button onClick={finish} disabled={mode === "text" && questionIndex < position.questions.length} className="h-11 w-full rounded-xl bg-slate-900 text-sm font-semibold text-white disabled:opacity-40">Finish interview</button></aside>
      </div>}
      {phase === "complete" && <section className="mx-auto max-w-xl rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-xl shadow-slate-900/5"><span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-emerald-50 text-emerald-600"><Check className="h-7 w-7" /></span><h1 className="mt-5 text-2xl font-bold text-slate-950">Interview complete</h1><p className="mt-2 text-sm leading-6 text-slate-500">Thank you, {candidate.name.split(" ")[0]}. Your answers were saved for the recruiting team to review. They will contact you about any next steps.</p>{report && <p className="mt-5 rounded-xl bg-slate-50 p-4 text-xs leading-5 text-slate-500">The recruiter received a structured report covering {report.evidence.length} role requirements. ScreenIT did not make a hiring decision.</p>}</section>}
    </div>
  </main>;
}

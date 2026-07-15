export type IgnoredCallMethod =
  | "ignored_ivr"
  | "ignored_no_external_number"
  | "ignored_short_call"
  | "ignored_silence"
  | "ignored_unusable_recording";

interface IgnoredCallInput {
  readonly transcript: string | null;
  readonly startedAt: string | null;
  readonly endedAt: string | null;
  readonly matchedBy: string | null;
  readonly analysisAttempts: number;
}

const MAX_TRANSCRIPT_POLL_ATTEMPTS = 20;
const SHORT_CALL_SECONDS = 12;

const EXPLICIT_TICKET = /(?:\bticket\b|\bcase\b|\brequest\b)\s*(?:(?:number|no\.?|#)\s*)?#?\s*\d(?:[\s-]?\d){4,7}/i;
const ACTIONABLE_LANGUAGE = /\b(?:not working|stopped working|can't work|cannot work|issue|problem|error|down|offline|locked out|password|need help|call me back|computer|laptop|printer|scanner|email|outlook|internet|server|network|wi-?fi|teams)\b/i;
const STRONG_IVR = [
  /\bautomated attendant\b/i,
  /\b(?:can'?t|cannot|unable to) (?:take|get|answer) (?:your|the) call\b/i,
  /\bpress any key\b/i,
  /\b(?:leave|record) (?:your|a) message (?:after|at) (?:the )?(?:tone|beep)\b/i,
  /\b(?:has been|was) forwarded to (?:an automated )?(?:voice mail|voicemail)\b/i,
  /\bmailbox (?:is )?(?:full|not accepting messages)\b/i,
  /\bmenu options?\b/i,
  /\bif you know (?:your|the) party'?s extension\b/i,
  /\byour call (?:is important|cannot be completed)\b/i,
];
const WEAK_IVR = [
  /\bpress (?:\d|one|two|three|four|five|six|seven|eight|nine|zero)\b/i,
  /\bplease hold (?:while|for)\b/i,
  /\b(?:dial|enter) (?:the )?(?:extension|number)\b/i,
  /\bthank you for calling\b/i,
  /\bour (?:normal )?business hours\b/i,
  /\bno one is available to take your call\b/i,
  /\bplease listen carefully\b/i,
];

function durationSeconds(startedAt: string | null, endedAt: string | null): number | null {
  const start = startedAt ? new Date(startedAt).getTime() : NaN;
  const end = endedAt ? new Date(endedAt).getTime() : NaN;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return Math.round((end - start) / 1_000);
}

function looksLikeIvr(transcript: string): boolean {
  if (STRONG_IVR.some((pattern) => pattern.test(transcript))) return true;
  return WEAK_IVR.filter((pattern) => pattern.test(transcript)).length >= 2;
}

export function ignoredCallMethod(input: IgnoredCallInput): IgnoredCallMethod | null {
  if (input.matchedBy?.startsWith("ignored_")) return input.matchedBy as IgnoredCallMethod;
  if (input.matchedBy === "no_external_number") return "ignored_no_external_number";

  const transcript = (input.transcript ?? "").replace(/\s+/g, " ").trim();
  if (EXPLICIT_TICKET.test(transcript)) return null;
  if (looksLikeIvr(transcript)) return "ignored_ivr";

  const actionable = ACTIONABLE_LANGUAGE.test(transcript);
  const seconds = durationSeconds(input.startedAt, input.endedAt);
  if (seconds !== null && seconds <= SHORT_CALL_SECONDS && !actionable) {
    return transcript.length < 5 ? "ignored_silence" : "ignored_short_call";
  }

  if (
    input.matchedBy === "transcript_too_short"
    && input.analysisAttempts >= MAX_TRANSCRIPT_POLL_ATTEMPTS
    && !actionable
  ) {
    return transcript.length < 5 ? "ignored_silence" : "ignored_unusable_recording";
  }

  return null;
}

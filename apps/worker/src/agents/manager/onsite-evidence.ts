import { isInternalStaffName } from "@triageit/shared";

export interface OnsiteEvidenceAction {
  readonly who: string;
  readonly note: string;
  readonly outcome?: string | null;
}

const CONFIRMED_ONSITE_PATTERNS: ReadonlyArray<RegExp> = [
  /\b(?:i|we)\s+(?:am|are|was|were)\s+(?:currently\s+)?on[- ]?site\b/i,
  /\b(?:i|we)\s+(?:went|drove|travel(?:ed|led)?|headed|arrived|stopped(?:\s+by)?)\s+(?:out\s+)?(?:(?:on[- ]?site)\b|(?:to|at)\s+(?:the\s+)?(?:client|customer)(?:'s)?\s+(?:site|office|location)\b)/i,
  /\b(?:i|we)\s+(?:completed|performed|provided)\b.{0,60}\b(?:on[- ]?site|onsite)\s+(?:visit|work|service|support)\b/i,
  /\b(?:i|we)\s+met\b.{0,60}\b(?:on[- ]?site|at\s+(?:the\s+)?(?:client|customer)(?:'s)?\s+(?:office|site|location))\b/i,
];

/** Billing alerts require an explicit onsite statement authored by Gamma staff. */
export function hasConfirmedGammaOnsiteEvidence(
  actions: ReadonlyArray<OnsiteEvidenceAction>,
): boolean {
  return actions.some((action) => {
    if (!isInternalStaffName(action.who)) return false;
    if (/\bon[- ]?site\b/i.test(action.outcome ?? "")) return true;
    const note = action.note.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    return CONFIRMED_ONSITE_PATTERNS.some((pattern) => pattern.test(note));
  });
}

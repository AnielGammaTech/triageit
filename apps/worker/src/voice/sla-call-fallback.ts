export const DISPATCH_FOLLOWUP_PREFIX = "[DISPATCH FOLLOW-UP] ";

export type SlaCallFailureReason =
  | "no_answer"
  | "voicemail"
  | "dial_failed"
  | "no_destination";

const FAILURE_LABELS: Record<SlaCallFailureReason, string> = {
  no_answer: "the technician did not answer",
  voicemail: "the call reached the technician's voicemail",
  dial_failed: "the automated call could not be connected",
  no_destination: "no working extension or phone number could be found for the technician",
};

export function buildDispatcherFollowupObjective(input: {
  readonly haloId: number;
  readonly techName: string | null;
  readonly reason: SlaCallFailureReason;
  readonly sourceCallType?: "breach" | "pre_breach";
}): string {
  const tech = input.techName?.trim() || "the assigned technician";
  const timing = input.sourceCallType === "pre_breach"
    ? "The ticket is about to breach its SLA while the technician appears unavailable."
    : "The ticket has breached its SLA.";
  return `${DISPATCH_FOLLOWUP_PREFIX}TriageIt's SLA call to ${tech} for ticket #${input.haloId} did not reach them because ${FAILURE_LABELS[input.reason]}. ${timing} Tell Bryanna what happened, ask her to contact ${tech} directly, and ask her to confirm she will make sure the ticket is handled.`;
}

export function isDispatcherFollowupObjective(objective: string | null | undefined): boolean {
  return objective?.startsWith(DISPATCH_FOLLOWUP_PREFIX) ?? false;
}

export function spokenDispatcherFollowupObjective(objective: string): string {
  return isDispatcherFollowupObjective(objective)
    ? objective.slice(DISPATCH_FOLLOWUP_PREFIX.length).trim()
    : objective;
}

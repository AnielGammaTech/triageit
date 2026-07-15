export type PhoneTicketMatchStrategy =
  | "direct_user"
  | "transcript_user"
  | "transcript_client"
  | "none";

export type TranscriptTicketMatchScope = "user" | "client" | "shared_phone" | "global" | "callback_number" | "cnam";

interface PhoneTicketMatchCounts {
  readonly haloUserCount: number;
  readonly exactUserTicketCount: number;
  readonly clientTicketCount: number;
}

/** Shared directory numbers cannot safely identify one Halo contact or ticket. */
export function choosePhoneTicketMatchStrategy(
  counts: PhoneTicketMatchCounts,
): PhoneTicketMatchStrategy {
  if (counts.haloUserCount <= 0 || counts.clientTicketCount <= 0) return "none";
  if (counts.haloUserCount > 1) return "transcript_client";
  if (counts.exactUserTicketCount === 1) return "direct_user";
  if (counts.exactUserTicketCount > 1) return "transcript_user";
  return "transcript_client";
}

/** Phone formats commonly embedded in ticket bodies and email signatures. */
export function phoneTicketSearchTerms(rawNumber: string): ReadonlyArray<string> {
  const digits = rawNumber.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  if (digits.length !== 10) return digits.length >= 7 ? [digits] : [];
  const area = digits.slice(0, 3);
  const exchange = digits.slice(3, 6);
  const line = digits.slice(6);
  return [
    digits,
    `1${digits}`,
    `${area}-${exchange}-${line}`,
    `${area} ${exchange} ${line}`,
    `${area}.${exchange}.${line}`,
  ];
}

export function transcriptTicketMatchMinConfidence(
  scope: TranscriptTicketMatchScope,
  ticketOpen: boolean | null | undefined,
  ticketActivityAt: string | null | undefined,
  now = Date.now(),
): number {
  if (scope === "global" || scope === "shared_phone" || scope === "cnam") return 0.75;
  if (scope !== "callback_number") return ticketOpen === false ? 0.75 : 0.6;
  const activityAt = ticketActivityAt ? new Date(ticketActivityAt).getTime() : NaN;
  const staleClosed = ticketOpen === false
    && (!Number.isFinite(activityAt) || now - activityAt > 21 * 24 * 3600_000);
  return staleClosed ? 0.9 : 0.8;
}

const UNMATCHED_RETRY_DELAYS_MS = [5, 30, 120, 480].map((minutes) => minutes * 60_000);

/**
 * Retry unmatched calls after customer context has had time to change. Tickets
 * are often created from the call itself, so minute-by-minute retries spend the
 * entire budget before the ticket exists.
 */
export function unmatchedRematchDue(
  createdAt: string | null | undefined,
  attempts: number,
  now = Date.now(),
): boolean {
  if (!Number.isInteger(attempts) || attempts < 0 || attempts >= UNMATCHED_RETRY_DELAYS_MS.length) return false;
  const created = createdAt ? new Date(createdAt).getTime() : NaN;
  if (!Number.isFinite(created)) return false;
  return now - created >= UNMATCHED_RETRY_DELAYS_MS[attempts];
}

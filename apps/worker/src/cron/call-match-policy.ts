export type PhoneTicketMatchStrategy =
  | "direct_user"
  | "transcript_user"
  | "transcript_client"
  | "none";

export type TranscriptTicketMatchScope = "user" | "client" | "shared_phone" | "global" | "callback_number";

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
  ticketCreatedAt: string | null | undefined,
  now = Date.now(),
): number {
  if (scope === "global" || scope === "shared_phone") return 0.75;
  if (scope !== "callback_number") return 0.6;
  const createdAt = ticketCreatedAt ? new Date(ticketCreatedAt).getTime() : NaN;
  const staleClosed = ticketOpen === false
    && (!Number.isFinite(createdAt) || now - createdAt > 21 * 24 * 3600_000);
  return staleClosed ? 0.9 : 0.8;
}

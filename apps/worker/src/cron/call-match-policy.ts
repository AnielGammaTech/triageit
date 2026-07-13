export type PhoneTicketMatchStrategy =
  | "direct_user"
  | "transcript_user"
  | "transcript_client"
  | "none";

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

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

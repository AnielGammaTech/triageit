const HALO_CUSTOMER_REPLY_STATUS_ID = 30;
const HALO_WAITING_ON_TECH_STATUS_ID = 32;

function timestampMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Waiting on Tech is an exact Halo workflow state. PAST-DUE stays separate. */
export function isWaitingOnTechStatus(
  statusId: number | null,
  statusName: string | null,
): boolean {
  return statusId === HALO_WAITING_ON_TECH_STATUS_ID
    || /waiting on tech/i.test(statusName ?? "");
}

/** Halo's Customer Reply workflow state, used only when action timestamps are absent. */
export function isCustomerReplyStatus(
  statusId: number | null,
  statusName: string | null,
): boolean {
  return statusId === HALO_CUSTOMER_REPLY_STATUS_ID
    || /customer reply/i.test(statusName ?? "");
}

/**
 * True when the customer currently owns the latest conversation action.
 *
 * Halo statuses can remain on Customer Reply after a technician answers. When
 * a customer timestamp exists it is authoritative and must be newer than the
 * technician action. The status is a fallback only when Halo supplied no
 * customer-action timestamp at all.
 */
export function isCustomerWaitingForTech(input: {
  readonly statusId: number | null;
  readonly statusName: string | null;
  readonly lastCustomerReplyAt: string | null;
  readonly lastTechActionAt: string | null;
}): boolean {
  const customerAt = timestampMs(input.lastCustomerReplyAt);
  const techAt = timestampMs(input.lastTechActionAt);

  if (customerAt !== null) {
    return techAt === null || customerAt > techAt;
  }

  return isCustomerReplyStatus(input.statusId, input.statusName);
}

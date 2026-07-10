import { HaloClient } from "../integrations/halo/client.js";
import { haloEtToUtcIso } from "./et-time.js";
import { fmtEtDayAware } from "./time-format.js";

/**
 * Halo appointment parsing for the dispatch board and schedule sync.
 * Verified live 2026-07-10: /api/Appointment rows carry
 * appointment_type_name ("Reminder" | "Site Visit"), agent_id/agent_name,
 * subject, client_name, site_name, ticket_id, note, and start_date/end_date
 * as ET wall-clock strings WITHOUT a timezone offset.
 */

export interface DispatchAppointment {
  readonly agentId: number | null;
  readonly agentName: string | null;
  /** Display subject — client-prefixed when the raw subject omits the client. */
  readonly subject: string;
  /** Raw Halo subject (no client prefix) — used for Outlook sync matching. */
  readonly rawSubject: string | null;
  /** appointment_type_name: "Site Visit" | "Reminder" | other. */
  readonly type: string | null;
  readonly ticketId: number | null;
  readonly note: string | null;
  readonly clientName: string | null;
  readonly siteName: string | null;
  /** UTC ISO (converted from Halo's ET wall-clock). */
  readonly startsAt: string;
  readonly endsAt: string;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" ? v : null);

export function parseAppointment(row: Record<string, unknown>): DispatchAppointment | null {
  const rawStart = str(row.start_date) ?? str(row.startdate) ?? str(row.start);
  const rawEnd = str(row.end_date) ?? str(row.enddate) ?? str(row.end);
  if (!rawStart || !rawEnd) return null;
  const startsAt = haloEtToUtcIso(rawStart);
  const endsAt = haloEtToUtcIso(rawEnd);
  if (!startsAt || !endsAt) return null;

  const clientName = str(row.client_name);
  const siteName = str(row.site_name);
  const client = clientName ?? siteName;
  const rawSubject = str(row.subject);
  const subject =
    rawSubject && client && !rawSubject.toLowerCase().includes(client.toLowerCase())
      ? `${client} — ${rawSubject}`
      : (rawSubject ?? client ?? "Appointment");

  return {
    agentId: num(row.agent_id),
    agentName: str(row.agent_name) ?? str(row.username) ?? str(row.user_name),
    subject,
    rawSubject,
    type: str(row.appointment_type_name),
    ticketId: num(row.ticket_id),
    note: str(row.note),
    clientName,
    siteName,
    startsAt,
    endsAt,
  };
}

/** Halo appointments in [start, end). Null = lookup failed, never "no appointments". */
export async function fetchAppointments(
  halo: HaloClient | null,
  start: string,
  end: string,
): Promise<ReadonlyArray<DispatchAppointment> | null> {
  if (!halo) return null;
  try {
    const rows = await halo.getAppointments(start, end);
    if (rows === null) return null;
    return rows
      .map(parseAppointment)
      .filter((a): a is DispatchAppointment => a !== null);
  } catch (err) {
    console.warn("[DISPATCH] Appointments fetch failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

// ── Onsite qualification ──────────────────────────────────────────────
// Only a "Site Visit" of sane length flips presence to onsite. A real
// month-long Site Visit exists (Jul 13 → Aug 10 "BANK SCANNER", verified
// 2026-07-10) — it must not mark the tech onsite for a month, and a
// current Reminder is not an onsite either. Both surface as context via
// the commitment label instead.

const ONSITE_MAX_DURATION_MS = 12 * 3600_000;

export function qualifiesAsOnsite(a: DispatchAppointment): boolean {
  if ((a.type ?? "").trim().toLowerCase() !== "site visit") return false;
  const durationMs = Date.parse(a.endsAt) - Date.parse(a.startsAt);
  return durationMs > 0 && durationMs <= ONSITE_MAX_DURATION_MS;
}

// ── Commitment labels ─────────────────────────────────────────────────

const typeLabel = (a: DispatchAppointment): string => a.type?.trim() || "Appointment";

/** e.g. "Site Visit: Jenn :: Laptop Setup — Mon 1:00 PM". */
export function nextCommitmentLabel(a: DispatchAppointment, now: Date): string {
  return `${typeLabel(a)}: ${a.subject} — ${fmtEtDayAware(a.startsAt, now)}`;
}

/** A commitment happening now that did NOT flip presence (long Site Visit, Reminder). */
export function currentCommitmentLabel(a: DispatchAppointment, now: Date): string {
  return `${typeLabel(a)}: ${a.subject} — until ${fmtEtDayAware(a.endsAt, now)}`;
}

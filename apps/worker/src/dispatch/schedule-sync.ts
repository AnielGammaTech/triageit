import { createSupabaseClient } from "../db/supabase.js";
import { getCachedHaloConfig } from "../integrations/get-config.js";
import { HaloClient } from "../integrations/halo/client.js";
import type { MsGraphCalendarEvent } from "../integrations/msgraph/client.js";
import { fetchAppointments, type DispatchAppointment } from "./appointments.js";
import { fetchRoster, loadMsGraphIntegration, namesMatch } from "./board-sources.js";
import { utcIsoToEtWall } from "./et-time.js";

/**
 * Halo → Outlook schedule sync (user requirement 2026-07-10): every Halo
 * scheduled appointment should exist on the tech's own Outlook calendar
 * with the date, type, and note; when missing, TriageIT creates it.
 *
 * CREATE-ONLY by design: existing events are never updated or deleted, and
 * nothing is ever written to Halo. Loop safety comes from the matching
 * rule below — TriageIT-created events carry the "TriageIT" category and a
 * subject containing the Halo subject, so they (and copies made by Halo's
 * own native M365 sync) match on every subsequent run instead of being
 * re-created.
 */

export interface ScheduleSyncResult {
  readonly checked: number;
  readonly created: number;
  readonly failures: number;
}

const SYNC_WINDOW_MS = 14 * 24 * 3600_000;
const MAX_APPOINTMENT_DURATION_MS = 14 * 24 * 3600_000;
const SUBJECT_MATCH_PREFIX_LEN = 40;
const TRIAGEIT_CATEGORY = "triageit";

const ZERO: ScheduleSyncResult = { checked: 0, created: 0, failures: 0 };

type SyncableAppointment = DispatchAppointment & { readonly rawSubject: string };

/** Worth syncing: has a real subject and a sane (>0, ≤14 days) duration. */
export function isSyncableAppointment(a: DispatchAppointment): a is SyncableAppointment {
  if (!a.rawSubject || !a.rawSubject.trim()) return false;
  const durationMs = Date.parse(a.endsAt) - Date.parse(a.startsAt);
  return durationMs > 0 && durationMs <= MAX_APPOINTMENT_DURATION_MS;
}

/**
 * Matching rule: the Outlook event's subject must contain the appointment
 * subject (case-insensitive, first 40 chars), AND either its time overlaps
 * the appointment window OR it carries the TriageIT category (covers our
 * own prior creates even if the Halo appointment was since moved).
 */
export function eventMatchesAppointment(
  appt: Pick<DispatchAppointment, "rawSubject" | "startsAt" | "endsAt">,
  event: MsGraphCalendarEvent,
): boolean {
  const needle = (appt.rawSubject ?? "").trim().slice(0, SUBJECT_MATCH_PREFIX_LEN).toLowerCase();
  if (!needle) return false;
  if (!(event.subject ?? "").toLowerCase().includes(needle)) return false;

  const overlaps =
    Date.parse(event.startsAt) < Date.parse(appt.endsAt) &&
    Date.parse(event.endsAt) > Date.parse(appt.startsAt);
  const isTriageIt = event.categories.some((c) => c.toLowerCase() === TRIAGEIT_CATEGORY);
  return overlaps || isTriageIt;
}

/** "[{type}] {subject}" — the type tag mirrors the Halo appointment type. */
export function outlookSubjectFor(appt: DispatchAppointment): string {
  return `[${appt.type?.trim() || "Appointment"}] ${(appt.rawSubject ?? appt.subject).trim()}`;
}

/** Event body: note (if any) + client/site + ticket + provenance line. */
export function outlookBodyFor(appt: DispatchAppointment): string {
  const clientSite = [appt.clientName, appt.siteName]
    .filter((v): v is string => v !== null)
    .join(" — ");
  return [
    appt.note?.trim() || null,
    clientSite || null,
    appt.ticketId !== null ? `Ticket #${appt.ticketId}` : null,
    "Created by TriageIT from Halo schedule",
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

export async function runScheduleSync(): Promise<ScheduleSyncResult> {
  const supabase = createSupabaseClient();

  let halo: HaloClient | null = null;
  try {
    const haloConfig = await getCachedHaloConfig(supabase);
    if (haloConfig) halo = new HaloClient(haloConfig);
  } catch (err) {
    console.warn("[SCHEDULE-SYNC] Halo config lookup failed:", err instanceof Error ? err.message : err);
  }
  if (!halo) {
    console.warn("[SCHEDULE-SYNC] Halo not configured — skipping run");
    return ZERO;
  }

  const integration = await loadMsGraphIntegration(supabase);
  if (!integration) {
    console.warn("[SCHEDULE-SYNC] Microsoft 365 not connected — skipping run");
    return ZERO;
  }
  const { graph } = integration;

  const roster = await fetchRoster(halo);
  if (roster === null) {
    console.warn("[SCHEDULE-SYNC] Roster lookup failed — skipping run");
    return { ...ZERO, failures: 1 };
  }

  const now = new Date();
  const startIso = now.toISOString();
  const endIso = new Date(now.getTime() + SYNC_WINDOW_MS).toISOString();
  const appointments = await fetchAppointments(halo, startIso, endIso);
  if (appointments === null) {
    console.warn("[SCHEDULE-SYNC] Appointments lookup failed — skipping run");
    return { ...ZERO, failures: 1 };
  }
  const syncable = appointments.filter(isSyncableAppointment);

  let checked = 0;
  let created = 0;
  let failures = 0;

  for (const tech of roster) {
    if (tech.email === null) continue;
    const mine = syncable.filter(
      (a) => (tech.id > 0 && a.agentId === tech.id) || namesMatch(tech.name, a.agentName),
    );
    if (mine.length === 0) continue;

    // Each mailbox degrades independently: an unreadable calendar skips
    // this tech (we can't verify, so we must not create blind duplicates).
    const events = await graph.getCalendarView(tech.email, startIso, endIso);
    if (events === null) {
      console.warn(
        `[SCHEDULE-SYNC] Calendar read failed for ${tech.email} — skipping ${mine.length} appointment(s)`,
      );
      failures++;
      continue;
    }

    for (const appt of mine) {
      checked++;
      if (events.some((e) => eventMatchesAppointment(appt, e))) continue;

      const startEtWall = utcIsoToEtWall(appt.startsAt);
      const endEtWall = utcIsoToEtWall(appt.endsAt);
      if (!startEtWall || !endEtWall) {
        console.warn(`[SCHEDULE-SYNC] Unparseable times on "${appt.rawSubject}" — skipping`);
        failures++;
        continue;
      }

      const subject = outlookSubjectFor(appt);
      const eventId = await graph.createEvent(tech.email, {
        subject,
        bodyText: outlookBodyFor(appt),
        startEtWall,
        endEtWall,
      });
      if (eventId !== null) {
        created++;
        console.log(`[SCHEDULE-SYNC] Created "${subject}" on ${tech.email} (${startEtWall})`);
      } else {
        failures++;
        console.warn(`[SCHEDULE-SYNC] Create failed for "${subject}" on ${tech.email}`);
      }
    }
  }

  console.log(
    `[SCHEDULE-SYNC] Complete: ${checked} checked, ${created} created, ${failures} failures`,
  );
  return { checked, created, failures };
}

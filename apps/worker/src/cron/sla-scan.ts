import { createSupabaseClient } from "../db/supabase.js";
import { HaloClient } from "../integrations/halo/client.js";
import {
  deriveWorkflowOwnerRole,
  isHelpdeskTechnicianName,
  isSlaTargetBreached,
  isSlaTimerBreached,
  type HaloConfig,
  type TeamsConfig,
} from "@triageit/shared";
import { TeamsClient } from "../integrations/teams/client.js";
import { enqueueTriageJob } from "../queue/producer.js";

interface SlaScanResult {
  readonly totalChecked: number;
  readonly breachesFound: number;
  readonly triageEnqueued: number;
  readonly skippedCurrentlyTriaging: number;
  readonly errors: ReadonlyArray<string>;
}

/**
 * Scan all open tickets in Halo for SLA breaches.
 * For each breached ticket, enqueue a triage job.
 *
 * Cooldown: based on the most recent triage_results entry for the ticket,
 * NOT on updated_at (which gets refreshed by every Halo sync).
 *
 * This runs:
 * 1. On worker startup (retroactive catch-up)
 * 2. Every cron cycle alongside the daily retriage scan
 */
export async function scanForSlaBreaches(): Promise<SlaScanResult> {
  const supabase = createSupabaseClient();
  const errors: string[] = [];

  // Get Halo config
  const { data: integration } = await supabase
    .from("integrations")
    .select("config")
    .eq("service", "halo")
    .eq("is_active", true)
    .single();

  if (!integration) {
    console.log("[SLA SCAN] Halo not configured — skipping SLA scan");
    return {
      totalChecked: 0,
      breachesFound: 0,
      triageEnqueued: 0,
      skippedCurrentlyTriaging: 0,
      errors: [],
    };
  }

  const haloConfig = integration.config as HaloConfig;
  const halo = new HaloClient(haloConfig);

  // Fetch all open tickets with SLA info
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let allOpenTickets: ReadonlyArray<Record<string, any>>;

  try {
    // Only scan "Gamma Default" tickets (type id=31)
    const rawTickets = await halo.getOpenTickets(31);
    allOpenTickets = rawTickets as unknown as typeof allOpenTickets;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[SLA SCAN] Failed to fetch open tickets from Halo:", msg);
    return {
      totalChecked: 0,
      breachesFound: 0,
      triageEnqueued: 0,
      skippedCurrentlyTriaging: 0,
      errors: [`Failed to fetch tickets: ${msg}`],
    };
  }

  // Log first ticket's SLA fields for debugging
  if (allOpenTickets.length > 0) {
    const sample = allOpenTickets[0];
    console.log("[SLA SCAN] Sample ticket SLA fields:", JSON.stringify({
      id: sample.id,
      fixtargetmet: sample.fixtargetmet,
      responsetargetmet: sample.responsetargetmet,
      fixbydate: sample.fixbydate,
      respondbydate: sample.respondbydate,
      sla_timer_text: sample.sla_timer_text,
      sla: sample.sla,
      sladetails: sample.sladetails,
    }));
  }

  // TWO-STAGE SCAN. Halo's LIST endpoint returns NO SLA target fields even
  // with includeslainfo=true (verified live 2026-07-09: no fixtargetmet /
  // responsetargetmet / sla / sladetails on list rows) — so the old
  // list-only filter could NEVER flag a breach (isSlaTargetBreached needs
  // targetMet === false, list rows gave undefined). Stage 1: cheap date
  // screen on the list's fixbydate/respondbydate. Stage 2: fetch each
  // candidate's full ticket (which DOES carry targets + onhold) and apply
  // the real breach test.
  const datePast = (v: unknown): boolean => {
    if (typeof v !== "string" || !v) return false;
    const t = new Date(v).getTime();
    return Number.isFinite(t) && t < Date.now();
  };
  // Fix-deadline misses first — a blown fix target outranks a blown
  // first-response target. Log if the cap ever drops candidates.
  const allCandidates = allOpenTickets
    .filter((t) => datePast(t.fixbydate) || datePast(t.respondbydate))
    .sort((a, b) => Number(datePast(b.fixbydate)) - Number(datePast(a.fixbydate)));
  const candidates = allCandidates.slice(0, 80);
  if (allCandidates.length > candidates.length) {
    console.warn(`[SLA SCAN] ${allCandidates.length - candidates.length} past-due candidates dropped by the 80 cap`);
  }

  const breachers: Record<string, any>[] = [];
  for (const candidate of candidates) {
    try {
      const full = (await halo.getTicketWithSLA(candidate.id as number)) as unknown as Record<string, any>;
      // An on-hold SLA timer isn't burning — targets shift when it resumes
      if (full.onhold === true) continue;
      const slaSource = full.sla ?? full.sladetails ?? full;
      const fixByDate = slaSource.fixbydate ?? full.fixbydate ?? candidate.fixbydate ?? null;
      const respondByDate = slaSource.respondbydate ?? full.respondbydate ?? candidate.respondbydate ?? null;
      // Negative SLA timer = breached, exactly what Halo's own Breached SLA
      // view shows. Target-based test kept as fallback (fixtargetmet is
      // always null on this instance — verified live 2026-07-09).
      const timeLeft =
        typeof full.fixtimeleft === "number" ? full.fixtimeleft
        : typeof full.slatimeleft === "number" ? full.slatimeleft
        : null;
      const timerBreached = isSlaTimerBreached(timeLeft, full.onhold === true);
      const fixBreached =
        isSlaTargetBreached(slaSource.fixtargetmet, fixByDate) ||
        isSlaTargetBreached(full.fixtargetmet, fixByDate);
      const responseBreached =
        isSlaTargetBreached(slaSource.responsetargetmet, respondByDate) ||
        isSlaTargetBreached(full.responsetargetmet, respondByDate);
      if (timerBreached || fixBreached || responseBreached) breachers.push({ ...candidate, ...full });
    } catch (error) {
      console.warn(`[SLA SCAN] Detail fetch for #${candidate.id} failed:`, error instanceof Error ? error.message : error);
    }
  }
  if (candidates.length > 0) {
    console.log(`[SLA SCAN] ${candidates.length} past-due-date candidates → ${breachers.length} confirmed breaches after detail check`);
  }

  // A ticket that recovered (SLA extended / resolved-reopened) gets its
  // alert flag cleared so a FUTURE breach alerts again
  const breachedIdSet = new Set(breachers.map((t) => t.id as number));
  const recoveredIds = allOpenTickets
    .map((t) => t.id as number)
    .filter((id) => !breachedIdSet.has(id));
  if (recoveredIds.length > 0) {
    await supabase
      .from("tickets")
      .update({ sla_breach_alerted_at: null, sla_breach_alert_count: 0 })
      .in("halo_id", recoveredIds)
      .not("sla_breach_alerted_at", "is", null);
  }

  if (breachers.length === 0) {
    console.log(
      `[SLA SCAN] Checked ${allOpenTickets.length} open tickets — no SLA breaches found`,
    );
    return {
      totalChecked: allOpenTickets.length,
      breachesFound: 0,
      triageEnqueued: 0,
      skippedCurrentlyTriaging: 0,
      errors: [],
    };
  }

  console.log(
    `[SLA SCAN] Found ${breachers.length} SLA-breaching tickets out of ${allOpenTickets.length} open`,
  );

  // Teams alert to management (Aniel & David) — ONCE per breach, tracked in
  // tickets.sla_breach_alerted_at so the 3-hourly scan never re-pings
  try {
    // Local rows carry the fields Halo's raw ticket object doesn't reliably
    // expose (agent name, readable status) — the first cards went out with
    // "UNASSIGNED/Unknown" because they trusted the Halo fields
    const { data: alertState } = await supabase
      .from("tickets")
      .select("halo_id, sla_breach_alerted_at, sla_breach_alert_count, halo_agent, halo_status, client_name, summary")
      .in("halo_id", breachers.map((t) => t.id as number));
    const localByHaloId = new Map((alertState ?? []).map((t) => [t.halo_id as number, t]));
    // Grace period: only alert once the breach is >10 minutes old — a timer
    // that JUST ticked negative may recover (status change, hold) before
    // anyone could act, and pinging management for that is noise
    const GRACE_HOURS = 10 / 60;
    // Escalation: still breached an hour after the last alert → alert again,
    // labeled "2nd alert", "3rd alert", … (scan runs hourly to keep cadence)
    const REALERT_MS = 60 * 60 * 1000;
    const breachAge = (t: Record<string, any>): number | null => {
      const timeLeft =
        typeof t.fixtimeleft === "number" ? t.fixtimeleft
        : typeof t.slatimeleft === "number" ? t.slatimeleft
        : null;
      return timeLeft != null && timeLeft < 0 ? Math.abs(timeLeft) : null;
    };
    const toAlert = breachers.filter((t) => {
      const age = breachAge(t);
      if (age == null || age < GRACE_HOURS) return false;
      const local = localByHaloId.get(t.id as number);
      const lastAlerted = local?.sla_breach_alerted_at ? new Date(local.sla_breach_alerted_at as string).getTime() : null;
      if (lastAlerted == null) return true; // first notice
      return Date.now() - lastAlerted >= REALERT_MS; // hourly escalation
    });

    if (toAlert.length > 0) {
      const { data: teamsIntegration } = await supabase
        .from("integrations")
        .select("config")
        .eq("service", "teams")
        .eq("is_active", true)
        .maybeSingle();
      if (teamsIntegration?.config) {
        const teams = new TeamsClient(teamsIntegration.config as TeamsConfig);
        const haloWebBase = haloConfig.base_url?.replace(/\/api\/?$/, "") ?? null;
        for (const breacher of toAlert) {
          const haloId = breacher.id as number;
          const local = localByHaloId.get(haloId);
          const timeLeft =
            typeof breacher.fixtimeleft === "number" ? breacher.fixtimeleft
            : typeof breacher.slatimeleft === "number" ? breacher.slatimeleft
            : null;
          const attempt = ((local?.sla_breach_alert_count as number) ?? 0) + 1;
          try {
            await teams.sendSlaBreachAlert({
              haloId,
              summary: String(local?.summary ?? breacher.summary ?? "").slice(0, 120),
              clientName: (local?.client_name as string) ?? (breacher.client_name as string) ?? null,
              techName: (local?.halo_agent as string) ?? (breacher.agent_name as string) ?? (breacher.agent?.name as string) ?? null,
              status: (local?.halo_status as string) ?? (breacher.status_name as string) ?? null,
              hoursOver: timeLeft != null && timeLeft < 0 ? Math.abs(timeLeft) : null,
              ticketUrl: haloWebBase ? `${haloWebBase}/tickets?id=${haloId}` : null,
              attempt,
            });
            await supabase
              .from("tickets")
              .update({ sla_breach_alerted_at: new Date().toISOString(), sla_breach_alert_count: attempt })
              .eq("halo_id", haloId);
            console.log(`[SLA SCAN] Teams breach alert sent for #${haloId} (alert #${attempt})`);
          } catch (error) {
            console.error(`[SLA SCAN] Teams alert for #${haloId} failed:`, error instanceof Error ? error.message : error);
          }
        }
      } else {
        console.warn("[SLA SCAN] Teams not configured — breach alerts skipped");
      }
    }
  } catch (error) {
    console.error("[SLA SCAN] Breach alerting failed:", error instanceof Error ? error.message : error);
  }

  // Look up which breaching tickets exist locally
  const breacherHaloIds = breachers.map((t) => t.id as number);
  const { data: localTickets } = await supabase
    .from("tickets")
    .select("id, halo_id, summary, status")
    .in("halo_id", breacherHaloIds);

  const localTicketMap = new Map(
    (localTickets ?? []).map((t: { halo_id: number; id: string; summary: string; status: string }) => [t.halo_id, t]),
  );

  // Get actual last triage time from triage_results (NOT updated_at)
  const localIds = (localTickets ?? []).map((t) => t.id);
  const { data: recentTriageResults } = localIds.length > 0
    ? await supabase
        .from("triage_results")
        .select("ticket_id, created_at")
        .in("ticket_id", localIds)
        .order("created_at", { ascending: false })
    : { data: [] };

  // Build a map of ticket_id → most recent triage time
  const lastTriageMap = new Map<string, number>();
  for (const result of recentTriageResults ?? []) {
    if (!lastTriageMap.has(result.ticket_id)) {
      lastTriageMap.set(result.ticket_id, new Date(result.created_at).getTime());
    }
  }

  const threeHoursAgo = Date.now() - 3 * 60 * 60 * 1000;
  let triageEnqueued = 0;
  let skippedCurrentlyTriaging = 0;

  for (const breacher of breachers) {
    const haloId = breacher.id as number;
    const local = localTicketMap.get(haloId);

    // If ticket doesn't exist locally yet, create it first
    if (!local) {
      try {
        const haloAgent = (breacher.agent_name as string | undefined) ?? null;
        const hasAssignedTech = isHelpdeskTechnicianName(haloAgent);
        const { data: created } = await supabase
          .from("tickets")
          .insert({
            halo_id: haloId,
            summary: breacher.summary as string,
            status: "pending" as const,
            // Without tickettype_id, reconcileClosedTickets (filters type 31)
            // never closes these rows — they became permanent zombies feeding
            // closed-ticket alerts forever
            tickettype_id: (breacher.tickettype_id as number | undefined) ?? 31,
            halo_is_open: true,
            halo_status: ((breacher.statusname as string | undefined) ?? (breacher.status_name as string | undefined) ?? (breacher.status as string | undefined) ?? null),
            halo_status_id: typeof breacher.status_id === "number" ? breacher.status_id : null,
            halo_agent: haloAgent,
            workflow_status: "PAST_DUE",
            workflow_owner_role: deriveWorkflowOwnerRole("PAST_DUE", hasAssignedTech),
            resolution_time_at: ((breacher.deadlinedate as string | undefined) ?? (breacher.fixbydate as string | undefined) ?? (breacher.respondbydate as string | undefined) ?? null),
            workflow_past_due: true,
            past_due_count: 1,
            created_at: (breacher as Record<string, unknown>).datecreated as string ?? new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .select("id, halo_id, summary")
          .single();

        if (created) {
          const jobId = await enqueueTriageJob({
            ticketId: created.id,
            haloId: created.halo_id,
            summary: created.summary,
          });
          console.log(
            `[SLA SCAN] Created + enqueued SLA-breaching ticket #${haloId} (job: ${jobId})`,
          );
          triageEnqueued++;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`Failed to create ticket #${haloId}: ${msg}`);
      }
      continue;
    }

    // Skip if currently being triaged
    if (local.status === "triaging" || local.status === "pending") {
      skippedCurrentlyTriaging++;
      continue;
    }

    // Cooldown: skip only if there's an ACTUAL triage result within the last 3 hours
    const lastTriageTime = lastTriageMap.get(local.id);
    if (lastTriageTime && lastTriageTime > threeHoursAgo) {
      console.log(
        `[SLA SCAN] Ticket #${haloId} was triaged ${Math.round((Date.now() - lastTriageTime) / 60000)}min ago — skipping`,
      );
      skippedCurrentlyTriaging++;
      continue;
    }

    // Mark as pending and enqueue triage
    try {
      const haloAgent = (breacher.agent_name as string | undefined) ?? null;
      const hasAssignedTech = isHelpdeskTechnicianName(haloAgent);
      await supabase
        .from("tickets")
        .update({
          status: "pending" as const,
          workflow_status: "PAST_DUE",
          workflow_owner_role: deriveWorkflowOwnerRole("PAST_DUE", hasAssignedTech),
          resolution_time_at: ((breacher.deadlinedate as string | undefined) ?? (breacher.fixbydate as string | undefined) ?? (breacher.respondbydate as string | undefined) ?? null),
          workflow_past_due: true,
          updated_at: new Date().toISOString(),
        })
        .eq("id", local.id);

      const jobId = await enqueueTriageJob({
        ticketId: local.id,
        haloId: local.halo_id,
        summary: local.summary,
      });
      console.log(
        `[SLA SCAN] Enqueued SLA-breaching ticket #${haloId} for triage (job: ${jobId})`,
      );
      triageEnqueued++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Failed to enqueue ticket #${haloId}: ${msg}`);
    }
  }

  console.log(
    `[SLA SCAN] Done: ${breachers.length} breaches, ${triageEnqueued} enqueued, ${skippedCurrentlyTriaging} skipped`,
  );

  return {
    totalChecked: allOpenTickets.length,
    breachesFound: breachers.length,
    triageEnqueued,
    skippedCurrentlyTriaging,
    errors,
  };
}

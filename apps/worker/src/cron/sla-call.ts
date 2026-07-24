import { createSupabaseClient } from "../db/supabase.js";
import { HaloClient } from "../integrations/halo/client.js";
import { getCachedHaloConfig } from "../integrations/get-config.js";
import { CallControlClient } from "../voice/call-control.js";
import { ThreeCxClient } from "../integrations/threecx/client.js";
import { isWithinBusinessHours } from "../integrations/teams/client.js";
import { registerEscalationCall } from "../voice/listener.js";
import { buildEscalationCallNote } from "../voice/escalation-note.js";
import { analyzeCustomerWaitState, type CustomerWaitState } from "../voice/customer-wait-state.js";
import {
  buildDispatcherFollowupObjective,
  isDispatcherFollowupObjective,
  spokenDispatcherFollowupObjective,
  type SlaCallFailureReason,
} from "../voice/sla-call-fallback.js";
import {
  buildSaturdaySupportObjective,
  parseSaturdaySupportObjective,
  SATURDAY_SUPPORT_MANAGER_PHONE,
  SATURDAY_SUPPORT_RETRY_MS,
  saturdaySupportDedupeKey,
  saturdaySupportEscalationDedupeKey,
  type SaturdaySupportCallObjective,
} from "../voice/saturday-support-call.js";
import { DISPATCHER, type HaloAction, type ThreeCxConfig } from "@triageit/shared";

/**
 * SLA escalation calls: processes pending sla_call_requests rows — for
 * each, registers the escalation context with the voice listener and
 * originates an outbound call from the 'triageit' route point. When the
 * tech answers, the realtime assistant explains the breach, negotiates a
 * new resolution target, updates Halo, and documents the call.
 *
 * Runs in the SAME process as the voice listener (the registry is
 * in-memory) — rows are inserted by the SLA scan or manually, and a
 * queue job with endpoint /sla-call-requests triggers this handler.
 */

const ROUTE_POINT_DN = process.env.VOICE_ROUTE_POINT_DN ?? "triageit";

async function queueDispatcherFollowupCall(
  supabase: ReturnType<typeof createSupabaseClient>,
  input: {
    readonly haloId: number;
    readonly techName: string | null;
    readonly reason: SlaCallFailureReason;
    readonly sourceCallType?: "breach" | "pre_breach";
  },
): Promise<void> {
  const objective = buildDispatcherFollowupObjective(input);
  const { data: existing, error: lookupError } = await supabase
    .from("sla_call_requests")
    .select("id")
    .eq("halo_id", input.haloId)
    .eq("tech_name", DISPATCHER)
    .eq("call_type", "dispatch_followup")
    .in("status", ["pending", "calling"])
    .gte("created_at", new Date(Date.now() - 15 * 60_000).toISOString())
    .limit(1);
  if (lookupError) throw new Error(lookupError.message);
  if ((existing?.length ?? 0) > 0) return;

  const { error } = await supabase.from("sla_call_requests").insert({
    halo_id: input.haloId,
    phone: null,
    tech_name: DISPATCHER,
    objective,
    call_type: "dispatch_followup",
    dedupe_key: `dispatch_followup:${input.haloId}:${Math.floor(Date.now() / (15 * 60_000))}`,
  });
  if (error?.code === "23505") return;
  if (error) throw new Error(error.message);
  console.log(`[SLA-CALL] Queued Dispatch follow-up call to ${DISPATCHER} for #${input.haloId} (${input.reason})`);
}

async function queueSaturdaySupportManagerEscalation(
  supabase: ReturnType<typeof createSupabaseClient>,
  support: SaturdaySupportCallObjective,
  reason: string,
): Promise<void> {
  const objective = buildSaturdaySupportObjective({
    kind: "manager_escalation",
    technician: support.technician,
    date: support.date,
    shift: support.shift,
    attempt: 3,
    reason,
  });
  const { error } = await supabase.from("sla_call_requests").insert({
    halo_id: 0,
    phone: SATURDAY_SUPPORT_MANAGER_PHONE,
    tech_name: "Aniel Reyes",
    objective,
    call_type: "info",
    due_at: new Date().toISOString(),
    availability_detail: reason,
    dedupe_key: saturdaySupportEscalationDedupeKey(support.date),
  });
  if (error?.code === "23505") return;
  if (error) throw new Error(error.message);
  console.log(`[SATURDAY-SUPPORT] Queued manager escalation to Aniel: ${reason}`);
}

async function handleSaturdaySupportUnreachable(
  supabase: ReturnType<typeof createSupabaseClient>,
  requestId: string,
  support: SaturdaySupportCallObjective,
  reason: SlaCallFailureReason,
): Promise<void> {
  await supabase
    .from("sla_call_requests")
    .update({
      status: reason,
      availability_detail: `${support.technician} was not reached (${reason}), attempt ${support.attempt}.`,
    })
    .eq("id", requestId);

  if (support.kind === "manager_escalation") return;
  if (support.attempt < 2) {
    const nextAttempt = support.attempt + 1;
    const { error } = await supabase.from("sla_call_requests").insert({
      halo_id: 0,
      phone: null,
      tech_name: support.technician,
      objective: buildSaturdaySupportObjective({
        ...support,
        kind: "verification",
        attempt: nextAttempt,
      }),
      call_type: "info",
      due_at: new Date(Date.now() + SATURDAY_SUPPORT_RETRY_MS).toISOString(),
      availability_detail: `Retry ${nextAttempt} scheduled after ${reason}.`,
      dedupe_key: saturdaySupportDedupeKey(support.date, support.technician, nextAttempt),
    });
    if (error?.code !== "23505" && error) throw new Error(error.message);
    console.log(`[SATURDAY-SUPPORT] ${support.technician} unreachable; retry ${nextAttempt} queued in 5 minutes`);
    return;
  }

  await queueSaturdaySupportManagerEscalation(
    supabase,
    support,
    `${support.technician} did not answer two Saturday-duty verification calls; the latest result was ${reason}. Please verify coverage for ${support.shift}.`,
  );
}

async function handleSaturdaySupportResult(
  supabase: ReturnType<typeof createSupabaseClient>,
  requestId: string,
  support: SaturdaySupportCallObjective,
  confirmed: boolean,
  details: string,
): Promise<void> {
  await supabase
    .from("sla_call_requests")
    .update({
      status: confirmed ? "confirmed" : "not_confirmed",
      availability_detail: details,
    })
    .eq("id", requestId);

  if (support.kind === "verification" && !confirmed) {
    await queueSaturdaySupportManagerEscalation(
      supabase,
      support,
      `${support.technician} did not confirm the ${support.shift} Saturday support shift. Response: ${details}`,
    );
  }
}

// TriageIt's own AI-generated notes — skip these when finding the last real
// human communication to read to the tech.
const TRIAGEIT_NOTE_RE = /triage\s*it|call summary|tech review|escalation call|phone message|licensing|client policy|ai triage|suggested reply/i;

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The last REAL communication on the ticket (public or private note), skipping
 * TriageIt's own AI notes, preformatted for the assistant to read aloud —
 * e.g. `private note from Jarid Carlson on July 9: "waiting on the vendor"`.
 */
async function fetchCommunicationContext(
  halo: HaloClient,
  haloId: number,
  statusName: string | null,
): Promise<{ lastCommunication: string | null; customerWait: CustomerWaitState }> {
  let actions: ReadonlyArray<HaloAction>;
  try {
    actions = await halo.getTicketActions(haloId, false);
  } catch {
    return {
      lastCommunication: null,
      customerWait: {
        waitingForUpdate: false,
        requestedContactMethod: "reply",
        reason: null,
        latestCustomerMessage: null,
        latestCustomerAt: null,
        latestOutboundAt: null,
      },
    };
  }
  const customerWait = analyzeCustomerWaitState(actions, statusName);
  const dateOf = (a: HaloAction): number =>
    new Date(a.actiondatecreated ?? a.datetime ?? a.datecreated ?? 0).getTime();
  const sorted = [...actions].sort((a, b) => dateOf(b) - dateOf(a));
  let lastCommunication: string | null = null;
  for (const a of sorted) {
    const plain = stripHtml(String(a.note ?? ""));
    if (plain.length < 3) continue;
    if (TRIAGEIT_NOTE_RE.test(plain)) continue;
    const kind = a.hiddenfromuser ? "private" : "public";
    const who = a.who ? ` from ${String(a.who)}` : "";
    const rawWhen = a.actiondatecreated ?? a.datetime ?? a.datecreated;
    const whenStr = rawWhen
      ? ` on ${new Date(rawWhen).toLocaleDateString("en-US", { timeZone: "America/New_York", month: "long", day: "numeric" })}`
      : "";
    lastCommunication = `${kind} note${who}${whenStr}: "${plain.slice(0, 280)}"`;
    break;
  }
  return { lastCommunication, customerWait };
}

export async function runSlaCallRequests(): Promise<{ processed: number; called: number }> {
  const withinBusinessHours = isWithinBusinessHours();
  const supabase = createSupabaseClient();

  const { data: pendingRequests } = await supabase
    .from("sla_call_requests")
    .select("id, halo_id, phone, tech_name, objective, call_type, due_at, availability_detail, dedupe_key")
    .eq("status", "pending")
    .or(`due_at.is.null,due_at.lte.${new Date().toISOString()}`)
    .order("due_at", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true })
    .limit(25);
  const requests = (pendingRequests ?? [])
    .filter((request) =>
      withinBusinessHours ||
      parseSaturdaySupportObjective(request.objective as string | null) !== null,
    )
    .slice(0, 3);
  if (!withinBusinessHours && requests.length === 0) {
    console.log("[SLA-CALL] Standard outbound calls suppressed outside Mon–Fri business hours; no due Saturday verification calls");
  }
  if (!requests || requests.length === 0) return { processed: 0, called: 0 };

  const [{ data: tcxIntegration }, haloConfig] = await Promise.all([
    supabase.from("integrations").select("config").eq("service", "threecx").eq("is_active", true).maybeSingle(),
    getCachedHaloConfig(supabase),
  ]);
  if (!tcxIntegration || !haloConfig) {
    console.warn("[SLA-CALL] 3CX or Halo not configured — cannot place calls");
    return { processed: 0, called: 0 };
  }
  const cc = new CallControlClient(tcxIntegration.config as ThreeCxConfig);
  const tcx = new ThreeCxClient(tcxIntegration.config as ThreeCxConfig);
  const halo = new HaloClient(haloConfig);

  // Extension directory for name->extension dialing (user decision: ring
  // the tech's 3CX extension, matched by name)
  let extensions: ReadonlyArray<{ number: string; name: string }> = [];
  try {
    extensions = await tcx.listExtensions();
  } catch (error) {
    console.warn("[SLA-CALL] Could not list 3CX extensions:", error instanceof Error ? error.message : error);
  }
  const tokensOf = (s: string) => new Set(s.toLowerCase().split(/[^a-z]+/).filter((t) => t.length >= 3));
  const extensionFor = (techName: string | null): string | null => {
    if (!techName) return null;
    const want = tokensOf(techName);
    const hit = extensions.find((e) => {
      const have = tokensOf(e.name);
      let overlap = 0;
      for (const t of want) if (have.has(t)) overlap++;
      return overlap >= Math.min(2, want.size);
    });
    return hit?.number ?? null;
  };

  let called = 0;
  for (const req of requests) {
    const haloId = Number(req.halo_id);
    try {
      const storedObjective = (req.objective as string | null) ?? null;
      const saturdaySupport = parseSaturdaySupportObjective(storedObjective);

      // Saturday coverage checks are operational calls, not Halo ticket
      // escalations. Keep the entire path separate so halo_id=0 can never
      // create a fake ticket lookup or internal note.
      if (saturdaySupport) {
        const techName = saturdaySupport.kind === "manager_escalation"
          ? "Aniel Reyes"
          : saturdaySupport.technician;
        const destination = req.phone
          ? String(req.phone)
          : extensionFor(saturdaySupport.technician);

        if (!destination) {
          console.warn(
            `[SATURDAY-SUPPORT] No 3CX extension found for ${saturdaySupport.technician}; applying attempt ${saturdaySupport.attempt} fallback`,
          );
          await handleSaturdaySupportUnreachable(
            supabase,
            req.id as string,
            saturdaySupport,
            "no_destination",
          );
          continue;
        }

        const reportResult = async (confirmed: boolean, details: string) => {
          await handleSaturdaySupportResult(
            supabase,
            req.id as string,
            saturdaySupport,
            confirmed,
            details,
          );
        };
        const reportUnreachable = async (reason: SlaCallFailureReason) => {
          await handleSaturdaySupportUnreachable(
            supabase,
            req.id as string,
            saturdaySupport,
            reason,
          );
        };
        const cancelEscalation = registerEscalationCall(destination, {
          ticketId: null,
          haloId: 0,
          summary: "Saturday support duty verification",
          clientName: null,
          techName,
          hoursOver: null,
          objective: storedObjective,
          saturdaySupport,
          onSaturdaySupportResult: reportResult,
          onUnreachable: reportUnreachable,
          lastTechUpdate: null,
        }, () => {
          void reportUnreachable("no_answer").catch((error: unknown) => {
            console.error(
              `[SATURDAY-SUPPORT] No-answer fallback failed for ${techName}:`,
              error instanceof Error ? error.message : error,
            );
          });
        });

        const ok = await cc.makecall(ROUTE_POINT_DN, destination);
        if (!ok) {
          cancelEscalation();
          await reportUnreachable("dial_failed");
        } else {
          await supabase
            .from("sla_call_requests")
            .update({ status: "calling" })
            .eq("id", req.id);
          called++;
          console.log(
            `[SATURDAY-SUPPORT] Dialing ${techName} at ${destination} (${saturdaySupport.kind}, attempt ${saturdaySupport.attempt})`,
          );
        }
        continue;
      }

      let ticket: Record<string, unknown> | null = null;
      const { data } = await supabase
        .from("tickets")
        .select("id, halo_id, summary, client_name, user_name, user_email, halo_agent, last_tech_action_at, halo_is_open")
        .eq("halo_id", haloId)
        .maybeSingle();
      ticket = data as Record<string, unknown> | null;

      if (ticket?.halo_is_open === false) {
        await supabase.from("sla_call_requests").update({ status: "stale" }).eq("id", req.id);
        continue;
      }

      let hoursOver: number | null = null;
      let liveTechName: string | null = null;
      let liveTicket: Record<string, unknown> | null = null;
      try {
        const full = (await halo.getTicketWithSLA(haloId)) as unknown as Record<string, unknown>;
        liveTicket = full;
        const timeLeft =
          typeof full.fixtimeleft === "number" ? full.fixtimeleft
          : typeof full.slatimeleft === "number" ? (full.slatimeleft as number)
          : null;
        if (timeLeft != null && timeLeft < 0) hoursOver = Math.abs(timeLeft);
        // The CURRENT assignee straight from Halo — the local tickets row and
        // the queued request can both be stale after a reassignment.
        liveTechName = await halo.resolveAgentName(
          (full.agent_name as string | undefined) ?? null,
          typeof full.agent_id === "number" ? full.agent_id : null,
        );
      } catch {
        // call proceeds without the exact figure
      }

      const callType = String(req.call_type ?? (storedObjective ? "info" : "breach"));
      const preBreach = callType === "pre_breach";
      const dispatchFollowup = isDispatcherFollowupObjective(storedObjective);
      // ONE resolved name everywhere (greeting, note title, dialing). Dispatch
      // fallback rows must call Bryanna from the queued request, not the live
      // Halo assignee who was the unreachable technician.
      const techName =
        dispatchFollowup
          ? (req.tech_name as string | null) ?? DISPATCHER
          : liveTechName ?? (req.tech_name as string | null) ?? (ticket?.halo_agent as string | null) ?? null;
      const destination = req.phone ? String(req.phone) : extensionFor(techName);
      if (!destination) {
        console.warn(`[SLA-CALL] No phone/extension resolvable for #${haloId} (tech: ${techName ?? "?"}) — marking failed`);
        await supabase.from("sla_call_requests").update({ status: "failed" }).eq("id", req.id);
        if (!req.objective) {
          await queueDispatcherFollowupCall(supabase, { haloId, techName, reason: "no_destination", sourceCallType: preBreach ? "pre_breach" : "breach" });
        }
        continue;
      }
      const techLabel = techName ?? "the assigned tech";

      // How many times has TriageIt already called about this ticket?
      // Feeds the manager tone ("this is the third call about this ticket").
      const { count: priorCallCount } = await supabase
        .from("sla_call_requests")
        .select("id", { count: "exact", head: true })
        .eq("halo_id", haloId)
        .eq("status", "calling")
        .neq("id", req.id);

      const liveStatus = String(liveTicket?.status_name ?? liveTicket?.statusname ?? liveTicket?.status ?? "").trim() || null;
      const { lastCommunication, customerWait } = await fetchCommunicationContext(halo, haloId, liveStatus);
      const liveUser = liveTicket?.user as { emailaddress?: unknown } | undefined;
      const emailCandidate = liveTicket?.user_email ?? liveTicket?.user_emailaddress ?? liveUser?.emailaddress ?? ticket?.user_email ?? liveTicket?.emailtolist;
      const customerEmail = typeof emailCandidate === "string"
        ? emailCandidate.match(/[^\s<>,;@]+@[^\s<>,;@]+\.[^\s<>,;@]+/)?.[0] ?? null
        : null;
      const slaDueAt = typeof req.due_at === "string" ? req.due_at : null;
      const availabilityDetail = typeof req.availability_detail === "string" ? req.availability_detail : null;
      const proactiveUpdateReason = preBreach
        ? `Proactive SLA update requested because this ticket is nearing its deadline while ${techLabel} is unavailable${availabilityDetail ? ` (${availabilityDetail})` : ""}.`
        : null;
      const objective = storedObjective ? spokenDispatcherFollowupObjective(storedObjective) : null;
      const reportUnreachable = async (reason: SlaCallFailureReason) => {
        await supabase.from("sla_call_requests").update({ status: reason }).eq("id", req.id);
        if (!storedObjective) {
          await queueDispatcherFollowupCall(supabase, { haloId, techName, reason, sourceCallType: preBreach ? "pre_breach" : "breach" });
        }
      };
      const cancelEscalation = registerEscalationCall(destination, {
        ticketId: (ticket?.id as string | null) ?? null,
        haloId,
        summary: String(ticket?.summary ?? `ticket ${haloId}`).slice(0, 150),
        clientName: (ticket?.client_name as string) ?? null,
        techName,
        hoursOver,
        preBreach,
        slaDueAt,
        ownerAvailability: availabilityDetail,
        priorCalls: priorCallCount ?? 0,
        objective,
        dispatchFollowup,
        onUnreachable: storedObjective ? undefined : reportUnreachable,
        lastCommunication,
        customerWaitingForUpdate: preBreach || customerWait.waitingForUpdate,
        customerWaitingReason: proactiveUpdateReason ?? customerWait.reason,
        customerLastMessage: customerWait.latestCustomerMessage,
        customerContactMethod: customerWait.requestedContactMethod,
        customerName: (liveTicket?.user_name as string | null) ?? (ticket?.user_name as string | null) ?? null,
        customerEmail,
        lastTechUpdate: ticket?.last_tech_action_at
          ? new Date(ticket.last_tech_action_at as string).toLocaleString("en-US", { timeZone: "America/New_York", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" })
          : null,
      }, () => {
        void Promise.allSettled([
          halo.addInternalNote(
            haloId,
            buildEscalationCallNote({
              title: `Escalation call — ${techLabel}`,
              tone: "noanswer",
              meta: `Ticket #${haloId}`,
              intro: `TriageIt called ${techLabel} (${destination}) about this ticket${req.objective ? "" : preBreach ? " approaching its SLA deadline while the owner appeared unavailable" : "'s SLA breach"} and got no answer.${req.objective ? "" : " Dispatch follow-up was queued."}`,
            }),
          ),
          reportUnreachable("no_answer"),
        ]).then((results) => {
          for (const result of results) {
            if (result.status === "rejected") {
              console.error(`[SLA-CALL] No-answer follow-up failed for #${haloId}:`, result.reason instanceof Error ? result.reason.message : result.reason);
            }
          }
        });
      });

      const ok = await cc.makecall(ROUTE_POINT_DN, destination);
      if (!ok) cancelEscalation();
      await supabase
        .from("sla_call_requests")
        .update({ status: ok ? "calling" : "failed" })
        .eq("id", req.id);
      if (ok) {
        called++;
        console.log(`[SLA-CALL] Dialing ${destination} about #${haloId}${req.objective ? " (info request)" : preBreach ? " (pre-breach availability warning)" : " (SLA breach)"}`);
      } else if (!storedObjective) {
        await queueDispatcherFollowupCall(supabase, { haloId, techName, reason: "dial_failed", sourceCallType: preBreach ? "pre_breach" : "breach" });
      }
    } catch (error) {
      console.error(`[SLA-CALL] Request for #${haloId} failed:`, error instanceof Error ? error.message : error);
      await supabase.from("sla_call_requests").update({ status: "failed" }).eq("id", req.id);
    }
  }
  return { processed: requests.length, called };
}

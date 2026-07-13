import { createSupabaseClient } from "../db/supabase.js";
import { HaloClient } from "../integrations/halo/client.js";
import { getCachedHaloConfig } from "../integrations/get-config.js";
import { CallControlClient } from "../voice/call-control.js";
import { ThreeCxClient } from "../integrations/threecx/client.js";
import { isWithinBusinessHours } from "../integrations/teams/client.js";
import { registerEscalationCall } from "../voice/listener.js";
import { buildEscalationCallNote } from "../voice/escalation-note.js";
import { analyzeCustomerWaitState, type CustomerWaitState } from "../voice/customer-wait-state.js";
import type { HaloAction, ThreeCxConfig } from "@triageit/shared";

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
  if (!isWithinBusinessHours()) {
    console.log("[SLA-CALL] Outbound calls suppressed — outside business hours (8am–5:15pm ET, Mon–Fri)");
    return { processed: 0, called: 0 };
  }

  const supabase = createSupabaseClient();

  const { data: requests } = await supabase
    .from("sla_call_requests")
    .select("id, halo_id, phone, tech_name, objective")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(3);
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
      const { data: ticket } = await supabase
        .from("tickets")
        .select("id, halo_id, summary, client_name, user_name, user_email, halo_agent, last_tech_action_at")
        .eq("halo_id", haloId)
        .maybeSingle();

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
        // the queued request can both be stale after a reassignment (a call
        // greeted "Tony" on Matthew's ticket, user report 2026-07-10).
        liveTechName = await halo.resolveAgentName(
          (full.agent_name as string | undefined) ?? null,
          typeof full.agent_id === "number" ? full.agent_id : null,
        );
      } catch {
        // call proceeds without the exact figure
      }

      // ONE resolved name everywhere (greeting, note title, dialing):
      // live Halo assignee first, then the name captured at queue time,
      // then the local sync.
      const techName =
        liveTechName ?? (req.tech_name as string | null) ?? (ticket?.halo_agent as string | null) ?? null;
      const destination = req.phone ? String(req.phone) : extensionFor(techName);
      if (!destination) {
        console.warn(`[SLA-CALL] No phone/extension resolvable for #${haloId} (tech: ${techName ?? "?"}) — marking failed`);
        await supabase.from("sla_call_requests").update({ status: "failed" }).eq("id", req.id);
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
      registerEscalationCall(destination, {
        ticketId: (ticket?.id as string | null) ?? null,
        haloId,
        summary: String(ticket?.summary ?? `ticket ${haloId}`).slice(0, 150),
        clientName: (ticket?.client_name as string) ?? null,
        techName,
        hoursOver,
        priorCalls: priorCallCount ?? 0,
        objective: (req.objective as string) ?? null,
        lastCommunication,
        customerWaitingForUpdate: customerWait.waitingForUpdate,
        customerWaitingReason: customerWait.reason,
        customerLastMessage: customerWait.latestCustomerMessage,
        customerContactMethod: customerWait.requestedContactMethod,
        customerName: (liveTicket?.user_name as string | null) ?? (ticket?.user_name as string | null) ?? null,
        customerEmail,
        lastTechUpdate: ticket?.last_tech_action_at
          ? new Date(ticket.last_tech_action_at as string).toLocaleString("en-US", { timeZone: "America/New_York", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" })
          : null,
      }, () => {
        void halo
          .addInternalNote(
            haloId,
            buildEscalationCallNote({
              title: `Escalation call — ${techLabel}`,
              tone: "noanswer",
              meta: `Ticket #${haloId}`,
              intro: `TriageIt called ${techLabel} (${destination}) about this ticket${req.objective ? "" : "'s SLA breach"} and got no answer.${req.objective ? "" : " Breach alerts continue."}`,
            }),
          )
          .catch((e) => console.error(`[SLA-CALL] No-answer note failed for #${haloId}:`, e instanceof Error ? e.message : e));
      });

      const ok = await cc.makecall(ROUTE_POINT_DN, destination);
      await supabase
        .from("sla_call_requests")
        .update({ status: ok ? "calling" : "failed" })
        .eq("id", req.id);
      if (ok) {
        called++;
        console.log(`[SLA-CALL] Dialing ${destination} about #${haloId}${req.objective ? " (info request)" : " (SLA breach)"}`);
      }
    } catch (error) {
      console.error(`[SLA-CALL] Request for #${haloId} failed:`, error instanceof Error ? error.message : error);
      await supabase.from("sla_call_requests").update({ status: "failed" }).eq("id", req.id);
    }
  }
  return { processed: requests.length, called };
}

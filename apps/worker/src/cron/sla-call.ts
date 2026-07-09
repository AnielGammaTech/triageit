import { createSupabaseClient } from "../db/supabase.js";
import { HaloClient } from "../integrations/halo/client.js";
import { getCachedHaloConfig } from "../integrations/get-config.js";
import { CallControlClient } from "../voice/call-control.js";
import { ThreeCxClient } from "../integrations/threecx/client.js";
import { registerEscalationCall } from "../voice/listener.js";
import type { ThreeCxConfig } from "@triageit/shared";

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

export async function runSlaCallRequests(): Promise<{ processed: number; called: number }> {
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
        .select("halo_id, summary, client_name, halo_agent, last_tech_action_at")
        .eq("halo_id", haloId)
        .maybeSingle();

      let hoursOver: number | null = null;
      try {
        const full = (await halo.getTicketWithSLA(haloId)) as unknown as Record<string, unknown>;
        const timeLeft =
          typeof full.fixtimeleft === "number" ? full.fixtimeleft
          : typeof full.slatimeleft === "number" ? (full.slatimeleft as number)
          : null;
        if (timeLeft != null && timeLeft < 0) hoursOver = Math.abs(timeLeft);
      } catch {
        // call proceeds without the exact figure
      }

      const destination = req.phone ? String(req.phone) : extensionFor((req.tech_name as string) ?? (ticket?.halo_agent as string) ?? null);
      if (!destination) {
        console.warn(`[SLA-CALL] No phone/extension resolvable for #${haloId} (tech: ${req.tech_name ?? ticket?.halo_agent ?? "?"}) — marking failed`);
        await supabase.from("sla_call_requests").update({ status: "failed" }).eq("id", req.id);
        continue;
      }
      const techLabel = (req.tech_name as string) ?? (ticket?.halo_agent as string) ?? "the assigned tech";
      registerEscalationCall(destination, {
        haloId,
        summary: String(ticket?.summary ?? `ticket ${haloId}`).slice(0, 150),
        clientName: (ticket?.client_name as string) ?? null,
        techName: (ticket?.halo_agent as string) ?? null,
        hoursOver,
        objective: (req.objective as string) ?? null,
        lastTechUpdate: ticket?.last_tech_action_at
          ? new Date(ticket.last_tech_action_at as string).toLocaleString("en-US", { timeZone: "America/New_York", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" })
          : null,
      }, () => {
        void halo
          .addInternalNote(
            haloId,
            `<b>📞 Escalation call — NO ANSWER</b><br/>TriageIt called ${techLabel} (${destination}) about this ticket${req.objective ? "" : "'s SLA breach"} and got no answer. ${req.objective ? "" : "Breach alerts continue."}`,
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

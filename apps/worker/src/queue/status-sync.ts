import type { SupabaseClient } from "@supabase/supabase-js";
import type { HaloConfig } from "@triageit/shared";
import { HaloClient } from "../integrations/halo/client.js";

/**
 * Sync the latest Halo ticket status into our local tickets table.
 *
 * Called after triage completes so the dashboard shows the correct
 * Halo status (e.g. "Waiting on Tech") instead of stale "New".
 */
export async function syncTicketStatusFromHalo(
  supabase: SupabaseClient,
  ticketId: string,
  haloId: number,
): Promise<void> {
  try {
    const { data: integration } = await supabase
      .from("integrations")
      .select("config")
      .eq("service", "halo")
      .eq("is_active", true)
      .single();

    if (!integration) return;

    const halo = new HaloClient(integration.config as HaloConfig);
    const haloTicket = await halo.getTicket(haloId);

    // Extract status fields from the Halo ticket
    const statusName =
      (haloTicket as unknown as Record<string, unknown>).statusname ??
      (haloTicket as unknown as Record<string, unknown>).status_name ??
      haloTicket.status ??
      null;
    // Resolve agent name — prefer API field, then resolve ID via Halo API
    let agentName =
      ((haloTicket as unknown as Record<string, unknown>).agent_name as string | undefined) ?? null;
    if (!agentName && haloTicket.agent_id) {
      agentName = await halo.getAgentName(haloTicket.agent_id);
    }

    await supabase
      .from("tickets")
      .update({
        halo_status: statusName as string | null,
        halo_status_id: haloTicket.status_id ?? null,
        halo_team: (haloTicket.team as string) ?? null,
        halo_agent: agentName,
        updated_at: new Date().toISOString(),
      })
      .eq("id", ticketId);

    console.log(
      `[STATUS-SYNC] Synced Halo status for #${haloId}: ${statusName}`,
    );
  } catch (error) {
    // Non-fatal — status sync failure shouldn't block anything
    console.warn(
      `[STATUS-SYNC] Failed to sync status for #${haloId}:`,
      error,
    );
  }
}

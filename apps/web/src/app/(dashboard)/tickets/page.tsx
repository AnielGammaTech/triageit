import { createClient } from "@/lib/supabase/server";
import { TicketTabs } from "@/components/tickets/ticket-tabs";

export default async function TicketsPage() {
  const supabase = await createClient();

  // Fetch new tickets (initial triage) — tickets that came in via webhook
  const { data: newTickets } = await supabase
    .from("tickets")
    .select("*, triage_results(*)")
    .order("created_at", { ascending: false })
    .limit(50);

  // Fetch open tickets (for re-triage view) — tickets with halo_status tracking
  const { data: openTickets } = await supabase
    .from("tickets")
    .select("*, triage_results(*)")
    .not("halo_status", "is", null)
    .neq("halo_status", "Resolved")
    .order("last_retriage_at", { ascending: false, nullsFirst: false })
    .limit(100);

  return (
    <TicketTabs
      newTickets={newTickets ?? []}
      openTickets={openTickets ?? []}
    />
  );
}

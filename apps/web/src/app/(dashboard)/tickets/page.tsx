import { createClient } from "@/lib/supabase/server";
import { TicketList } from "@/components/tickets/ticket-list";

export default async function TicketsPage() {
  const supabase = await createClient();

  const { data: tickets, error } = await supabase
    .from("tickets")
    .select("*, triage_results(*)")
    .order("created_at", { ascending: false })
    .limit(50);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Tickets</h2>
        <p className="text-sm text-[var(--muted-foreground)]">
          {error ? "Unable to load tickets" : `${tickets?.length ?? 0} tickets`}
        </p>
      </div>
      <TicketList tickets={tickets ?? []} />
    </div>
  );
}

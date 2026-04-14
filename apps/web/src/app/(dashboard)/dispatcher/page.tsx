import { createClient } from "@/lib/supabase/server";
import { DispatcherDashboard } from "./dispatcher-dashboard";

export interface DispatcherReview {
  readonly id: string;
  readonly ticket_id: string;
  readonly halo_id: number | null;
  readonly dispatcher_name: string;
  readonly rating: "great" | "good" | "needs_improvement" | "poor";
  readonly assignment_time_minutes: number | null;
  readonly promise_kept: boolean | null;
  readonly promise_details: string | null;
  readonly unassigned_during_business_hours: boolean | null;
  readonly customer_reply_handled: boolean | null;
  readonly issues: ReadonlyArray<string> | null;
  readonly summary: string | null;
  readonly created_at: string;
  readonly ticket_halo_id: number | null;
  readonly ticket_summary: string | null;
  readonly ticket_client_name: string | null;
}

export default async function DispatcherPage() {
  const supabase = await createClient();

  const { data: rawReviews, error } = await supabase
    .from("dispatcher_reviews")
    .select(`
      id,
      ticket_id,
      halo_id,
      dispatcher_name,
      rating,
      assignment_time_minutes,
      promise_kept,
      promise_details,
      unassigned_during_business_hours,
      customer_reply_handled,
      issues,
      summary,
      created_at,
      tickets!inner (
        halo_id,
        summary,
        client_name
      )
    `)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    console.error("Failed to fetch dispatcher reviews:", error.message);
  }

  const reviews: ReadonlyArray<DispatcherReview> = (rawReviews ?? []).map(
    (row: Record<string, unknown>) => {
      const ticket = row.tickets as Record<string, unknown> | null;
      return {
        id: row.id as string,
        ticket_id: row.ticket_id as string,
        halo_id: row.halo_id as number | null,
        dispatcher_name: row.dispatcher_name as string,
        rating: row.rating as DispatcherReview["rating"],
        assignment_time_minutes: row.assignment_time_minutes as number | null,
        promise_kept: row.promise_kept as boolean | null,
        promise_details: row.promise_details as string | null,
        unassigned_during_business_hours: row.unassigned_during_business_hours as boolean | null,
        customer_reply_handled: row.customer_reply_handled as boolean | null,
        issues: row.issues as ReadonlyArray<string> | null,
        summary: row.summary as string | null,
        created_at: row.created_at as string,
        ticket_halo_id: ticket?.halo_id as number | null,
        ticket_summary: ticket?.summary as string | null,
        ticket_client_name: ticket?.client_name as string | null,
      };
    },
  );

  return <DispatcherDashboard reviews={reviews} />;
}

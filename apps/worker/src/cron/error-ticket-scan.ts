import { createSupabaseClient } from "../db/supabase.js";

/**
 * Scan for tickets stuck in "error" status for more than 1 hour.
 * Sends a Teams alert so the team knows something went wrong.
 */
export async function scanForErrorTickets(): Promise<{ readonly found: number; readonly alerted: number }> {
  const supabase = createSupabaseClient();

  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  const { data: errorTickets } = await supabase
    .from("tickets")
    .select("id, halo_id, summary, client_name, status, updated_at")
    .eq("status", "error")
    .lt("updated_at", oneHourAgo)
    .order("updated_at", { ascending: true });

  if (!errorTickets || errorTickets.length === 0) {
    return { found: 0, alerted: 0 };
  }

  console.log(`[ERROR-SCAN] Found ${errorTickets.length} tickets in error status > 1 hour`);

  // Send Teams alert
  const { data: teamsIntegration } = await supabase
    .from("integrations")
    .select("config")
    .eq("service", "teams")
    .eq("is_active", true)
    .single();

  if (!teamsIntegration) {
    console.log("[ERROR-SCAN] Teams not configured — skipping alert");
    return { found: errorTickets.length, alerted: 0 };
  }

  const ticketLines = errorTickets.map(
    (t) => `- **#${t.halo_id}** ${t.summary} (${t.client_name ?? "Unknown"}) — error since ${t.updated_at}`,
  ).join("\n");

  const card = {
    type: "message",
    attachments: [
      {
        contentType: "application/vnd.microsoft.card.adaptive",
        contentUrl: null,
        content: {
          $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
          type: "AdaptiveCard",
          version: "1.4",
          body: [
            {
              type: "TextBlock",
              text: `WARNING: ${errorTickets.length} ticket${errorTickets.length === 1 ? "" : "s"} stuck in error status`,
              weight: "Bolder",
              size: "Medium",
              color: "Attention",
            },
            {
              type: "TextBlock",
              text: ticketLines,
              wrap: true,
              size: "Small",
            },
            {
              type: "TextBlock",
              text: "These tickets failed triage and haven't been retried. Check worker logs for errors.",
              wrap: true,
              size: "Small",
              isSubtle: true,
            },
          ],
        },
      },
    ],
  };

  // Use the webhook directly — TeamsClient.sendCard is private,
  // so we POST to the webhook URL ourselves.
  const config = teamsIntegration.config as Record<string, unknown>;
  const response = await fetch(config.webhook_url as string, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(card),
  });

  if (!response.ok) {
    const text = await response.text();
    console.error(`[ERROR-SCAN] Teams webhook failed (${response.status}): ${text}`);
    return { found: errorTickets.length, alerted: 0 };
  }

  return { found: errorTickets.length, alerted: errorTickets.length };
}

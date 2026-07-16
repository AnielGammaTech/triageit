import type { HaloConfig } from "@triageit/shared";
import { createSupabaseClient } from "../db/supabase.js";
import { HaloClient } from "../integrations/halo/client.js";

const DIGEST_TICKET_TYPE_ID = 28;
const DEFAULT_REVIEW_USER_ID = 3675;
const MAX_ROWS_PER_DIGEST = 75;

interface AlertReviewRow {
  readonly id: string;
  readonly halo_id: number;
  readonly event_type: "alert_manager_auto_closed" | "alert_manager_kept_open" | "alert_manager_review_required" | "alert_manager_error";
  readonly note: string;
  readonly payload: {
    readonly ticket_summary?: string;
    readonly source?: string;
    readonly confidence?: number;
    readonly reason?: string;
    readonly pattern_key?: string;
    readonly [key: string]: unknown;
  };
  readonly created_at: string;
}

export interface AlertDigestResult {
  readonly reviewed: number;
  readonly digestTickets: ReadonlyArray<number>;
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function easternLabel(value: Date): string {
  return value.toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function patternSummary(rows: ReadonlyArray<AlertReviewRow>): ReadonlyArray<{ key: string; count: number }> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = String(row.payload.pattern_key ?? "unknown:unclassified");
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count);
}

function digestHtml(rows: ReadonlyArray<AlertReviewRow>, haloBaseUrl: string, periodStart: Date, periodEnd: Date): string {
  const patterns = patternSummary(rows);
  const decisionLabel: Record<AlertReviewRow["event_type"], string> = {
    alert_manager_auto_closed: "AUTO-CLOSED",
    alert_manager_kept_open: "KEPT OPEN",
    alert_manager_review_required: "REVIEW",
    alert_manager_error: "ERROR",
  };
  const decisionColor: Record<AlertReviewRow["event_type"], string> = {
    alert_manager_auto_closed: "#4ade80",
    alert_manager_kept_open: "#fbbf24",
    alert_manager_review_required: "#fb7185",
    alert_manager_error: "#f87171",
  };
  const ticketRows = rows.map((row) => {
    const url = `${haloBaseUrl.replace(/\/$/, "")}/tickets?id=${row.halo_id}`;
    const summary = String(row.payload.ticket_summary ?? "Alert");
    const source = String(row.payload.source ?? "Unknown");
    const reason = String(row.payload.reason ?? row.note);
    const confidence = Number(row.payload.confidence) || 0;
    const pattern = String(row.payload.pattern_key ?? "unknown:unclassified");
    return `<tr style="border-top:1px solid #3f3f46;"><td style="padding:8px;"><a href="${escapeHtml(url)}" style="color:#7dd3fc;font-weight:700;">#${row.halo_id}</a><br/><span style="color:#a1a1aa;font-size:11px;">${escapeHtml(source)}</span></td><td style="padding:8px;color:#e4e4e7;">${escapeHtml(summary)}<br/><span style="color:#a1a1aa;font-size:11px;">${escapeHtml(reason)}</span></td><td style="padding:8px;color:${decisionColor[row.event_type]};font-weight:700;white-space:nowrap;">${decisionLabel[row.event_type]}<br/><span style="font-size:11px;color:#a1a1aa;">${Math.round(confidence * 100)}%</span></td><td style="padding:8px;color:#a1a1aa;font-size:11px;">${escapeHtml(pattern)}</td></tr>`;
  }).join("");
  const patternRows = patterns.map((pattern) => `<li><strong>${pattern.count}x</strong> ${escapeHtml(pattern.key)}</li>`).join("");
  const closed = rows.filter((row) => row.event_type === "alert_manager_auto_closed").length;
  const open = rows.filter((row) => row.event_type === "alert_manager_kept_open").length;
  const review = rows.filter((row) => row.event_type === "alert_manager_review_required").length;
  return [
    `<div style="font-family:Segoe UI,Arial,sans-serif;max-width:1000px;">`,
    `<h2 style="margin:0 0 6px;color:#e4e4e7;">TriageIT Alerts Manager Review</h2>`,
    `<p style="color:#a1a1aa;">${escapeHtml(easternLabel(periodStart))} to ${escapeHtml(easternLabel(periodEnd))} Eastern</p>`,
    `<p><strong>${rows.length}</strong> reviewed &nbsp; <span style="color:#4ade80;"><strong>${closed}</strong> auto-closed</span> &nbsp; <span style="color:#fbbf24;"><strong>${open}</strong> kept open</span> &nbsp; <span style="color:#fb7185;"><strong>${review}</strong> need review</span></p>`,
    `<p style="padding:8px 10px;border-left:3px solid #7dd3fc;background:#172033;color:#d4d4d8;">Review every auto-closure below. Reopen the original alert if the decision was incorrect; the TriageIT audit remains intact.</p>`,
    `<h3>Patterns</h3><ul>${patternRows || "<li>No repeated pattern</li>"}</ul>`,
    `<table style="border-collapse:collapse;width:100%;background:#18181b;"><thead><tr style="text-align:left;color:#a1a1aa;"><th style="padding:8px;">Ticket</th><th style="padding:8px;">Alert and reason</th><th style="padding:8px;">Decision</th><th style="padding:8px;">Pattern</th></tr></thead><tbody>${ticketRows}</tbody></table>`,
    `</div>`,
  ].join("");
}

export async function generateAlertManagerDigest(): Promise<AlertDigestResult> {
  const supabase = createSupabaseClient();
  const { data: integration } = await supabase.from("integrations").select("config").eq("service", "halo").eq("is_active", true).maybeSingle();
  if (!integration?.config) throw new Error("Halo is not configured");
  const haloConfig = integration.config as HaloConfig;
  const halo = new HaloClient(haloConfig);
  const { data, error } = await supabase
    .from("workflow_events")
    .select("id, halo_id, event_type, note, payload, created_at")
    .in("event_type", ["alert_manager_auto_closed", "alert_manager_kept_open", "alert_manager_review_required", "alert_manager_error"])
    .order("created_at", { ascending: true })
    .limit(500);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as ReadonlyArray<AlertReviewRow>;
  if (rows.length === 0) return { reviewed: 0, digestTickets: [] };

  const digestTickets: number[] = [];
  for (let offset = 0; offset < rows.length; offset += MAX_ROWS_PER_DIGEST) {
    const chunk = rows.slice(offset, offset + MAX_ROWS_PER_DIGEST);
    const periodStart = new Date(chunk[0].created_at);
    const periodEnd = new Date(chunk[chunk.length - 1].created_at);
    try {
      const part = rows.length > MAX_ROWS_PER_DIGEST ? ` (${Math.floor(offset / MAX_ROWS_PER_DIGEST) + 1}/${Math.ceil(rows.length / MAX_ROWS_PER_DIGEST)})` : "";
      const haloTicketId = await halo.createTicket({
        summary: `TriageIT Alerts Manager Review - ${easternLabel(periodEnd)}${part}`,
        details: digestHtml(chunk, haloConfig.base_url, periodStart, periodEnd),
        userId: Number(process.env.ALERT_DIGEST_USER_ID) || DEFAULT_REVIEW_USER_ID,
        ticketTypeId: Number(process.env.ALERT_DIGEST_TICKET_TYPE_ID) || DIGEST_TICKET_TYPE_ID,
      });
      const updateResults = await Promise.all(chunk.map((row) => supabase.from("workflow_events").update({
        event_type: `${row.event_type}_digested`,
        payload: { ...row.payload, digest_halo_id: haloTicketId, digested_at: new Date().toISOString() },
      }).eq("id", row.id)));
      const updateFailure = updateResults.find((result) => result.error)?.error;
      if (updateFailure) {
        throw new Error(`Digest ticket #${haloTicketId} was created, but its audit rows could not be marked digested: ${updateFailure.message}`);
      }
      digestTickets.push(haloTicketId);
    } catch (digestFailure) {
      throw digestFailure;
    }
  }
  console.log(`[ALERT-DIGEST] Created ${digestTickets.length} Halo review ticket(s) for ${rows.length} alert decisions`);
  return { reviewed: rows.length, digestTickets };
}

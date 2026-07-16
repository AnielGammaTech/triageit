import type { HaloConfig } from "@triageit/shared";
import { createSupabaseClient } from "../db/supabase.js";
import { HaloClient } from "../integrations/halo/client.js";

const DIGEST_TICKET_TYPE_ID = 28;
const DEFAULT_REVIEW_USER_ID = 3675;
// Halo can become unreliable with hundreds of expandable rows in one ticket
// details field. Keep the readable sections bounded, but attach overflow as
// private notes to ONE parent ticket so each scheduled run creates one ticket.
const MAX_ROWS_PER_SECTION = 75;

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
    readonly affected_resource?: string | null;
    readonly [key: string]: unknown;
  };
  readonly created_at: string;
}

export interface AlertDigestResult {
  readonly reviewed: number;
  readonly digestTickets: ReadonlyArray<number>;
}

export function partitionAlertDigestRows<T>(rows: ReadonlyArray<T>): ReadonlyArray<ReadonlyArray<T>> {
  const sections: T[][] = [];
  for (let offset = 0; offset < rows.length; offset += MAX_ROWS_PER_SECTION) {
    sections.push(rows.slice(offset, offset + MAX_ROWS_PER_SECTION));
  }
  return sections;
}

async function retryHaloWrite(operation: () => Promise<unknown>, label: string): Promise<void> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await operation();
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 750));
    }
  }
  throw new Error(`${label} failed after 3 attempts: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
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

function renderAlertItem(row: AlertReviewRow, haloBaseUrl: string, color: string): string {
  const url = `${haloBaseUrl.replace(/\/$/, "")}/tickets?id=${row.halo_id}`;
  const summary = String(row.payload.ticket_summary ?? "Alert");
  const source = String(row.payload.source ?? "Unknown");
  const reason = String(row.payload.reason ?? row.note);
  const confidence = Math.round((Number(row.payload.confidence) || 0) * 100);
  const pattern = String(row.payload.pattern_key ?? "unknown:unclassified");
  const resource = row.payload.affected_resource ? String(row.payload.affected_resource) : null;
  return [
    `<details style="margin:0;border-top:1px solid #34343b;background:#18181b;">`,
    `<summary style="cursor:pointer;padding:12px 14px;color:#f4f4f5;line-height:1.35;">`,
    `<strong style="display:inline-block;min-width:72px;color:#7dd3fc;">#${row.halo_id}</strong>`,
    `<strong>${escapeHtml(summary)}</strong>`,
    `<span style="float:right;color:${color};font-size:11px;font-weight:700;">${confidence}%</span>`,
    `<br/><span style="display:inline-block;margin-left:72px;color:#a1a1aa;font-size:11px;">${escapeHtml(source)} &nbsp; | &nbsp; ${escapeHtml(pattern)}</span>`,
    `</summary>`,
    `<div style="margin:0 14px 14px 86px;padding:12px 14px;border-left:3px solid ${color};background:#111114;color:#d4d4d8;line-height:1.5;">`,
    `<div style="margin-bottom:8px;"><strong style="color:#f4f4f5;">Why:</strong> ${escapeHtml(reason)}</div>`,
    resource ? `<div style="margin-bottom:8px;"><strong style="color:#f4f4f5;">Affected:</strong> ${escapeHtml(resource)}</div>` : "",
    `<a href="${escapeHtml(url)}" style="display:inline-block;color:#7dd3fc;font-weight:700;text-decoration:none;">Open original Halo ticket &#8599;</a>`,
    `</div>`,
    `</details>`,
  ].join("");
}

function renderDecisionSection(
  rows: ReadonlyArray<AlertReviewRow>,
  haloBaseUrl: string,
  title: string,
  description: string,
  color: string,
): string {
  return [
    `<section style="margin:16px 0;border:1px solid #34343b;background:#18181b;">`,
    `<div style="padding:11px 14px;border-left:4px solid ${color};background:#202024;">`,
    `<strong style="color:${color};font-size:14px;">${escapeHtml(title)} <span style="color:#f4f4f5;">${rows.length}</span></strong>`,
    `<span style="display:block;margin-top:2px;color:#a1a1aa;font-size:11px;">${escapeHtml(description)}</span>`,
    `</div>`,
    rows.length > 0
      ? rows.map((row) => renderAlertItem(row, haloBaseUrl, color)).join("")
      : `<div style="padding:14px;color:#71717a;">No alerts in this section.</div>`,
    `</section>`,
  ].join("");
}

export function buildAlertDigestHtml(rows: ReadonlyArray<AlertReviewRow>, haloBaseUrl: string, periodStart: Date, periodEnd: Date): string {
  const patterns = patternSummary(rows);
  const closedRows = rows.filter((row) => row.event_type === "alert_manager_auto_closed");
  const openRows = rows.filter((row) => row.event_type === "alert_manager_kept_open");
  const reviewRows = rows.filter((row) => row.event_type === "alert_manager_review_required" || row.event_type === "alert_manager_error");
  const patternRows = patterns.map((pattern) => `<span style="display:inline-block;margin:3px 5px 3px 0;padding:5px 8px;border:1px solid #3f3f46;background:#202024;color:#d4d4d8;font-size:11px;"><strong style="color:#f4f4f5;">${pattern.count}x</strong> ${escapeHtml(pattern.key)}</span>`).join("");
  return [
    `<div style="font-family:Segoe UI,Arial,sans-serif;max-width:1100px;margin:0 auto;padding:18px;background:#0f0f12;color:#e4e4e7;">`,
    `<header style="padding:18px;border:1px solid #34343b;background:#18181b;">`,
    `<div style="color:#f4f4f5;font-size:20px;font-weight:700;">TriageIT Alerts Manager</div>`,
    `<div style="margin-top:4px;color:#a1a1aa;font-size:12px;">Review window: ${escapeHtml(easternLabel(periodStart))} to ${escapeHtml(easternLabel(periodEnd))} Eastern</div>`,
    `<div style="margin-top:14px;">`,
    `<span style="display:inline-block;margin:0 8px 6px 0;padding:8px 11px;border:1px solid #52525b;background:#202024;"><strong style="font-size:18px;color:#f4f4f5;">${rows.length}</strong><span style="display:block;color:#a1a1aa;font-size:10px;">REVIEWED</span></span>`,
    `<span style="display:inline-block;margin:0 8px 6px 0;padding:8px 11px;border:1px solid #7f1d1d;background:#2a1519;"><strong style="font-size:18px;color:#fb7185;">${reviewRows.length}</strong><span style="display:block;color:#fda4af;font-size:10px;">NEEDS REVIEW</span></span>`,
    `<span style="display:inline-block;margin:0 8px 6px 0;padding:8px 11px;border:1px solid #854d0e;background:#261c0d;"><strong style="font-size:18px;color:#fbbf24;">${openRows.length}</strong><span style="display:block;color:#fcd34d;font-size:10px;">KEPT OPEN</span></span>`,
    `<span style="display:inline-block;margin:0 8px 6px 0;padding:8px 11px;border:1px solid #166534;background:#102319;"><strong style="font-size:18px;color:#4ade80;">${closedRows.length}</strong><span style="display:block;color:#86efac;font-size:10px;">AUTO-CLOSED</span></span>`,
    `</div>`,
    `<div style="margin-top:10px;padding:9px 11px;border-left:3px solid #38bdf8;background:#172033;color:#d4d4d8;font-size:12px;">Open a row to inspect the exact reason. If an auto-closure was wrong, reopen the original ticket; the audit remains attached.</div>`,
    `</header>`,
    renderDecisionSection(reviewRows, haloBaseUrl, "Needs human review", "Ambiguous, security-related, communication, or processing exceptions. No automatic closure occurred.", "#fb7185"),
    renderDecisionSection(openRows, haloBaseUrl, "Actionable - kept open", "TriageIT found a service, backup, configuration, or delivery problem that still needs work.", "#fbbf24"),
    renderDecisionSection(closedRows, haloBaseUrl, "Auto-closed noise", "Only allowlisted informational or explicitly self-resolving patterns are shown here.", "#4ade80"),
    `<details style="margin-top:16px;border:1px solid #34343b;background:#18181b;">`,
    `<summary style="cursor:pointer;padding:12px 14px;color:#7dd3fc;font-weight:700;">Recurring patterns (${patterns.length})</summary>`,
    `<div style="padding:0 14px 14px;">${patternRows || "<span style=\"color:#71717a;\">No repeated pattern</span>"}</div>`,
    `</details>`,
    `</div>`,
  ].join("");
}

function buildParentDigestHtml(
  allRows: ReadonlyArray<AlertReviewRow>,
  firstSection: ReadonlyArray<AlertReviewRow>,
  haloBaseUrl: string,
  periodStart: Date,
  periodEnd: Date,
  sectionCount: number,
): string {
  const notice = sectionCount > 1
    ? `<div style="margin:0 auto 12px;max-width:1100px;padding:12px 14px;border:1px solid #0e7490;background:#10212b;color:#bae6fd;font-family:Segoe UI,Arial,sans-serif;"><strong>${allRows.length} total decisions in this review.</strong> Section 1 of ${sectionCount} is below; sections 2-${sectionCount} are attached as private notes on this same Halo ticket.</div>`
    : "";
  return `${notice}${buildAlertDigestHtml(firstSection, haloBaseUrl, periodStart, periodEnd)}`;
}

export async function refreshAlertManagerDigestTicket(haloTicketId: number): Promise<number> {
  const supabase = createSupabaseClient();
  const { data: integration } = await supabase.from("integrations").select("config").eq("service", "halo").eq("is_active", true).maybeSingle();
  if (!integration?.config) throw new Error("Halo is not configured");
  const { data, error } = await supabase
    .from("workflow_events")
    .select("id, halo_id, event_type, note, payload, created_at")
    .contains("payload", { digest_halo_id: haloTicketId })
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  const rows = (data ?? []).map((row) => ({
    ...row,
    event_type: String(row.event_type).replace(/_digested$/, ""),
  })) as ReadonlyArray<AlertReviewRow>;
  if (rows.length === 0) throw new Error(`No audit rows found for digest #${haloTicketId}`);
  const haloConfig = integration.config as HaloConfig;
  const halo = new HaloClient(haloConfig);
  await halo.updateTicketDetails(
    haloTicketId,
    buildAlertDigestHtml(rows, haloConfig.base_url, new Date(rows[0].created_at), new Date(rows[rows.length - 1].created_at)),
  );
  return rows.length;
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

  const sections = partitionAlertDigestRows(rows);
  const periodStart = new Date(rows[0].created_at);
  const periodEnd = new Date(rows[rows.length - 1].created_at);
  const haloTicketId = await halo.createTicket({
    summary: `TriageIT Alerts Manager Review - ${easternLabel(periodEnd)}`,
    details: buildParentDigestHtml(rows, sections[0], haloConfig.base_url, periodStart, periodEnd, sections.length),
    userId: Number(process.env.ALERT_DIGEST_USER_ID) || DEFAULT_REVIEW_USER_ID,
    ticketTypeId: Number(process.env.ALERT_DIGEST_TICKET_TYPE_ID) || DIGEST_TICKET_TYPE_ID,
  });

  // Overflow stays on the parent ticket as private notes. Retrying the Halo
  // writes keeps a transient API failure from turning the next run into a
  // second parent ticket for the same batch.
  for (let index = 1; index < sections.length; index += 1) {
    const section = sections[index];
    const sectionStart = new Date(section[0].created_at);
    const sectionEnd = new Date(section[section.length - 1].created_at);
    const note = [
      `<div style="padding:10px 12px;border-left:4px solid #38bdf8;background:#172033;color:#bae6fd;"><strong>Alerts Manager review section ${index + 1} of ${sections.length}</strong><br/>${section.length} decisions from ${escapeHtml(easternLabel(sectionStart))} to ${escapeHtml(easternLabel(sectionEnd))} Eastern</div>`,
      buildAlertDigestHtml(section, haloConfig.base_url, sectionStart, sectionEnd),
    ].join("");
    await retryHaloWrite(() => halo.addInternalNote(haloTicketId, note), `Attaching digest section ${index + 1}/${sections.length}`);
  }

  const digestedAt = new Date().toISOString();
  for (const section of sections) {
    const updateResults = await Promise.all(section.map((row) => supabase.from("workflow_events").update({
      event_type: `${row.event_type}_digested`,
      payload: { ...row.payload, digest_halo_id: haloTicketId, digested_at: digestedAt },
    }).eq("id", row.id)));
    const updateFailure = updateResults.find((result) => result.error)?.error;
    if (updateFailure) {
      throw new Error(`Digest ticket #${haloTicketId} was created, but its audit rows could not be marked digested: ${updateFailure.message}`);
    }
  }

  console.log(`[ALERT-DIGEST] Created Halo review ticket #${haloTicketId} with ${sections.length} section(s) for ${rows.length} alert decisions`);
  return { reviewed: rows.length, digestTickets: [haloTicketId] };
}

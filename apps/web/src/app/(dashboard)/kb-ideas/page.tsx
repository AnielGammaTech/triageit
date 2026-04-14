import { createClient } from "@/lib/supabase/server";
import { KbIdeasBrowser } from "./kb-ideas-browser";

// ── Types ────────────────────────────────────────────────────────────

export interface KbIdeaEntry {
  readonly title: string;
  readonly category: string;
  readonly content: string;
  readonly hudu_section: string;
  readonly why: string;
  readonly needs_info: ReadonlyArray<string>;
  readonly confidence: string;
  readonly ticketHaloId: number;
  readonly ticketSummary: string;
  readonly clientName: string;
  readonly triageDate: string;
}

interface TicketInfo {
  readonly halo_id: number;
  readonly summary: string;
  readonly client_name: string | null;
}

interface TriageResultRow {
  readonly findings: Record<string, unknown> | null;
  readonly created_at: string;
  readonly tickets: TicketInfo | ReadonlyArray<TicketInfo> | null;
}

interface RawKbIdea {
  readonly title?: string;
  readonly category?: string;
  readonly content?: string;
  readonly hudu_section?: string;
  readonly why?: string;
  readonly needs_info?: ReadonlyArray<string>;
  readonly confidence?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────

function resolveTicket(tickets: TriageResultRow["tickets"]): TicketInfo | null {
  if (!tickets) return null;
  // Supabase may return a single object or an array depending on the relationship
  if (Array.isArray(tickets)) return (tickets as ReadonlyArray<TicketInfo>)[0] ?? null;
  return tickets as TicketInfo;
}

function extractKbIdeas(row: TriageResultRow): ReadonlyArray<KbIdeaEntry> {
  const findings = row.findings;
  if (!findings) return [];

  const rawIdeas = findings.kb_ideas;
  if (!Array.isArray(rawIdeas) || rawIdeas.length === 0) return [];

  const ticket = resolveTicket(row.tickets);
  if (!ticket) return [];

  return rawIdeas
    .filter((idea: RawKbIdea) => idea && typeof idea.title === "string")
    .map((idea: RawKbIdea): KbIdeaEntry => ({
      title: idea.title ?? "Untitled",
      category: idea.category ?? "article",
      content: idea.content ?? "",
      hudu_section: idea.hudu_section ?? "",
      why: idea.why ?? "",
      needs_info: Array.isArray(idea.needs_info) ? idea.needs_info : [],
      confidence: idea.confidence ?? "medium",
      ticketHaloId: ticket.halo_id,
      ticketSummary: ticket.summary,
      clientName: ticket.client_name ?? "Unknown",
      triageDate: row.created_at,
    }));
}

// ── Page ─────────────────────────────────────────────────────────────

export default async function KbIdeasPage() {
  const supabase = await createClient();

  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

  const { data: triageResults, error } = await supabase
    .from("triage_results")
    .select("findings, created_at, tickets(halo_id, summary, client_name)")
    .not("findings", "is", null)
    .gte("created_at", ninetyDaysAgo)
    .order("created_at", { ascending: false })
    .limit(500);

  if (error) {
    console.error("[KB-IDEAS] Failed to fetch triage results:", error.message);
  }

  const rows = (triageResults ?? []) as unknown as ReadonlyArray<TriageResultRow>;
  const allIdeas = rows.flatMap(extractKbIdeas);

  return <KbIdeasBrowser ideas={allIdeas} />;
}

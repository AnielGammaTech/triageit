import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseLlmJson } from "../parse-json.js";
import { HaloClient, type TicketImage } from "../../integrations/halo/client.js";
import type { HaloConfig } from "@triageit/shared";

// ── Types ────────────────────────────────────────────────────────────

interface HuduKbDraft {
  readonly title: string;
  readonly category: "procedure" | "troubleshooting" | "environment" | "contact" | "network" | "password" | "general";
  readonly content: string;
  readonly hudu_section: string;
}

interface CloseReviewResult {
  readonly resolution_summary: string;
  readonly tech_performance: {
    readonly rating: "great" | "good" | "needs_improvement" | "poor";
    readonly response_time: string;
    readonly communication: string;
    readonly highlights: string | null;
    readonly issues: string | null;
  };
  readonly documentation_action: {
    readonly hudu_updates_needed: ReadonlyArray<string>;
    readonly quality_score: 1 | 2 | 3 | 4 | 5;
    readonly notes: string;
  };
  readonly hudu_kb_drafts: ReadonlyArray<HuduKbDraft>;
  readonly onsite_visits: ReadonlyArray<string>;
  readonly ticket_lifecycle: {
    readonly total_time: string;
    readonly first_response_time: string;
    readonly resolution_method: string;
  };
}

// ── Close Review Generator ───────────────────────────────────────────

const CLOSE_REVIEW_PROMPT = `You are reviewing a RESOLVED IT support ticket for an MSP (Gamma Tech Services LLC).
Analyze the full ticket lifecycle and produce a close-out review.

## What you're reviewing:
- How the tech handled the ticket from open to close
- Whether documentation needs updating in Hudu (the IT documentation platform)
- A brief factual summary of what happened and how it was resolved
- What KB articles, procedures, or environment docs should be created/updated in Hudu based on what was learned

## Rules:
- ALL times must be in Eastern Time (ET). Never use UTC. Convert any timestamps to ET before displaying.
- Be factual — only state what the ticket history shows
- Hudu updates should ONLY be permanent environment documentation: network configs, device inventories, passwords, procedures, contact info, DNS records. NOT ticket-specific details.
- Rate the tech honestly — great/good/needs_improvement/poor
- If there were onsite visits, note them
- Keep everything concise
- For hudu_kb_drafts: Draft READY-TO-PASTE content for Hudu. Each draft should be a complete article/section the admin can copy directly into Hudu. ONLY draft if the ticket revealed MEANINGFUL permanent knowledge — specific configs, non-obvious procedures, vendor contacts, network details, workarounds for known bugs, etc. Do NOT draft articles for trivial/obvious things like "how to restart a computer", "how to reset a password in M365 admin", "how to check email on Outlook" — only document things a tech wouldn't already know. Return an EMPTY array if nothing is worth documenting. Categories: procedure (step-by-step fix), troubleshooting (diagnosis guide), environment (infra/config details), contact (vendor contacts discovered), network (network/DNS/firewall configs), password (credential notes — NO actual passwords, just what exists and where), general (other).

## Output JSON:
{
  "resolution_summary": "<2-3 sentence summary of the issue and how it was resolved>",
  "tech_performance": {
    "rating": "<great|good|needs_improvement|poor>",
    "response_time": "<fast|adequate|slow|no_response — based on first reply after customer opened ticket>",
    "communication": "<brief assessment of tech's communication with customer>",
    "highlights": "<what the tech did well, or null>",
    "issues": "<what could have been better, or null>"
  },
  "documentation_action": {
    "hudu_updates_needed": ["<list of permanent client environment docs to add/update in Hudu — empty if none>"],
    "quality_score": <1-5 — how well-documented is this client's environment based on what we saw>,
    "notes": "<brief note on documentation state>"
  },
  "hudu_kb_drafts": [
    {
      "title": "<KB article title, e.g. 'Fix Outlook Autodiscover for Contoso M365'>",
      "category": "<procedure|troubleshooting|environment|contact|network|password|general>",
      "content": "<Full ready-to-paste content in plain text with clear sections. Use markdown-style formatting (## headers, - bullets, numbered steps). Should be complete enough to paste directly into Hudu.>",
      "hudu_section": "<Which Hudu section/asset this belongs in, e.g. 'Procedures', 'Network', 'Passwords', 'Client Overview'>"
    }
  ],
  "onsite_visits": ["<list of onsite visits mentioned, or empty array>"],
  "ticket_lifecycle": {
    "total_time": "<time from open to close, e.g. '2 days 4 hours'>",
    "first_response_time": "<time to first tech response, e.g. '45 minutes'>",
    "resolution_method": "<remote|onsite|vendor|automated|escalated>"
  }
}`;

// In-memory lock to prevent concurrent close reviews for the same ticket
const activeReviews = new Set<number>();

export async function generateCloseReview(
  haloId: number,
  supabase: SupabaseClient,
): Promise<{ review: CloseReviewResult; noteHtml: string }> {
  // In-memory lock — prevents concurrent reviews from multiple webhook events
  if (activeReviews.has(haloId)) {
    console.log(`[CLOSE-REVIEW] Skipping #${haloId} — already in progress`);
    throw new Error(`Close review already in progress for #${haloId}`);
  }
  activeReviews.add(haloId);

  try {
    return await _generateCloseReview(haloId, supabase);
  } finally {
    activeReviews.delete(haloId);
  }
}

async function _generateCloseReview(
  haloId: number,
  supabase: SupabaseClient,
): Promise<{ review: CloseReviewResult; noteHtml: string }> {
  // Fetch ticket from local DB
  const { data: ticket } = await supabase
    .from("tickets")
    .select("*, triage_results(classification, urgency_score, internal_notes, findings, created_at)")
    .eq("halo_id", haloId)
    .single();

  if (!ticket) throw new Error(`Ticket #${haloId} not found`);

  // Skip alerts — they don't need close reviews
  if (ticket.tickettype_id && ticket.tickettype_id !== 31) {
    console.log(`[CLOSE-REVIEW] Skipping #${haloId} — not Gamma Default (type ${ticket.tickettype_id})`);
    throw new Error(`Ticket #${haloId} is not Gamma Default — skipping close review`);
  }

  // Dedup: skip if we already have a close review for this ticket in the last hour
  const { data: existingReview } = await supabase
    .from("close_reviews")
    .select("id")
    .eq("halo_id", haloId)
    .gte("created_at", new Date(Date.now() - 60 * 60 * 1000).toISOString())
    .limit(1)
    .maybeSingle();

  if (existingReview) {
    console.log(`[CLOSE-REVIEW] Skipping duplicate for #${haloId} — already reviewed in the last hour`);
    throw new Error(`Close review already exists for #${haloId}`);
  }

  // Fetch Halo config for live actions
  const { data: haloIntegration } = await supabase
    .from("integrations")
    .select("config")
    .eq("service", "halo")
    .eq("is_active", true)
    .single();

  if (!haloIntegration) throw new Error("Halo PSA not configured");

  const haloConfig = haloIntegration.config as HaloConfig;
  const halo = new HaloClient(haloConfig);

  // Pull all ticket actions from Halo
  const rawActions = await halo.getTicketActions(haloId);
  const actions = rawActions
    .filter((a) => {
      const note = (a.note ?? "").toLowerCase();
      return !note.includes("triageit") && !note.includes("ai triage");
    })
    .map((a) => ({
      who: a.who ?? "Unknown",
      date: a.actiondatecreated ?? a.datetime ?? a.datecreated ?? "Unknown",
      note: (a.note ?? "").slice(0, 800),
      isInternal: a.hiddenfromuser,
      outcome: a.outcome ?? null,
    }));

  // Pull images from ticket actions (screenshots, configs, etc.)
  const [actionImages, inlineImages] = await Promise.all([
    halo.getTicketImages(haloId, rawActions),
    halo.extractInlineImages(rawActions),
  ]);
  const allImages: ReadonlyArray<TicketImage> = [...actionImages, ...inlineImages].slice(0, 5);

  // Check for existing tech review
  const { data: techReview } = await supabase
    .from("tech_reviews")
    .select("rating, response_time, summary, improvement_areas, strengths")
    .eq("halo_id", haloId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Build context for the LLM
  const triageResults = (ticket.triage_results as ReadonlyArray<Record<string, unknown>>) ?? [];
  const latestTriage = triageResults[0];

  const context = [
    `## Ticket #${haloId}`,
    `Summary: ${ticket.summary}`,
    `Client: ${ticket.client_name ?? "Unknown"}`,
    `Tech: ${ticket.halo_agent ?? "Unassigned"}`,
    `Status: ${ticket.halo_status ?? "Unknown"}`,
    `Created: ${ticket.created_at}`,
    ticket.details ? `Details: ${ticket.details.slice(0, 1500)}` : "",
    "",
    latestTriage ? `## AI Triage Classification` : "",
    latestTriage ? `Type: ${JSON.stringify((latestTriage.classification as Record<string, string>))}` : "",
    latestTriage ? `Urgency: ${latestTriage.urgency_score}/5` : "",
    latestTriage ? `Notes: ${String(latestTriage.internal_notes ?? "").slice(0, 1000)}` : "",
    "",
    techReview ? `## Existing Tech Review` : "",
    techReview ? `Rating: ${techReview.rating} | Response: ${techReview.response_time}` : "",
    techReview ? `Summary: ${techReview.summary}` : "",
    techReview?.strengths ? `Strengths: ${techReview.strengths}` : "",
    techReview?.improvement_areas ? `Areas to improve: ${techReview.improvement_areas}` : "",
    "",
    `## Ticket Actions (${actions.length} total):`,
    ...actions.map((a) => {
      const vis = a.isInternal ? "[INTERNAL]" : "[VISIBLE]";
      return `- ${vis} ${a.who} (${a.date}): ${a.note}`;
    }),
  ].filter(Boolean).join("\n");

  // Call LLM — include images if available for richer KB drafts
  const anthropic = new Anthropic();
  const userContent: Anthropic.MessageCreateParams["messages"][0]["content"] = allImages.length > 0
    ? [
        { type: "text" as const, text: `${CLOSE_REVIEW_PROMPT}\n\n${context}` },
        ...allImages.map((img) => ({
          type: "image" as const,
          source: {
            type: "base64" as const,
            media_type: img.mediaType,
            data: img.base64Data,
          },
        })),
        { type: "text" as const, text: `\n\nThe above ${allImages.length} image(s) are from the ticket's internal notes/attachments. Use them to extract specific details for KB drafts (configs, error messages, network diagrams, screenshots of settings, etc).` },
      ]
    : `${CLOSE_REVIEW_PROMPT}\n\n${context}`;

  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 3000,
    messages: [
      { role: "user", content: userContent },
    ],
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  const review = parseLlmJson<CloseReviewResult>(text);

  // Build Halo note HTML
  const noteHtml = buildCloseReviewNote(review, ticket.halo_agent ?? "Unknown Tech", haloId);

  // Post to Halo
  await halo.addInternalNote(haloId, noteHtml);

  // Store in DB
  await supabase.from("close_reviews").insert({
    ticket_id: ticket.id,
    halo_id: haloId,
    tech_name: ticket.halo_agent,
    review_data: review,
  });

  // Close review posted as internal note. No status changes, no reassignment.
  // The ticket stays resolved, the tech stays assigned, the customer doesn't see anything.
  console.log(`[CLOSE-REVIEW] #${haloId} reviewed — rating: ${review.tech_performance.rating}, doc quality: ${review.documentation_action.quality_score}/5`);

  return { review, noteHtml };
}

// ── HTML Note Builder ────────────────────────────────────────────────

function buildCloseReviewNote(
  review: CloseReviewResult,
  techName: string,
  haloId: number,
): string {
  const ratingConfig: Record<string, { emoji: string; color: string; bg: string }> = {
    great: { emoji: "🟢", color: "#4ade80", bg: "#052e16" },
    good: { emoji: "🔵", color: "#60a5fa", bg: "#172554" },
    needs_improvement: { emoji: "🟡", color: "#fbbf24", bg: "#422006" },
    poor: { emoji: "🔴", color: "#f87171", bg: "#450a0a" },
  };
  const rc = ratingConfig[review.tech_performance.rating] ?? ratingConfig.good;
  const border = "border-bottom:1px solid #3a3f4b;";
  const lbl = "padding:8px 14px;font-weight:600;width:120px;font-size:13px;";
  const val = "padding:8px 14px;font-size:14px;color:#e2e8f0;line-height:1.5;";
  const rows: string[] = [];

  // Header
  rows.push(
    `<tr><td colspan="2" style="padding:12px 14px;background:linear-gradient(135deg,#065f46,#059669);color:white;font-size:15px;font-weight:700;">` +
    `📋 Close Review — Ticket #${haloId}</td></tr>`,
  );

  // Resolution summary
  rows.push(
    `<tr style="background:#252830;"><td style="${lbl}${border}color:#94a3b8;">Summary</td>` +
    `<td style="${val}${border}">${review.resolution_summary}</td></tr>`,
  );

  // Lifecycle
  rows.push(
    `<tr style="background:#1a2332;"><td style="${lbl}${border}color:#60a5fa;">Lifecycle</td>` +
    `<td style="${val}${border}color:#bfdbfe;">` +
    `Total: <strong>${review.ticket_lifecycle.total_time}</strong> · First response: <strong>${review.ticket_lifecycle.first_response_time}</strong> · Method: <strong>${review.ticket_lifecycle.resolution_method}</strong></td></tr>`,
  );

  // Tech performance
  rows.push(
    `<tr style="background:${rc.bg};"><td style="${lbl}${border}color:${rc.color};">${rc.emoji} ${techName}</td>` +
    `<td style="${val}${border}">` +
    `<strong style="color:${rc.color};font-size:15px;">${review.tech_performance.rating.replace("_", " ").toUpperCase()}</strong> · ` +
    `Response: ${review.tech_performance.response_time} · ${review.tech_performance.communication}` +
    `${review.tech_performance.highlights ? `<br/>✅ ${review.tech_performance.highlights}` : ""}` +
    `${review.tech_performance.issues ? `<br/>⚠️ ${review.tech_performance.issues}` : ""}` +
    `</td></tr>`,
  );

  // Onsite visits
  if (review.onsite_visits.length > 0) {
    rows.push(
      `<tr style="background:#252830;"><td style="${lbl}${border}color:#a78bfa;">🚗 Onsite</td>` +
      `<td style="${val}${border}">${review.onsite_visits.join("<br/>")}</td></tr>`,
    );
  }

  // Documentation
  const docColor = review.documentation_action.quality_score >= 4 ? "#4ade80" : review.documentation_action.quality_score >= 3 ? "#fbbf24" : "#f87171";
  const huduUpdates = review.documentation_action.hudu_updates_needed;
  rows.push(
    `<tr style="background:#1a2332;"><td style="${lbl}${border}color:${docColor};">📝 Docs</td>` +
    `<td style="${val}${border}">` +
    `Quality: <strong style="color:${docColor};font-size:15px;">${review.documentation_action.quality_score}/5</strong> · ${review.documentation_action.notes}` +
    `${huduUpdates.length > 0 ? `<br/><strong>Update Hudu:</strong> ${huduUpdates.join(", ")}` : ""}` +
    `</td></tr>`,
  );

  // Footer
  rows.push(
    `<tr style="background:#1E2028;"><td colspan="2" style="padding:4px 14px;color:#64748b;font-size:10px;text-align:right;">` +
    `TriageIt AI · close review</td></tr>`,
  );

  return (
    `<table style="font-family:'Segoe UI',Roboto,Arial,sans-serif;width:100%;max-width:100%;border-collapse:collapse;` +
    `font-size:12px;color:#e2e8f0;border:1px solid #059669;background:#1E2028;border-radius:6px;overflow:hidden;">` +
    `${rows.join("")}</table>`
  );
}

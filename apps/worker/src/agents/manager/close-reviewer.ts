import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requestLlmJson } from "../llm-json.js";
import { HaloClient, type TicketImage } from "../../integrations/halo/client.js";
import { MemoryManager } from "../../memory/memory-manager.js";
import { TeamsClient } from "../../integrations/teams/client.js";
import { hasConfirmedGammaOnsiteEvidence } from "./onsite-evidence.js";
import type { TeamsConfig } from "@triageit/shared";
import type { HaloConfig } from "@triageit/shared";
import {
  calibrateCloseReview,
  type CloseReviewResult,
} from "./close-review-calibration.js";

// ── Types ────────────────────────────────────────────────────────────

// ── Close Review Generator ───────────────────────────────────────────

const CLOSE_REVIEW_PROMPT = `You are reviewing a RESOLVED IT support ticket for an MSP (Gamma Tech Services LLC).
Analyze the full ticket lifecycle and produce a close-out review.

## What you're reviewing:
- How the tech handled the ticket from open to close
- Whether this ticket's close-out note is complete and whether durable client documentation truly needs updating in Hudu
- A brief factual summary of what happened and how it was resolved
- What KB articles, procedures, or environment docs should be created/updated in Hudu based on what was learned

## Rules:
- ALL times must be in Eastern Time (ET). Never use UTC. Convert any timestamps to ET before displaying.
- Be factual — only state what the ticket history shows
- Score documentation based ONLY on whether the TICKET records the issue, action taken, and outcome. Never use one ticket to grade the completeness of the client's entire Hudu environment.
- Documentation score: 5 = issue/action/outcome/customer confirmation are clear; 4 = issue/action/outcome are clear and confirmation is absent or unnecessary; 3 = outcome is known but steps are vague; 2 = partial work with unclear outcome; 1 = no usable resolution record.
- A concise note is sufficient for a simple task. A routine password reset, account unlock, or MFA reset with the action and resolved outcome documented should normally score 4 or 5.
- Hudu updates should ONLY be permanent environment documentation: network configs, device inventories, shared credentials, non-obvious procedures, lasting contacts, DNS records, or standing client policies. NOT ticket-specific details.
- Do NOT request a Hudu user/contact/inventory update merely because an existing user had a password reset, account unlock, or MFA reset.
- Hudu suggestions are optional documentation opportunities and MUST NOT lower the tech rating or ticket-documentation score.
- Missing a separate customer confirmation after an action that directly completed the request may be a follow-up suggestion, but MUST NOT by itself lower a resolved ticket below GOOD.
- Do not contradict an existing tech review unless the close-out actions reveal new material evidence such as an unresolved outcome, customer frustration, an unsafe action, or a major response failure.
- Rate the tech honestly — great/good/needs_improvement/poor
- ONSITE DETECTION IS CRITICAL (unbilled onsite = lost revenue), but it must be high confidence: only report a Gamma staff onsite visit when a note authored by Gamma staff explicitly confirms that Gamma performed work at the client location. Customer, user, or vendor personnel checking/resetting equipment is NOT a Gamma onsite visit. A Scheduled status or appointment proves intent only, not that the visit occurred. For each confirmed Gamma onsite visit, include the staff-authored EVIDENCE QUOTE in onsite_visits. Otherwise return an empty array.
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
  },
  "client_policy": "<STANDING client-specific handling rule this ticket ESTABLISHED — approval chains ('all work needs a PO from X first'), contact-first requirements, billing rules, scheduled-access windows. One clear sentence stating the rule and who it comes from. null unless the ticket explicitly sets a lasting rule for how this client must be handled — a one-off request is NOT a policy>"
  ,"review_basis": {
    "evidence_reviewed": ["<brief list of the actual evidence used>"],
    "rating_drivers": ["<facts that materially affected the rating>"],
    "not_counted_against_rating": ["<optional suggestions or unavailable evidence that did not lower the grade>"]
  }
}`;

// In-memory lock to prevent concurrent close reviews for the same ticket
const activeReviews = new Set<number>();

/**
 * Compact good/bad tech recap posted on the ticket at CLOSE — the full review
 * lives in the dashboard Review tab; Halo just gets this quick summary (user).
 */
function buildTechRecapNote(
  tech: string,
  rating: string,
  strengths: string | null,
  improvement: string | null,
  responseTime: string | null,
): string {
  const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const firstSentence = (t: string) => {
    const s = t.trim();
    const m = s.match(/^([\s\S]+?[.!?])\s/);
    const first = m ? m[1] : s;
    return first.length > 220 ? first.slice(0, 217) + "…" : first;
  };
  const ratingMap: Record<string, { label: string; color: string }> = {
    great: { label: "GREAT", color: "#10b981" },
    good: { label: "GOOD", color: "#3b82f6" },
    needs_improvement: { label: "NEEDS IMPROVEMENT", color: "#f59e0b" },
    poor: { label: "POOR", color: "#dc2626" },
  };
  const r = ratingMap[rating.toLowerCase()] ?? { label: (rating || "review").toUpperCase(), color: "#94a3b8" };
  const rows: string[] = [];
  if (strengths) rows.push(`<div style="margin-top:6px;color:#bbf7d0;"><span style="color:#4ade80;font-weight:700;">&#10003; Good — </span>${esc(firstSentence(strengths))}</div>`);
  if (improvement) rows.push(`<div style="margin-top:6px;color:#fde68a;"><span style="color:#fbbf24;font-weight:700;">&#10007; Improve — </span>${esc(firstSentence(improvement))}</div>`);
  return [
    `<table style="font-family:'Segoe UI',Roboto,Arial,sans-serif;width:100%;max-width:640px;border-collapse:collapse;background:#151013;border:1px solid #3a1f24;border-radius:8px;overflow:hidden;">`,
    `<tr><td style="padding:8px 12px;background:#1a1114;color:#e2e8f0;font-size:12.5px;font-weight:700;">Tech Recap — ${esc(tech)}<span style="float:right;font-size:10px;font-weight:700;background:${r.color};color:#0a0505;padding:2px 8px;border-radius:10px;letter-spacing:0.03em;">${r.label}</span></td></tr>`,
    `<tr><td style="padding:8px 12px;font-size:12.5px;line-height:1.5;">${rows.join("")}${responseTime ? `<div style="margin-top:6px;color:#94a3b8;font-size:11px;">Response: ${esc(responseTime)}</div>` : ""}</td></tr>`,
    `</table>`,
  ].join("");
}

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

  const { value: parsedReview } = await requestLlmJson<Partial<CloseReviewResult>>(anthropic, {
    model: "claude-haiku-4-5-20251001",
    max_tokens: 3000,
    messages: [
      { role: "user", content: userContent },
    ],
  }, `Close review for #${haloId}`, 6_000);
  const normalizedReview: CloseReviewResult = {
    resolution_summary: parsedReview.resolution_summary ?? "The ticket was closed without a complete AI resolution summary.",
    tech_performance: {
      rating: parsedReview.tech_performance?.rating ?? "needs_improvement",
      response_time: parsedReview.tech_performance?.response_time ?? "not available",
      communication: parsedReview.tech_performance?.communication ?? "Communication evidence was incomplete.",
      highlights: parsedReview.tech_performance?.highlights ?? null,
      issues: parsedReview.tech_performance?.issues ?? null,
    },
    documentation_action: {
      hudu_updates_needed: Array.isArray(parsedReview.documentation_action?.hudu_updates_needed)
        ? parsedReview.documentation_action.hudu_updates_needed
        : [],
      quality_score: parsedReview.documentation_action?.quality_score ?? 3,
      notes: parsedReview.documentation_action?.notes ?? "No documentation assessment was returned.",
    },
    hudu_kb_drafts: Array.isArray(parsedReview.hudu_kb_drafts) ? parsedReview.hudu_kb_drafts : [],
    onsite_visits: Array.isArray(parsedReview.onsite_visits) ? parsedReview.onsite_visits : [],
    ticket_lifecycle: {
      total_time: parsedReview.ticket_lifecycle?.total_time ?? "not available",
      first_response_time: parsedReview.ticket_lifecycle?.first_response_time ?? "not available",
      resolution_method: parsedReview.ticket_lifecycle?.resolution_method ?? "not available",
    },
    client_policy: parsedReview.client_policy ?? null,
    review_basis: {
      evidence_reviewed: Array.isArray(parsedReview.review_basis?.evidence_reviewed)
        ? parsedReview.review_basis.evidence_reviewed
        : [],
      rating_drivers: Array.isArray(parsedReview.review_basis?.rating_drivers)
        ? parsedReview.review_basis.rating_drivers
        : [],
      not_counted_against_rating: Array.isArray(parsedReview.review_basis?.not_counted_against_rating)
        ? parsedReview.review_basis.not_counted_against_rating
        : [],
    },
  };
  const confirmedOnsite = hasConfirmedGammaOnsiteEvidence(actions);
  const onsiteCalibratedReview: CloseReviewResult = confirmedOnsite
    ? normalizedReview
    : { ...normalizedReview, onsite_visits: [] };
  if (normalizedReview.onsite_visits.length > 0 && !confirmedOnsite) {
    console.warn(`[CLOSE-REVIEW] #${haloId} ignored unverified onsite evidence — no Gamma staff action confirmed a visit`);
  }
  const review = calibrateCloseReview({
    review: onsiteCalibratedReview,
    actions,
    ticketSummary: String(ticket.summary ?? ""),
    ticketDetails: ticket.details ? String(ticket.details) : null,
    priorTechRating: techReview?.rating ? String(techReview.rating) : null,
    imageCount: allImages.length,
  });

  // Build Halo note HTML
  const noteHtml = buildCloseReviewNote(review, ticket.halo_agent ?? "Unknown Tech", haloId);

  // Post to Halo
  await halo.addInternalNote(haloId, noteHtml);

  // Short good/bad tech recap at close (full review is dashboard-only).
  if (techReview && (techReview.strengths || techReview.improvement_areas)) {
    try {
      await halo.addInternalNote(
        haloId,
        buildTechRecapNote(
          ticket.halo_agent ?? "Unassigned",
          String(techReview.rating ?? ""),
          techReview.strengths ? String(techReview.strengths) : null,
          techReview.improvement_areas ? String(techReview.improvement_areas) : null,
          techReview.response_time ? String(techReview.response_time) : null,
        ),
      );
    } catch (error) {
      console.error(`[CLOSE-REVIEW] Failed to post tech recap for #${haloId}:`, error);
    }
  }

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

  // UNBILLED ONSITE TRIPWIRE (user request 2026-07-09): onsite evidence
  // with zero charged hours = the visit never hit billing. Flag it loudly.
  if (review.onsite_visits.length > 0) {
    try {
      const billing = await halo.getBillingState(haloId);
      if (billing.chargedHours <= 0) {
        await halo.addInternalNote(
          haloId,
          `<b style="color:#f87171;">🔴 ONSITE VISIT DETECTED — NO BILLABLE TIME CHARGED</b><br/>` +
            `This ticket shows onsite work but has 0 charged hours (no Onsite Support charge type logged).<br/>` +
            `Evidence: ${review.onsite_visits.map((v) => String(v).slice(0, 150)).join(" · ")}<br/>` +
            `<b>Action needed:</b> add the Onsite Support time entry before this slips through billing.`,
        );
        const { data: teamsIntegration } = await supabase
          .from("integrations").select("config").eq("service", "teams").eq("is_active", true).maybeSingle();
        if (teamsIntegration?.config) {
          const teams = new TeamsClient(teamsIntegration.config as TeamsConfig);
          await teams.sendUnbilledOnsiteAlert({
            haloId,
            summary: String(ticket.summary ?? "").slice(0, 100),
            clientName: ticket.client_name ?? null,
            techName: ticket.halo_agent ?? null,
            evidence: review.onsite_visits.map((v) => String(v)).join(" · ").slice(0, 300),
          });
        }
        console.log(`[CLOSE-REVIEW] #${haloId} UNBILLED ONSITE flagged (${review.onsite_visits.length} indications, 0 charged hours)`);
      }
    } catch (error) {
      console.error(`[CLOSE-REVIEW] Onsite billing check failed for #${haloId}:`, error instanceof Error ? error.message : error);
    }
  }

  // LEARN from the closing (user request 2026-07-09): every resolved ticket
  // becomes a resolution memory for Michael, embedded for similarity recall —
  // the next similar ticket's triage surfaces "we solved this before by X".
  // Failures never block the review itself.
  try {
    const classification = latestTriage?.classification as Record<string, string> | undefined;
    const memoryManager = new MemoryManager(supabase);
    const contentLines = [
      `RESOLVED ticket #${haloId} — "${String(ticket.summary ?? "").slice(0, 150)}" (${ticket.client_name ?? "unknown client"}${classification ? `, ${classification.type ?? ""}/${classification.subtype ?? ""}` : ""}).`,
      `Issue & fix: ${review.resolution_summary}`,
      `Resolution method: ${review.ticket_lifecycle.resolution_method} | total time: ${review.ticket_lifecycle.total_time} | tech: ${ticket.halo_agent ?? "unassigned"}.`,
      review.onsite_visits.length > 0 ? `Required onsite: ${review.onsite_visits.join("; ")}` : "",
    ].filter(Boolean);
    await memoryManager.createMemory({
      agent_name: "michael_scott",
      ticket_id: ticket.id as string,
      content: contentLines.join("\n"),
      summary: `How #${haloId} (${String(ticket.summary ?? "").slice(0, 60)}) was resolved`,
      memory_type: "resolution",
      confidence: 0.9,
      metadata: {
        client_name: ticket.client_name ?? null,
        halo_id: haloId,
        classification_type: classification?.type ?? null,
        resolution_method: review.ticket_lifecycle.resolution_method,
        tech: ticket.halo_agent ?? null,
        source: "close_review",
      },
    });
    console.log(`[CLOSE-REVIEW] #${haloId} resolution memory stored for Michael`);

    // Ticket established a standing client rule → policy memory, surfaced
    // on EVERY future ticket for this client (⚠ Client Policy note row)
    if (review.client_policy && ticket.client_name) {
      await memoryManager.createMemory({
        agent_name: "michael_scott",
        ticket_id: ticket.id as string,
        content: `${ticket.client_name} handling policy (from #${haloId}): ${review.client_policy}`,
        summary: `Client policy — ${ticket.client_name}`,
        memory_type: "insight",
        confidence: 0.95,
        metadata: {
          policy: "true",
          client_name: ticket.client_name,
          halo_id: haloId,
          source: "close_review",
        },
      });
      console.log(`[CLOSE-REVIEW] #${haloId} CLIENT POLICY stored for ${ticket.client_name}: ${review.client_policy.slice(0, 100)}`);
    }
  } catch (error) {
    console.error(`[CLOSE-REVIEW] Failed to store resolution memory for #${haloId}:`, error instanceof Error ? error.message : error);
  }

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

  // Ticket documentation + optional durable Hudu follow-up
  const docColor = review.documentation_action.quality_score >= 4 ? "#4ade80" : review.documentation_action.quality_score >= 3 ? "#fbbf24" : "#f87171";
  const huduUpdates = review.documentation_action.hudu_updates_needed;
  rows.push(
    `<tr style="background:#1a2332;"><td style="${lbl}${border}color:${docColor};">📝 Ticket notes</td>` +
    `<td style="${val}${border}">` +
    `Quality: <strong style="color:${docColor};font-size:15px;">${review.documentation_action.quality_score}/5</strong> · ${review.documentation_action.notes}` +
    `${huduUpdates.length > 0 ? `<br/><strong>Optional Hudu opportunity (not scored):</strong> ${huduUpdates.join(", ")}` : ""}` +
    `</td></tr>`,
  );

  const basis = review.review_basis;
  const basisSections = [
    basis.evidence_reviewed.length > 0
      ? `<div><strong style="color:#93c5fd;">Evidence reviewed:</strong> ${basis.evidence_reviewed.join(" · ")}</div>`
      : "",
    basis.rating_drivers.length > 0
      ? `<div style="margin-top:5px;"><strong style="color:#86efac;">Counted in the grade:</strong> ${basis.rating_drivers.join(" · ")}</div>`
      : "",
    basis.not_counted_against_rating.length > 0
      ? `<div style="margin-top:5px;"><strong style="color:#fde68a;">Not counted against the grade:</strong> ${basis.not_counted_against_rating.join(" · ")}</div>`
      : "",
  ].filter(Boolean).join("");
  if (basisSections) {
    rows.push(
      `<tr style="background:#1E2028;"><td colspan="2" style="padding:0;${border}">` +
      `<details><summary style="cursor:pointer;padding:7px 14px;color:#94a3b8;font-size:11.5px;font-weight:600;">How TriageIT graded this review</summary>` +
      `<div style="padding:8px 14px;border-top:1px solid #3a3f4b;color:#cbd5e1;font-size:11.5px;line-height:1.5;">${basisSections}</div></details>` +
      `</td></tr>`,
    );
  }

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

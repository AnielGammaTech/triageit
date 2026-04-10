import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseLlmJson } from "../parse-json.js";
import { HaloClient, type TicketImage } from "../../integrations/halo/client.js";
import { HuduClient } from "../../integrations/hudu/client.js";
import type { HaloConfig, HuduConfig } from "@triageit/shared";

// ── Types ────────────────────────────────────────────────────────────

export interface KbIdea {
  readonly title: string;
  readonly category: "article" | "procedure" | "vendor" | "asset" | "password_note" | "network" | "environment";
  readonly content: string;
  readonly hudu_section: string;
  readonly why: string;
  readonly needs_info: ReadonlyArray<string>;
  readonly confidence: "high" | "medium" | "low";
}

interface KbIdeasResult {
  readonly ideas: ReadonlyArray<KbIdea>;
  readonly questions: ReadonlyArray<string>;
}

// ── Prompt ────────────────────────────────────────────────────────────

const KB_IDEAS_PROMPT = `You are a documentation specialist for Gamma Tech Services LLC, an MSP in Naples, FL.
You use Hudu as the IT documentation platform. Your job: analyze a resolved/in-progress ticket and suggest what PERMANENT knowledge should be documented in Hudu.

## What to suggest:
- **article**: KB articles — troubleshooting guides, how-to docs, environment overviews
- **procedure**: Step-by-step procedures for recurring tasks discovered in this ticket
- **vendor**: New vendor/partner contacts discovered (support numbers, account reps, portal URLs)
- **asset**: New devices, servers, or infrastructure discovered that should be tracked
- **password_note**: Credential locations or access notes discovered (NEVER include actual passwords — just note what exists)
- **network**: Network configs, DNS records, firewall rules, IP allocations discovered
- **environment**: Client environment details — software versions, license info, architecture notes

## Rules:
- ONLY suggest things that are genuinely new information NOT already in the client's Hudu documentation (I'll provide existing docs for reference)
- Be SPECIFIC — "Update network docs" is useless. "Add VLAN 10 (192.168.10.0/24) to network diagram for [Client]" is useful.
- Skip trivial/obvious things (how to restart a computer, how to reset an M365 password)
- If a ticket references a vendor the client doesn't have documented, suggest creating a vendor entry
- If you need more information to create a good KB article, list specific questions in "needs_info"
- Set confidence: high = clear info in ticket, medium = info is partial, low = inferred/guessed
- For each idea, include "content" as ready-to-paste Hudu content (markdown format, complete enough to paste directly)
- Return an EMPTY ideas array if nothing is worth documenting — don't force it

## Output JSON:
{
  "ideas": [
    {
      "title": "<descriptive title>",
      "category": "<article|procedure|vendor|asset|password_note|network|environment>",
      "content": "<full ready-to-paste content in markdown>",
      "hudu_section": "<where in Hudu this belongs>",
      "why": "<1 sentence: why this should be documented>",
      "needs_info": ["<specific questions if more info would improve the article, empty array if complete>"],
      "confidence": "<high|medium|low>"
    }
  ],
  "questions": ["<global questions about the client environment that would help generate better docs, empty if none>"]
}`;

// ── Generator ────────────────────────────────────────────────────────

export async function generateKbIdeas(
  haloId: number,
  supabase: SupabaseClient,
): Promise<KbIdeasResult> {
  // Fetch ticket
  const { data: ticket } = await supabase
    .from("tickets")
    .select("*, triage_results(classification, urgency_score, internal_notes, findings, created_at)")
    .eq("halo_id", haloId)
    .single();

  if (!ticket) throw new Error(`Ticket #${haloId} not found`);

  // Fetch integrations
  const { data: integrations } = await supabase
    .from("integrations")
    .select("service, config, is_active")
    .in("service", ["halo", "hudu"])
    .eq("is_active", true);

  const haloConfig = integrations?.find((i) => i.service === "halo")?.config as HaloConfig | undefined;
  const huduConfig = integrations?.find((i) => i.service === "hudu")?.config as HuduConfig | undefined;

  if (!haloConfig) throw new Error("Halo PSA not configured");

  const halo = new HaloClient(haloConfig);

  // Pull Halo actions + images
  const rawActions = await halo.getTicketActions(haloId);
  const actions = rawActions
    .filter((a) => {
      const note = (a.note ?? "").toLowerCase();
      return !note.includes("triageit") && !note.includes("ai triage");
    })
    .map((a) => ({
      who: a.who ?? "Unknown",
      date: a.actiondatecreated ?? a.datetime ?? a.datecreated ?? "Unknown",
      note: (a.note ?? "").slice(0, 1000),
      isInternal: a.hiddenfromuser,
    }));

  const [actionImages, inlineImages] = await Promise.all([
    halo.getTicketImages(haloId, rawActions),
    halo.extractInlineImages(rawActions),
  ]);
  const allImages: ReadonlyArray<TicketImage> = [...actionImages, ...inlineImages].slice(0, 5);

  // Pull existing Hudu docs for this client (so we don't suggest duplicates)
  let existingHuduContext = "No Hudu integration configured — cannot check existing docs.";
  if (huduConfig) {
    const hudu = new HuduClient(huduConfig);
    try {
      const companies = await hudu.searchCompanies(ticket.client_name ?? "");
      const companyId = companies[0]?.id;

      if (companyId) {
        const [articles, assets, passwords] = await Promise.all([
          hudu.getArticles({ company_id: companyId, page_size: 50 }),
          hudu.getAssets({ company_id: companyId, page_size: 50 }),
          hudu.getPasswords({ company_id: companyId }),
        ]);

        existingHuduContext = [
          `## Existing Hudu Docs for ${ticket.client_name}`,
          `Articles (${articles.length}): ${articles.map((a) => a.name).join(", ") || "none"}`,
          `Assets (${assets.length}): ${assets.map((a) => a.name).join(", ") || "none"}`,
          `Passwords (${passwords.length}): ${passwords.map((p) => p.name).join(", ") || "none"}`,
        ].join("\n");
      } else {
        existingHuduContext = `No Hudu company match found for "${ticket.client_name}".`;
      }
    } catch {
      existingHuduContext = "Failed to fetch Hudu docs — suggest based on ticket info only.";
    }
  }

  // Build context
  const triageResults = (ticket.triage_results as ReadonlyArray<Record<string, unknown>>) ?? [];
  const latestTriage = triageResults[0];

  const context = [
    `## Ticket #${haloId}`,
    `Summary: ${ticket.summary}`,
    `Client: ${ticket.client_name ?? "Unknown"}`,
    `Tech: ${ticket.halo_agent ?? "Unassigned"}`,
    `Status: ${ticket.halo_status ?? "Unknown"}`,
    ticket.details ? `Details: ${ticket.details.slice(0, 2000)}` : "",
    "",
    latestTriage ? `## AI Triage` : "",
    latestTriage ? `Type: ${JSON.stringify(latestTriage.classification)}` : "",
    latestTriage ? `Notes: ${String(latestTriage.internal_notes ?? "").slice(0, 1000)}` : "",
    latestTriage?.findings ? `Findings: ${JSON.stringify(latestTriage.findings).slice(0, 2000)}` : "",
    "",
    existingHuduContext,
    "",
    `## Ticket Actions (${actions.length} total):`,
    ...actions.map((a) => {
      const vis = a.isInternal ? "[INTERNAL]" : "[VISIBLE]";
      return `- ${vis} ${a.who} (${a.date}): ${a.note}`;
    }),
  ].filter(Boolean).join("\n");

  // Call LLM with images if available
  const anthropic = new Anthropic();
  const userContent: Anthropic.MessageCreateParams["messages"][0]["content"] = allImages.length > 0
    ? [
        { type: "text" as const, text: `${KB_IDEAS_PROMPT}\n\n${context}` },
        ...allImages.map((img) => ({
          type: "image" as const,
          source: {
            type: "base64" as const,
            media_type: img.mediaType,
            data: img.base64Data,
          },
        })),
        { type: "text" as const, text: `\nThe above ${allImages.length} image(s) are from the ticket's internal notes. Extract specific details (configs, screenshots, error messages, vendor portals, network diagrams) for KB articles.` },
      ]
    : `${KB_IDEAS_PROMPT}\n\n${context}`;

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

  try {
    return parseLlmJson<KbIdeasResult>(text);
  } catch (err) {
    console.error(`[KB-IDEAS] JSON parse failed for #${haloId}:`, (err as Error).message, "Raw:", text.slice(0, 500));
    // Return empty result instead of crashing
    return { ideas: [], questions: [] };
  }
}

// ── Refine a single KB idea with tech's answers ──────────────────────

const REFINE_PROMPT = `You are Dwight Schrute, documentation specialist for Gamma Tech Services LLC.
A technician has selected a KB idea to turn into a full Hudu article. They may have answered clarifying questions.

Take the draft content, the tech's answers, and the ticket context to produce a POLISHED, COMPLETE KB article ready to paste into Hudu.

## Rules:
- Use clear markdown formatting: ## headers, numbered steps, bullet lists, code blocks for commands/configs
- Be specific and actionable — a tech reading this should be able to follow it without guessing
- Include any details from the tech's answers
- If the tech skipped questions, work with what you have and note "[NEEDS VERIFICATION]" for uncertain details
- Keep it professional but practical — MSP techs are your audience
- Include a "Last Updated" line at the bottom with today's date

Respond with ONLY valid JSON:
{
  "title": "<final article title>",
  "content": "<complete markdown article>",
  "hudu_section": "<where in Hudu this belongs>",
  "summary": "<1 sentence description for the Halo note>"
}`;

export interface RefinedArticle {
  readonly title: string;
  readonly content: string;
  readonly hudu_section: string;
  readonly summary: string;
}

export async function refineKbArticle(
  haloId: number,
  idea: {
    readonly title: string;
    readonly category: string;
    readonly content: string;
    readonly hudu_section: string;
    readonly needs_info: ReadonlyArray<string>;
  },
  answers: Record<string, string>,
  supabase: SupabaseClient,
): Promise<RefinedArticle> {
  // Get ticket context
  const { data: ticket } = await supabase
    .from("tickets")
    .select("summary, client_name, halo_agent, details")
    .eq("halo_id", haloId)
    .single();

  const answersText = Object.entries(answers)
    .filter(([, v]) => v.trim())
    .map(([q, a]) => `Q: ${q}\nA: ${a}`)
    .join("\n\n");

  const context = [
    `## Ticket #${haloId}`,
    `Client: ${ticket?.client_name ?? "Unknown"}`,
    `Summary: ${ticket?.summary ?? "Unknown"}`,
    "",
    `## KB Idea to Refine`,
    `Title: ${idea.title}`,
    `Category: ${idea.category}`,
    `Hudu Section: ${idea.hudu_section}`,
    `Draft Content:\n${idea.content}`,
    "",
    answersText ? `## Tech's Answers to Clarifying Questions\n${answersText}` : "## No additional answers provided",
  ].join("\n");

  const anthropic = new Anthropic();
  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 4000,
    messages: [
      { role: "user", content: `${REFINE_PROMPT}\n\n${context}` },
    ],
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  try {
    return parseLlmJson<RefinedArticle>(text);
  } catch (err) {
    console.error(`[KB-REFINE] JSON parse failed for #${haloId}:`, (err as Error).message);
    // Extract content as plain text fallback — the article is in there, just malformed JSON
    const titleMatch = text.match(/"title"\s*:\s*"([^"]+)"/);
    const sectionMatch = text.match(/"hudu_section"\s*:\s*"([^"]+)"/);
    // Get the content between "content": " and the next key
    const contentStart = text.indexOf('"content"');
    let content = idea.content;
    if (contentStart !== -1) {
      const valueStart = text.indexOf('"', contentStart + 10) + 1;
      // Find the closing by looking for the pattern ", "hudu_section" or ", "summary"
      const nextKey = text.indexOf('", "', valueStart);
      if (nextKey !== -1) {
        content = text.slice(valueStart, nextKey).replace(/\\n/g, "\n").replace(/\\"/g, '"');
      }
    }
    return {
      title: titleMatch?.[1] ?? idea.title,
      content,
      hudu_section: sectionMatch?.[1] ?? idea.hudu_section,
      summary: `KB article for ${idea.title}`,
    };
  }
}

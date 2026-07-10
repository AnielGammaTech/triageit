import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { HELPDESK_TECHNICIANS, isInternalStaffName, isSlaTargetBreached, isSlaTimerBreached, type Ticket, type AgentFinding } from "@triageit/shared";
import type { TriageContext, TriageOutput } from "../types.js";
import { classifyTicket } from "../workers/ryan-howard.js";
import { parseLlmJson } from "../parse-json.js";
import { extractResponseText } from "../llm-text.js";
import { HaloClient, collectTicketDocuments } from "../../integrations/halo/client.js";
import type { HaloConfig, TeamsConfig } from "@triageit/shared";
import { TeamsClient } from "../../integrations/teams/client.js";
import {
  createAgent,
  getAgentsForClassification,
} from "../registry.js";
import { findSimilarTickets, storeTicketEmbedding } from "../similar-tickets.js";
import { detectDuplicates } from "../duplicate-detector.js";
import { selectManagerModel } from "../model-router.js";
import { logCacheUsage } from "../cache-metrics.js";
import type { SimilarTicket } from "../similar-tickets.js";
import type { DuplicateCandidate } from "../duplicate-detector.js";

// Extracted modules
import {
  AGENT_LABELS,
  buildHaloNote,
  buildCompactRetriageNote,
  buildAccountabilityNote,
  type BrandingConfig,
} from "./halo-note-builder.js";
import { describeTicketImages, stripHtmlActions } from "./image-processor.js";
import { checkReviewEligibility, generateTechReview } from "./tech-reviewer.js";
import { checkDispatcherReviewEligibility, generateDispatcherReview } from "./dispatcher-reviewer.js";
import { MICHAEL_SYSTEM_PROMPT } from "./prompts.js";
import { getVendorStatusForType, formatVendorStatus } from "../../integrations/vendor-status/client.js";
import { tryNotificationFastPath, tryAlertFastPath } from "./fast-paths.js";
import { MemoryManager } from "../../memory/memory-manager.js";
import {
  extractRememberTags,
  stripRememberTags,
  REMEMBER_INSTRUCTIONS,
} from "../../memory/memory-extractor.js";
import type { MemoryMatch } from "@triageit/shared";
import { getFeedbackContext } from "./feedback-stats.js";

// ── Helpers ──────────────────────────────────────────────────────────

async function getHaloConfig(
  supabase: SupabaseClient,
): Promise<HaloConfig | null> {
  const { data } = await supabase
    .from("integrations")
    .select("config")
    .eq("service", "halo")
    .eq("is_active", true)
    .single();

  return data ? (data.config as HaloConfig) : null;
}

async function getBrandingConfig(
  supabase: SupabaseClient,
): Promise<BrandingConfig | undefined> {
  const { data } = await supabase
    .from("integrations")
    .select("config")
    .eq("service", "branding")
    .single();

  if (!data) return undefined;
  const config = data.config as { logo_url?: string | null; name?: string | null };
  return {
    logoUrl: config.logo_url ?? undefined,
    name: config.name ?? undefined,
  };
}

async function getTeamsConfig(
  supabase: SupabaseClient,
): Promise<TeamsConfig | null> {
  const { data } = await supabase
    .from("integrations")
    .select("config")
    .eq("service", "teams")
    .eq("is_active", true)
    .single();

  return data ? (data.config as TeamsConfig) : null;
}

function buildTriageContext(ticket: Ticket): TriageContext {
  return {
    ticketId: ticket.id,
    haloId: ticket.halo_id,
    summary: ticket.summary,
    details: ticket.details,
    clientName: ticket.client_name,
    clientId: ticket.client_id,
    userName: ticket.user_name,
    userEmail: ticket.user_email,
    originalPriority: ticket.original_priority,
  };
}

async function logThinking(
  supabase: SupabaseClient,
  ticketId: string,
  agentName: string,
  agentRole: string,
  thought: string,
): Promise<void> {
  await supabase.from("agent_logs").insert({
    ticket_id: ticketId,
    agent_name: agentName,
    agent_role: agentRole,
    status: "thinking",
    output_summary: thought,
  });
}

// ── Main Triage Pipeline ─────────────────────────────────────────────

export async function runTriage(
  ticket: Ticket,
  supabase: SupabaseClient,
): Promise<TriageOutput> {
  const startTime = Date.now();
  let context = buildTriageContext(ticket);

  // ── Pre-step: Fetch Halo ticket actions (history/comments) ─────────

  const haloConfigEarly = await getHaloConfig(supabase);
  if (haloConfigEarly) {
    try {
      const haloEarly = new HaloClient(haloConfigEarly);
      const rawActions = await haloEarly.getTicketActions(ticket.halo_id);
      // Filter out TriageIt's own messages — we only care about tech and customer actions
      const filteredActions = rawActions.filter((a) => {
        const note = (a.note ?? "").toLowerCase();
        return !note.includes("triageit") && !note.includes("ai triage") && !note.includes("triagetit ai");
      });

      const formattedActions = filteredActions.map((a) => ({
        note: stripHtmlActions(a.note),
        who: a.who ?? null,
        outcome: a.outcome ?? null,
        date: a.actiondatecreated ?? a.datetime ?? a.datecreated ?? null,
        isInternal: a.hiddenfromuser,
      }));

      // Determine assigned tech from the Halo ticket's assigned agent field
      // (NOT from who left comments — that could be automations like "Triggr KTR API")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ticketRecord = ticket as any;
      const dbAgentName: string | null = ticketRecord.halo_agent ?? null;

      // Resolve placeholder names like "Tech 1" or raw IDs via the Halo API
      let assignedTechName = dbAgentName;

      // If still a placeholder, try fetching the full ticket for agent_id
      if (!assignedTechName || /^(?:tech\s*)?\d+$/i.test(assignedTechName.trim())) {
        try {
          const fullTicket = await haloEarly.getTicketWithSLA(ticket.halo_id);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const raw = fullTicket as any;
          assignedTechName = await haloEarly.resolveAgentName(raw.agent_name, raw.agent_id);

          // Update the DB so future runs have the real name
          if (assignedTechName && assignedTechName !== dbAgentName) {
            await supabase
              .from("tickets")
              .update({ halo_agent: assignedTechName })
              .eq("id", ticket.id);
          }
        } catch (err) {
          console.warn(`[MICHAEL] Could not resolve agent name for #${ticket.halo_id}:`, err);
        }
      }

      // Fetch images, inline images, and document attachments (PDFs/text)
      const [attachmentImages, inlineImages, ticketDocuments] = await Promise.all([
        haloEarly.getTicketImages(ticket.halo_id, rawActions),
        haloEarly.extractInlineImages(rawActions),
        collectTicketDocuments(haloEarly, ticket.halo_id, rawActions),
      ]);
      const allImages = [...attachmentImages, ...inlineImages].slice(0, 3);
      const imageContexts = allImages.map((img) => ({
        filename: img.filename,
        mediaType: img.mediaType,
        base64Data: img.base64Data,
        who: img.who,
      }));

      // ── Fetch SLA info ──────────────────────────────────────────────
      let slaBreached = false;
      let slaFixTargetMet: boolean | undefined;
      let slaResponseTargetMet: boolean | undefined;
      let slaFixByDate: string | null = null;
      let slaRespondByDate: string | null = null;
      let slaTimerText: string | null = null;
      let slaName: string | null = null;
      let slaOnHold = false;
      let slaHoldHours: number | null = null;
      let slaTimeLeftHours: number | null = null;
      let slaPercentUsed: number | null = null;
      let slaResponseDate: string | null = null;
      let followUpDate: string | null = null;

      try {
        const ticketWithSla = await haloEarly.getTicketWithSLA(ticket.halo_id);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const raw = ticketWithSla as any;

        const slaSource = raw.sla ?? raw.sladetails ?? raw;
        slaFixTargetMet = slaSource.fixtargetmet;
        slaResponseTargetMet = slaSource.responsetargetmet;
        slaFixByDate = slaSource.fixbydate ?? raw.fixbydate ?? null;
        slaRespondByDate = slaSource.respondbydate ?? raw.respondbydate ?? null;
        slaTimerText = slaSource.sla_timer_text ?? raw.sla_timer_text ?? null;

        // Full timer state — the ticket object carries everything the Halo
        // SLA sidebar shows (verified live on #40853 2026-07-08)
        slaName = [raw.sla_name, raw.priority?.name].filter(Boolean).join(" — ") || null;
        slaOnHold = raw.onhold === true;
        slaHoldHours = typeof raw.slaholdtime === "number" ? raw.slaholdtime : null;
        slaTimeLeftHours =
          typeof raw.fixtimeleft === "number" ? raw.fixtimeleft
          : typeof raw.slatimeleft === "number" ? raw.slatimeleft
          : null;
        slaPercentUsed = typeof raw.slapercused === "number" ? raw.slapercused : null;
        slaResponseDate = raw.responsedate ?? null;
        // Halo uses 1900-01-01 as its "not set" sentinel
        followUpDate =
          raw.followupdate && !String(raw.followupdate).startsWith("1900-")
            ? raw.followupdate
            : null;

        // Breach = negative SLA timer (matches Halo's own Breached SLA view;
        // fixtargetmet is ALWAYS null on this instance so the target test
        // never fires — kept as fallback for instances that populate it).
        // An ON-HOLD timer isn't burning (targets shift when it resumes).
        slaBreached =
          !slaOnHold &&
          (isSlaTimerBreached(slaTimeLeftHours, slaOnHold) ||
            isSlaTargetBreached(slaFixTargetMet, slaFixByDate) ||
            isSlaTargetBreached(slaResponseTargetMet, slaRespondByDate));
      } catch (err) {
        console.warn(`[MICHAEL] Could not fetch SLA info for #${ticket.halo_id}:`, err);
      }

      context = {
        ...context,
        actions: formattedActions,
        assignedTechName,
        images: imageContexts.length > 0 ? imageContexts : undefined,
        documents: ticketDocuments.length > 0 ? ticketDocuments : undefined,
        slaBreached,
        slaFixTargetMet: slaFixTargetMet ?? undefined,
        slaResponseTargetMet: slaResponseTargetMet ?? undefined,
        slaFixByDate,
        slaRespondByDate,
        slaTimerText,
        slaName,
        slaOnHold,
        slaHoldHours,
        slaTimeLeftHours,
        slaPercentUsed,
        slaResponseDate,
        followUpDate,
      };

      if (slaBreached) {
        await logThinking(
          supabase,
          ticket.id,
          "michael_scott",
          "manager",
          `⚠ SLA BREACHED for ticket #${ticket.halo_id} (fix target met: ${slaFixTargetMet}, response target met: ${slaResponseTargetMet}).`,
        );
      }

      // ── Vision Pre-Processing: Describe images for specialist agents ──
      if (imageContexts.length > 0) {
        try {
          const visionTimeout = new Promise<null>((resolve) =>
            setTimeout(() => resolve(null), 15_000),
          );
          const descriptions = await Promise.race([
            describeTicketImages(imageContexts, context.summary),
            visionTimeout,
          ]);
          if (descriptions) {
            const enrichedDetails = [
              context.details ?? "",
              "",
              "--- SCREENSHOTS / IMAGES ATTACHED TO THIS TICKET ---",
              descriptions,
              "--- END SCREENSHOTS ---",
            ].join("\n").trim();
            context = {
              ...context,
              details: enrichedDetails,
              imageDescriptions: descriptions,
            };
            console.log(`[MICHAEL] Described ${imageContexts.length} image(s) for ticket #${ticket.halo_id}`);
          } else {
            console.warn(`[MICHAEL] Vision timed out after 15s for #${ticket.halo_id} — proceeding without image descriptions`);
          }
        } catch (err) {
          console.warn(`[MICHAEL] Image description failed for #${ticket.halo_id}:`, err);
        }
      }
    } catch (err) {
      console.warn(`[MICHAEL] Could not fetch Halo actions for ticket #${ticket.halo_id}:`, err);
    }
  }

  // ── Step 1: Michael starts ─────────────────────────────────────────

  await supabase.from("agent_logs").insert({
    ticket_id: ticket.id,
    agent_name: "michael_scott",
    agent_role: "manager",
    status: "started",
    input_summary: `Triaging ticket #${ticket.halo_id}: ${ticket.summary}`,
  });

  // ── Step 2: Ryan classifies ────────────────────────────────────────

  await supabase.from("agent_logs").insert({
    ticket_id: ticket.id,
    agent_name: "ryan_howard",
    agent_role: "classifier",
    status: "started",
    input_summary: `Classifying ticket #${ticket.halo_id}`,
  });

  const ryanStart = Date.now();
  const classification = await classifyTicket(context);
  const ryanDuration = Date.now() - ryanStart;

  await supabase.from("agent_logs").insert({
    ticket_id: ticket.id,
    agent_name: "ryan_howard",
    agent_role: "classifier",
    status: "completed",
    output_summary: `Type: ${classification.classification.type}/${classification.classification.subtype}, Urgency: ${classification.urgency_score}/5, Security: ${classification.security_flag}`,
    duration_ms: ryanDuration,
  });

  // ── Fast path: Skip Sonnet for obvious notifications ────────────────

  const notificationFastPath = await tryNotificationFastPath(
    classification, context, supabase, ticket, startTime,
  );
  if (notificationFastPath) return notificationFastPath;

  // ── Alert fast path: cheap Haiku summary for automated alerts ──────

  const alertFastPath = await tryAlertFastPath(
    classification, context, supabase, ticket, startTime,
  );
  if (alertFastPath) return alertFastPath;

  // ── Step 2b: Check for duplicates and similar tickets ────────────
  let similarTickets: ReadonlyArray<SimilarTicket> = [];
  let duplicates: ReadonlyArray<DuplicateCandidate> = [];

  try {
    [similarTickets, duplicates] = await Promise.all([
      findSimilarTickets(supabase, {
        currentTicketId: ticket.id,
        summary: context.summary,
        details: context.details,
        clientName: context.clientName,
        maxResults: 3,
      }),
      detectDuplicates(supabase, {
        currentTicketId: ticket.id,
        summary: context.summary,
        details: context.details,
        clientName: context.clientName,
      }),
    ]);

    if (duplicates.length > 0) {
      console.log(`[MICHAEL] Duplicates for #${ticket.halo_id}: ${duplicates.map((d) => `#${d.haloId}`).join(", ")}`);
    }
  } catch (error) {
    console.warn("[MICHAEL] Similar/duplicate detection failed (non-fatal):", error);
  }

  // ── Step 3: Michael analyzes classification & picks specialists ────

  const classType = classification.classification.type;

  // Inject classification type into context so specialists can use it
  context = { ...context, classificationType: classType };

  const specialistNames = await getAgentsForClassification(
    classType,
    supabase,
    ticket.client_name,
    `${context.summary}\n${context.details ?? ""}`,
  );

  const allSpecialists = classification.security_flag
    ? [...new Set([...specialistNames, "angela_martin"])]
    : specialistNames;

  await logThinking(
    supabase,
    ticket.id,
    "michael_scott",
    "manager",
    `${classType}/${classification.classification.subtype}, urgency ${classification.urgency_score}/5. ${classification.security_flag ? "⚠ SECURITY FLAG. " : ""}Deploying: ${allSpecialists.map((n) => AGENT_LABELS[n] ?? n).join(", ")}.`,
  );

  // ── Step 4: Run specialist agents in parallel ──────────────────────

  const findings: Record<string, AgentFinding> = {
    ryan_howard: {
      agent_name: "ryan_howard",
      summary: `Classified as ${classification.classification.type}/${classification.classification.subtype} with ${classification.urgency_score}/5 urgency`,
      data: classification as unknown as Record<string, unknown>,
      confidence: classification.classification.confidence,
    },
  };

  const workerTokens: Record<string, number> = { ryan_howard: 0 };

  const specialistResults = await Promise.allSettled(
    allSpecialists.map(async (agentName) => {
      const agent = createAgent(agentName, supabase);
      if (!agent) {
        await supabase.from("agent_logs").insert({
          ticket_id: ticket.id,
          agent_name: agentName,
          agent_role: "worker",
          status: "skipped",
          output_summary: "Agent implementation not available",
        });
        return { agentName, result: null };
      }

      try {
        const result = await agent.execute(context);
        return { agentName, result };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        console.error(`[MICHAEL] Specialist ${agentName} failed:`, message);
        return { agentName, result: null };
      }
    }),
  );

  for (const settled of specialistResults) {
    if (settled.status === "fulfilled" && settled.value.result) {
      const { agentName, result } = settled.value;
      findings[agentName] = {
        agent_name: agentName,
        summary: result.summary,
        data: result.data,
        confidence: result.confidence,
      };
      workerTokens[agentName] = result.tokensUsed ?? 0;
    }
  }

  const successfulSpecialists = Object.keys(findings).filter(
    (k) => k !== "ryan_howard",
  );

  // ── Step 4b: Michael recalls past experiences ────────────────────────

  const memoryManager = new MemoryManager(supabase);
  const queryText = `${context.summary} ${context.details ?? ""} ${context.clientName ?? ""}`;

  let managerMemories: ReadonlyArray<MemoryMatch> = [];
  try {
    const [agentMem, sharedMem] = await Promise.all([
      memoryManager.recall("michael_scott", queryText, context.clientName),
      memoryManager.recallShared(queryText, context.clientName),
    ]);

    // Deduplicate by id
    const seenIds = new Set(agentMem.map((m) => m.id));
    const uniqueShared = sharedMem.filter((m) => !seenIds.has(m.id));
    managerMemories = [...agentMem, ...uniqueShared];

    if (managerMemories.length > 0) {
      await logThinking(
        supabase,
        ticket.id,
        "michael_scott",
        "manager",
        `Recalled ${managerMemories.length} relevant memories from past triages.`,
      );
    }
  } catch (error) {
    console.warn("[MICHAEL] Memory recall failed (non-fatal):", error);
  }

  // Standing client handling policies — fetched by client, not similarity,
  // because they apply to EVERY ticket for that client (e.g. US Tax:
  // prior approval + PO before any work)
  let clientPolicies: ReadonlyArray<{ readonly content: string; readonly summary: string }> = [];
  try {
    clientPolicies = await memoryManager.getClientPolicies(context.clientName);
    if (clientPolicies.length > 0) {
      await logThinking(supabase, ticket.id, "michael_scott", "manager", `This client has ${clientPolicies.length} standing handling polic${clientPolicies.length === 1 ? "y" : "ies"} — applying.`);
    }
  } catch (error) {
    console.warn("[MICHAEL] Client policy lookup failed (non-fatal):", error);
  }

  // ── Step 4b: Pull tech workload for assignment recommendation ──────
  let techWorkload = "";
  try {
    const { data: openTickets } = await supabase
      .from("tickets")
      .select("halo_agent")
      .eq("tickettype_id", 31)
      .eq("halo_is_open", true);

    const TECH_NAMES = [...HELPDESK_TECHNICIANS];
    const counts: Record<string, number> = {};
    for (const name of TECH_NAMES) counts[name] = 0;
    let unassigned = 0;

    for (const t of openTickets ?? []) {
      const agent = t.halo_agent ?? "";
      const matched = TECH_NAMES.find((n) => agent.toLowerCase().includes(n.split(" ")[0].toLowerCase()));
      if (matched) counts[matched]++;
      else if (!agent || agent === "Unassigned") unassigned++;
    }

    const lines = Object.entries(counts)
      .sort((a, b) => a[1] - b[1])
      .map(([name, count]) => `- ${name}: ${count} open tickets`);
    lines.push(`- Unassigned: ${unassigned}`);
    techWorkload = `\n\n## Current Tech Workload (live)\n${lines.join("\n")}\n\nRecommend the tech with the lightest load AND relevant skills for this ticket type. Tell Bryanna who to assign and why.`;
  } catch {
    // Non-critical
  }

  // ── Step 5: Michael synthesizes ALL findings ───────────────────────

  const michaelResult = await synthesizeFindings(
    context, classification, findings, successfulSpecialists, managerMemories, techWorkload, supabase, clientPolicies,
  );
  const processingTime = Date.now() - startTime;

  // ── Detect retriage vs first triage ────────────────────────────────
  // Only FULL triages count — the daily scan inserts triage_type='retriage'
  // flag rows, and counting those flipped a ticket's very first full triage
  // into a compact retriage note (#40782)
  const { data: existingTriages } = await supabase
    .from("triage_results")
    .select("id, created_at, classification, urgency_score, recommended_priority, security_flag")
    .eq("ticket_id", ticket.id)
    .neq("triage_type", "retriage")
    .order("created_at", { ascending: false })
    .limit(1);
  const isRetriage = (existingTriages?.length ?? 0) > 0;

  // Content-aware dedup: detect if retriage produced identical results
  const priorResult = existingTriages?.[0];
  const isIdenticalRetriage = isRetriage && priorResult != null &&
    JSON.stringify(priorResult.classification) === JSON.stringify(classification.classification) &&
    priorResult.urgency_score === classification.urgency_score &&
    priorResult.recommended_priority === classification.recommended_priority &&
    priorResult.security_flag === classification.security_flag;

  // If findings are unchanged, check if the tech has taken any action since the last triage.
  // No tech activity + no change = accountability flag (red note to Halo).
  // Tech has acted but no change in classification = skip silently.
  let techInactive = false;
  if (isIdenticalRetriage) {
    const lastTriageTime = priorResult?.created_at
      ? new Date(priorResult.created_at as string).getTime()
      : 0;
    const actions = context.actions ?? [];
    // Check if any tech action happened after the last triage. Counting ONLY
    // internal actions (a.isInternal) accused techs who replied PUBLICLY to
    // the customer — the best possible behavior — of "no activity". A public
    // reply by staff counts as activity too.
    const techActionsSinceLast = actions.filter((a) => {
      if (!a.date) return false;
      const actionTime = new Date(a.date).getTime();
      if (actionTime <= lastTriageTime) return false;
      if (a.isInternal) return true;
      const whoLower = (a.who ?? "").toLowerCase();
      return (
        isInternalStaffName(whoLower) ||
        whoLower.includes("gamma.tech") ||
        whoLower.includes("gtmail")
      );
    });
    techInactive = techActionsSinceLast.length === 0;

    if (techInactive) {
      console.log(`[MICHAEL] Retriage for #${ticket.halo_id} — findings unchanged, NO tech activity since last review → accountability note`);
    } else {
      console.log(`[MICHAEL] Retriage for #${ticket.halo_id} — findings unchanged but tech has acted, skipping duplicate note`);
    }
  }

  // ── Step 6: Write note to Halo ─────────────────────────────────────

  const haloConfig = await getHaloConfig(supabase);
  if (haloConfig && isIdenticalRetriage && techInactive) {
    // Post accountability note — red flag that nothing has changed AND no tech activity
    try {
      const halo = new HaloClient(haloConfig);
      const techName = context.assignedTechName ?? "Assigned tech";
      const techMention = await halo.buildMention(techName);
      const accountabilityNote = buildAccountabilityNote(
        techMention,
        ticket.halo_id,
        classification.urgency_score,
        context.clientName,
      );
      await halo.addInternalNote(ticket.halo_id, accountabilityNote);
      console.log(`[MICHAEL] Accountability note posted for #${ticket.halo_id}`);
    } catch (error) {
      console.error(`[MICHAEL] Failed to post accountability note for #${ticket.halo_id}:`, error);
    }
  } else if (haloConfig) {
    // Always post a note — even if findings are identical but tech has acted.
    // Every retriage must leave a visible trail in Halo for visibility.
    const branding = await getBrandingConfig(supabase);
    await postHaloNotes(
      haloConfig, context, classification, michaelResult,
      findings, processingTime, similarTickets, duplicates,
      isRetriage, ticket, branding, clientPolicies,
    );
  }

  // ── Step 7: Employee feedback — private coaching note ──────────────

  if (haloConfig) {
    // Always run tech review on retriages — the tech's behavior since last triage matters
    // regardless of whether findings changed
    const eligibility = checkReviewEligibility(
      context, classification, haloConfig, ticket.created_at,
    );
    if (eligibility.eligible) {
      try {
        await generateTechReview(
          context, classification, haloConfig, eligibility, supabase,
        );
        console.log(
          `[MICHAEL] Tech review generated for ticket #${ticket.halo_id} — rating pending`,
        );
      } catch (error) {
        console.error(
          `[MICHAEL] Failed to generate employee feedback for ticket #${ticket.halo_id}:`,
          error,
        );
      }
    } else {
      const actions = context.actions ?? [];
      const customerActions = actions.filter((a) => !a.isInternal);
      console.log(
        `[MICHAEL] Tech review skipped for #${ticket.halo_id}: ` +
        `age=${eligibility.ticketAgeHours.toFixed(1)}h, ` +
        `actions=${actions.length}, ` +
        `customerActions=${customerActions.length}, ` +
        `urgency=${classification.urgency_score}`,
      );
    }

    // ── Step 7b: Dispatcher review — evaluate Bryanna's routing ────
    if (checkDispatcherReviewEligibility(context, ticket.created_at)) {
      try {
        await generateDispatcherReview(context, ticket.created_at, haloConfig, supabase);
      } catch (error) {
        console.error(
          `[MICHAEL] Failed to generate dispatcher review for #${ticket.halo_id}:`,
          error,
        );
      }
    }
  }

  // ── Step 8: Send triage summary to Teams ─────────────────────────

  // Skip Teams for identical retriages where tech has acted (no news).
  // For tech-inactive identical retriages, the accountability note to Halo is enough —
  // Teams alert fires only for real triage changes.
  const skipTeams = isIdenticalRetriage;

  // Only notify Teams for urgent tickets (3+) — routine tickets don't need alerts
  try {
    const teamsConfig = await getTeamsConfig(supabase);
    if (teamsConfig && !skipTeams && classification.urgency_score >= 3) {
      const teams = new TeamsClient(teamsConfig);
      await teams.sendTriageSummary({
        haloId: ticket.halo_id,
        summary: context.summary,
        clientName: context.clientName,
        classification: `${classification.classification.type} / ${classification.classification.subtype}`,
        urgencyScore: classification.urgency_score,
        recommendedPriority: classification.recommended_priority,
        recommendedTeam: michaelResult.recommended_team,
        rootCause: michaelResult.root_cause_hypothesis,
        securityFlag: classification.security_flag,
        escalationNeeded: michaelResult.escalation_needed,
        processingTimeMs: processingTime,
        agentCount: Object.keys(findings).length,
      });
    }
  } catch (error) {
    console.error(
      `[MICHAEL] Failed to send Teams notification for ticket #${ticket.halo_id}:`,
      error,
    );
  }

  // ── Step 9: Final thinking + completed log ─────────────────────────

  await logThinking(
    supabase,
    ticket.id,
    "michael_scott",
    "manager",
    `Triage complete. Root cause hypothesis: ${michaelResult.root_cause_hypothesis}. Routing to ${michaelResult.recommended_team} team.${michaelResult.escalation_needed ? ` ⚠ ESCALATION NEEDED: ${michaelResult.escalation_reason}` : ""}`,
  );

  await supabase.from("agent_logs").insert({
    ticket_id: ticket.id,
    agent_name: "michael_scott",
    agent_role: "manager",
    status: "completed",
    output_summary: `Team: ${michaelResult.recommended_team}, Priority: P${classification.recommended_priority}, Agents used: ${Object.keys(findings).length}`,
    duration_ms: processingTime,
  });

  // ── Post-triage: Store ticket embedding for future similarity searches ──
  try {
    await storeTicketEmbedding(supabase, {
      ticketId: ticket.id,
      haloId: ticket.halo_id,
      summary: context.summary,
      details: context.details,
      classification: classType,
      clientName: context.clientName,
    });
  } catch (error) {
    console.warn("[MICHAEL] Failed to store ticket embedding (non-fatal):", error);
  }

  // ── Post-triage: Store triage memory + extract <remember> tags ──────
  try {
    // Extract any <remember> tags from Michael's synthesis output
    const synthesisText = [
      michaelResult.root_cause_hypothesis,
      Array.isArray(michaelResult.internal_notes)
        ? michaelResult.internal_notes.join("\n")
        : michaelResult.internal_notes,
    ].join("\n");

    const extracted = extractRememberTags(synthesisText);
    for (const mem of extracted) {
      await memoryManager.createSharedMemory({
        ticket_id: ticket.id,
        content: mem.content,
        summary: mem.content.slice(0, 200),
        memory_type: mem.memory_type,
        confidence: mem.confidence,
        metadata: {
          source_agent: "michael_scott",
          halo_id: ticket.halo_id,
          client_name: context.clientName,
        },
      });
    }

    // Store a resolution memory for Michael's own recall
    const triageSummary = [
      `Ticket #${ticket.halo_id}: ${context.summary}`,
      `Client: ${context.clientName ?? "Unknown"}`,
      `Classification: ${classType}/${classification.classification.subtype}`,
      `Root Cause: ${michaelResult.root_cause_hypothesis}`,
      `Team: ${michaelResult.recommended_team}`,
      `Priority: P${classification.recommended_priority}`,
      michaelResult.escalation_needed
        ? `Escalation: ${michaelResult.escalation_reason}`
        : "",
    ]
      .filter(Boolean)
      .join("\n");

    await memoryManager.createMemory({
      agent_name: "michael_scott",
      ticket_id: ticket.id,
      content: triageSummary,
      summary: `#${ticket.halo_id} ${context.clientName ?? ""}: ${stripRememberTags(michaelResult.root_cause_hypothesis).slice(0, 150)}`,
      memory_type: michaelResult.escalation_needed ? "escalation" : "resolution",
      confidence: classification.classification.confidence,
      metadata: {
        halo_id: ticket.halo_id,
        client_name: context.clientName,
        classification: classType,
        priority: classification.recommended_priority,
        team: michaelResult.recommended_team,
      },
    });
  } catch (error) {
    console.warn("[MICHAEL] Failed to store triage memory (non-fatal):", error);
  }

  // ── Return triage output ───────────────────────────────────────────

  // Evidence trail: which attachments the AI actually read this run
  const analyzedFiles = [
    ...(context.images ?? []).map((i) => i.filename),
    ...(context.documents ?? []).map((d) => d.filename),
  ];

  const triageId = crypto.randomUUID();

  return {
    id: triageId,
    ticket_id: ticket.id,
    classification: classification.classification,
    urgency_score: classification.urgency_score,
    urgency_reasoning: classification.urgency_reasoning,
    recommended_priority: classification.recommended_priority,
    recommended_team: michaelResult.recommended_team,
    recommended_agent: michaelResult.recommended_agent,
    security_flag: classification.security_flag,
    security_notes: classification.security_notes,
    findings,
    suggested_response: michaelResult.suggested_response,
    internal_notes: Array.isArray(michaelResult.internal_notes)
      ? michaelResult.internal_notes.join("\n")
      : michaelResult.internal_notes,
    processing_time_ms: processingTime,
    model_tokens_used: {
      manager: michaelResult._managerTokens ?? 0,
      workers: workerTokens,
    },
    analyzed_files: analyzedFiles.length > 0 ? analyzedFiles : null,
    duplicates: duplicates.length > 0
      ? duplicates.map((d) => ({ halo_id: d.haloId, summary: d.summary, similarity: d.similarity }))
      : null,
  };
}

// ── Michael's Synthesis ──────────────────────────────────────────────

interface MichaelSynthesis {
  readonly recommended_team: string;
  readonly recommended_agent: string | null;
  readonly assignment_reasoning: string | null;
  readonly manager_summary: string | null;
  readonly evidence: ReadonlyArray<string>;
  readonly connected_app_context: ReadonlyArray<string>;
  readonly root_cause_hypothesis: string;
  readonly troubleshooting_steps: ReadonlyArray<string>;
  readonly internal_notes: string | string[];
  readonly suggested_response: string | null;
  readonly workflow_reminder: string | null;
  readonly kb_suggestions: ReadonlyArray<string>;
  readonly escalation_needed: boolean;
  readonly escalation_reason: string | null;
  readonly _managerTokens: number;
}

async function synthesizeFindings(
  context: TriageContext,
  classification: Awaited<ReturnType<typeof classifyTicket>>,
  findings: Record<string, AgentFinding>,
  successfulSpecialists: ReadonlyArray<string>,
  memories: ReadonlyArray<MemoryMatch> = [],
  techWorkload: string = "",
  supabase?: SupabaseClient,
  clientPolicies: ReadonlyArray<{ readonly content: string; readonly summary: string }> = [],
): Promise<MichaelSynthesis> {
  const client = new Anthropic();

  // Live vendor status pages for this ticket type — a platform-side outage
  // reframes the whole ticket. Only vendors whose status page ANSWERED are
  // included; fetch failures never render as "operational".
  const vendorStatusSection = await getVendorStatusForType(
    classification.classification.type,
  )
    .then(formatVendorStatus)
    .catch(() => "");

  const specialistSections = Object.entries(findings)
    .map(([name, finding]) => {
      const label = AGENT_LABELS[name] ?? name;
      return [
        `## ${label}'s Findings`,
        `**Summary:** ${finding.summary}`,
        `**Confidence:** ${(finding.confidence * 100).toFixed(0)}%`,
        `**Data:** ${JSON.stringify(finding.data, null, 2)}`,
      ].join("\n");
    })
    .join("\n\n");

  const michaelMessage = [
    `## Ticket #${context.haloId}`,
    `**Subject:** ${context.summary}`,
    context.details ? `**Description:** ${context.details}` : "",
    context.clientName ? `**Client:** ${context.clientName}` : "",
    context.userName ? `**Reported By:** ${context.userName}${context.userEmail ? ` (${context.userEmail})` : ""}` : "",
    context.originalPriority
      ? `**Original Priority:** P${context.originalPriority}`
      : "",
    "",
    "## Ryan Howard's Classification",
    `**Type:** ${classification.classification.type} / ${classification.classification.subtype}`,
    `**Confidence:** ${(classification.classification.confidence * 100).toFixed(0)}%`,
    `**Urgency Score:** ${classification.urgency_score}/5`,
    `**Urgency Reasoning:** ${classification.urgency_reasoning}`,
    `**Recommended Priority:** P${classification.recommended_priority}`,
    `**Entities Found:** ${classification.entities.join(", ") || "None"}`,
    classification.security_flag
      ? `**⚠ SECURITY FLAG:** ${classification.security_notes}`
      : "",
    "",
    context.assignedTechName ? `**Assigned Tech:** ${context.assignedTechName}` : "",
    "",
    "## Workflow / SLA State (REAL — from Halo, do not guess)",
    context.slaName ? `**SLA plan:** ${context.slaName}` : "",
    `**Resolution due (resolution_time / fix-by):** ${context.slaFixByDate ?? "NOT SET"}`,
    `**Response due:** ${context.slaRespondByDate ?? "NOT SET"}`,
    context.slaResponseDate ? `**First response sent:** ${context.slaResponseDate}` : "",
    context.slaOnHold
      ? `**⏸ SLA TIMER IS ON HOLD**${context.slaHoldHours != null ? ` (held ${context.slaHoldHours.toFixed(1)}h so far)` : ""} — targets are paused, do NOT treat the fix-by date as burning. Note in workflow_reminder ONLY if hold looks wrong for the current status.`
      : "",
    context.slaTimeLeftHours != null && !context.slaOnHold
      ? `**Time left on resolution timer:** ${context.slaTimeLeftHours.toFixed(1)}h${context.slaPercentUsed != null ? ` (${context.slaPercentUsed.toFixed(0)}% of SLA used)` : ""}`
      : "",
    context.followUpDate ? `**Follow-up date set:** ${context.followUpDate} — a follow-up commitment exists; factor it into the plan instead of inventing a new deadline.` : "",
    context.slaTimerText ? `**SLA timer:** ${context.slaTimerText}` : "",
    `**SLA breached:** ${context.slaBreached ? "YES" : "no"}`,
    ...(context.slaBreached
      ? [
          "",
          "## 🚨 SLA BREACH ALERT",
          `**Resolution SLA breached:** ${context.slaFixTargetMet === false ? "YES — Fix target MISSED" : "No"}`,
          `**Response SLA breached:** ${context.slaResponseTargetMet === false ? "YES — Response target MISSED" : "No"}`,
          context.slaFixByDate ? `**Fix-by date:** ${context.slaFixByDate}` : "",
          context.slaTimerText ? `**SLA Timer:** ${context.slaTimerText}` : "",
          `The customer was promised a resolution time that has already passed. This is a critical SLA failure.`,
          context.assignedTechName
            ? `**${context.assignedTechName}** must address this SLA breach IMMEDIATELY — update the customer and either resolve the ticket or adjust the SLA target to the correct new date.`
            : `The assigned technician must address this SLA breach IMMEDIATELY.`,
          "",
        ]
      : []),
    ...(context.actions && context.actions.length > 0
      ? [
          "## Ticket History / Comments",
          `_Customer: ${context.userName ?? "Unknown"} | Tech: ${context.assignedTechName ?? "Unknown"}_`,
          ...context.actions.map((a) => {
            const who = a.who ?? "Unknown";
            const when = a.date ?? "unknown date";
            const visibility = a.isInternal ? "[INTERNAL]" : "[VISIBLE]";
            return `- ${visibility} **${who}** (${when}): ${a.note}`;
          }),
          "",
        ]
      : []),
    vendorStatusSection,
    specialistSections,
    techWorkload,
  ]
    .filter(Boolean)
    .join("\n");

  // Build multi-modal content: text + images (if any)
  const messageContent: Anthropic.MessageCreateParams["messages"][0]["content"] = [
    { type: "text", text: michaelMessage },
  ];

  if (context.images && context.images.length > 0) {
    for (const img of context.images) {
      messageContent.push({
        type: "image",
        source: {
          type: "base64",
          media_type: img.mediaType,
          data: img.base64Data,
        },
      });
      messageContent.push({
        type: "text",
        text: `[Screenshot: ${img.filename}${img.who ? ` from ${img.who}` : ""}]`,
      });
    }
  }

  // Document attachments: PDFs as native document blocks, text files inline
  if (context.documents && context.documents.length > 0) {
    for (const doc of context.documents) {
      const label = `[Attachment: ${doc.filename}${doc.who ? ` from ${doc.who}` : ""}]`;
      if (doc.kind === "pdf" && doc.base64Data) {
        messageContent.push({
          type: "document",
          source: {
            type: "base64",
            media_type: "application/pdf",
            data: doc.base64Data,
          },
        });
        messageContent.push({ type: "text", text: label });
      } else if (doc.kind === "text" && doc.textContent) {
        messageContent.push({
          type: "text",
          text: `${label}\n\`\`\`\n${doc.textContent}\n\`\`\``,
        });
      }
    }
  }

  // Inject recalled memories into the synthesis prompt
  if (memories.length > 0) {
    const currentClient = context.clientName?.trim().toLowerCase() ?? null;
    const memorySection = [
      "",
      "## Relevant Past Experiences",
      "You've handled similar tickets before. Use these memories to inform your analysis.",
      "Memories marked DIFFERENT CLIENT were learned at another customer — their environment facts (hostnames, DNS, credentials, config) do NOT apply to this ticket; only the general approach might.",
      "",
      ...memories.map((m, i) => {
        const memClient = (m.client_name ?? (m.metadata?.client_name as string | undefined))?.trim() ?? null;
        const clientTag = memClient && currentClient
          ? memClient.toLowerCase() === currentClient
            ? " [this client]"
            : ` [⚠ DIFFERENT CLIENT: ${memClient}]`
          : "";
        return `${i + 1}. [${m.memory_type}]${clientTag} ${m.summary} (relevance: ${(m.similarity * 100).toFixed(0)}%)`;
      }),
      "",
    ].join("\n");

    messageContent.push({ type: "text", text: memorySection });
  }

  // Standing client policies are NON-NEGOTIABLE context — they outrank
  // everything except security. The workflow reminder must carry them.
  if (clientPolicies.length > 0) {
    messageContent.push({
      type: "text",
      text: [
        "",
        "## ⚠ CLIENT HANDLING POLICY — MANDATORY",
        `This client has standing handling rules. Your workflow_reminder MUST restate the applicable rule, and your troubleshooting steps must comply with it (e.g. approval-before-work means step 1 is getting the approval).`,
        ...clientPolicies.map((p, i) => `${i + 1}. ${p.content}`),
        "",
      ].join("\n"),
    });
  }

  // Inject triage accuracy feedback context (if enough data exists)
  if (supabase) {
    try {
      const feedbackCtx = await getFeedbackContext(supabase);
      if (feedbackCtx) {
        messageContent.push({ type: "text", text: `\n${feedbackCtx}` });
      }
    } catch (err) {
      console.warn("[MICHAEL] Feedback context fetch failed (non-fatal):", err);
    }
  }

  const systemWithMemory = `${MICHAEL_SYSTEM_PROMPT}\n\n${REMEMBER_INSTRUCTIONS}`;

  const routingDecision = selectManagerModel(classification, successfulSpecialists.length);
  const request = {
    model: routingDecision.model,
    max_tokens: routingDecision.maxTokens,
    system: [{ type: "text" as const, text: systemWithMemory, cache_control: { type: "ephemeral" as const } }],
    messages: [{ role: "user" as const, content: messageContent }],
  };

  let response = await client.messages.create(request);
  logCacheUsage(`michael-synthesis:${routingDecision.model}`, response.usage);
  let text = extractResponseText(response);

  // An empty response is usually a transient API blip — one retry beats
  // erroring the ticket with "Unexpected end of JSON input"
  if (!text) {
    console.warn("[MICHAEL] Empty synthesis response — retrying once");
    response = await client.messages.create(request);
    text = extractResponseText(response);
  }
  if (!text) {
    throw new Error(
      `Michael synthesis returned no text (stop_reason: ${response.stop_reason ?? "unknown"})`,
    );
  }
  const rawResult = parseLlmJson<{
    recommended_team: string;
    recommended_agent: string | null;
    assignment_reasoning: string | null;
    manager_summary: string | null;
    evidence: string[] | null;
    connected_app_context: string[] | null;
    root_cause_hypothesis: string;
    troubleshooting_steps: string[] | null;
    internal_notes: string | string[];
    customer_response: string | null;
    suggested_response: string | null;
    workflow_reminder: string | null;
    kb_suggestions: string[] | null;
    adjustments: string | null;
    escalation_needed: boolean;
    escalation_reason: string | null;
  }>(text);

  return {
    ...rawResult,
    recommended_team: rawResult.recommended_team ?? "General",
    recommended_agent: rawResult.recommended_agent ?? null,
    assignment_reasoning: rawResult.assignment_reasoning ?? null,
    manager_summary: rawResult.manager_summary ?? null,
    evidence: Array.isArray(rawResult.evidence) ? rawResult.evidence : [],
    connected_app_context: Array.isArray(rawResult.connected_app_context) ? rawResult.connected_app_context : [],
    root_cause_hypothesis: rawResult.root_cause_hypothesis ?? "Needs technician review based on ticket details and connected app findings.",
    troubleshooting_steps: Array.isArray(rawResult.troubleshooting_steps)
      ? rawResult.troubleshooting_steps
      : Array.isArray(rawResult.internal_notes)
        ? rawResult.internal_notes
        : rawResult.internal_notes
          ? [rawResult.internal_notes]
          : [],
    internal_notes: Array.isArray(rawResult.internal_notes)
      ? rawResult.internal_notes
      : rawResult.internal_notes ?? "",
    suggested_response: rawResult.suggested_response ?? rawResult.customer_response ?? null,
    workflow_reminder: rawResult.workflow_reminder ?? null,
    kb_suggestions: Array.isArray(rawResult.kb_suggestions) ? rawResult.kb_suggestions : [],
    escalation_needed: Boolean(rawResult.escalation_needed),
    escalation_reason: rawResult.escalation_reason ?? null,
    _managerTokens: response.usage.input_tokens + response.usage.output_tokens,
  };
}

// ── Post Halo Notes ──────────────────────────────────────────────────

async function postHaloNotes(
  haloConfig: HaloConfig,
  context: TriageContext,
  classification: Awaited<ReturnType<typeof classifyTicket>>,
  michaelResult: MichaelSynthesis,
  findings: Record<string, AgentFinding>,
  processingTime: number,
  similarTickets: ReadonlyArray<SimilarTicket>,
  duplicates: ReadonlyArray<DuplicateCandidate>,
  isRetriage: boolean,
  ticket: Ticket,
  branding?: BrandingConfig,
  clientPolicies: ReadonlyArray<{ readonly content: string; readonly summary: string }> = [],
): Promise<void> {
  const halo = new HaloClient(haloConfig);

  // Build SLA info for note rendering
  const slaInfo = context.slaBreached
    ? {
        breached: true,
        fixTargetMet: context.slaFixTargetMet,
        responseTargetMet: context.slaResponseTargetMet,
        fixByDate: context.slaFixByDate,
        timerText: context.slaTimerText,
        assignedTech: context.assignedTechName,
      }
    : undefined;

  // KB Ideas and Doc Gaps are NOT included in initial triage — only in closing review.
  // On retriage, post a compact review — not the full triage table
  if (isRetriage) {
    try {
      const compactNote = buildCompactRetriageNote(
        classification, michaelResult, findings, processingTime, slaInfo,
        ticket.original_priority,
      );
      await halo.addInternalNote(ticket.halo_id, compactNote);
    } catch (error) {
      console.error(`[MICHAEL] Failed to write retriage note for #${ticket.halo_id}:`, error);
    }
  } else {
    try {
      const analyzedFiles = [
        ...(context.images ?? []).map((i) => i.filename),
        ...(context.documents ?? []).map((d) => d.filename),
      ];
      const internalNote = buildHaloNote(
        classification, michaelResult, findings, processingTime,
        similarTickets, duplicates, slaInfo, branding,
        ticket.original_priority, analyzedFiles, clientPolicies,
      );
      await halo.addInternalNote(ticket.halo_id, internalNote);
    } catch (error) {
      console.error(`[MICHAEL] Failed to write back to Halo for ticket #${ticket.halo_id}:`, error);
    }
  }

  // ── Auto-tag: Write classification to Halo custom field ──────────
  try {
    await halo.updateTicketCustomField(ticket.halo_id, "CFTriageClassification", `${classification.classification.type}/${classification.classification.subtype}`);
    await halo.updateTicketCustomField(ticket.halo_id, "CFTriageUrgency", String(classification.urgency_score));
  } catch (error) {
    console.warn(`[MICHAEL] Auto-tag failed for #${ticket.halo_id} (custom fields may not be configured):`, error);
  }
}

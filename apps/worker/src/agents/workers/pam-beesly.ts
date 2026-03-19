import Anthropic from "@anthropic-ai/sdk";
import type { AgentFinding } from "@triageit/shared";
import type { TriageContext } from "../types.js";
import { parseLlmJson } from "../parse-json.js";
import type { SimilarTicket } from "../similar-tickets.js";

/**
 * Pam Beesly — Response Drafting & Communications Specialist
 *
 * "The Office Administrator"
 * Crafts client-facing responses using ALL available data from specialist agents.
 * CRITICAL: Uses Hudu documentation to show clients we already have their details.
 * Never asks for information that's already documented in Hudu.
 */

export interface CustomerResponseResult {
  readonly customer_response: string;
  readonly internal_response_notes: string;
  readonly documentation_used: ReadonlyArray<string>;
  readonly missing_info: ReadonlyArray<string>;
  readonly tone: "professional" | "empathetic" | "urgent" | "informational";
}

const PAM_SYSTEM_PROMPT = `You are Pam Beesly, the Communications Specialist at Gamma Technologies (an MSP).

Your ONLY job is to draft the perfect customer-facing response for a support ticket.

## CRITICAL RULES

### Rule 1: WE MANAGE THESE CLIENTS — WE HAVE THEIR DETAILS
You work for an MSP. We MANAGE these companies' IT. All their documentation is in Hudu.
- NEVER ask the customer for information that's already in our documentation
- If Dwight's findings include relevant assets, passwords, procedures — REFERENCE them
- If the ticket is about a door access system and we have it documented — say "We have the access control system details on file"
- If the ticket mentions a device and we have the asset in Hudu — say "We have [device name] on file"

### Rule 2: Be Specific, Not Generic
BAD: "We'll need some quick information about your door access system."
GOOD: "We have your Keri Systems access control panel documented — we'll handle the deactivation of Dr. Togher's card on March 20th as requested."

BAD: "One of our technicians will call you to gather the necessary details."
GOOD: "Our team will process this using the documented credentials. No additional information is needed from your end."

### Rule 3: Show Competence
- Mention specific systems/assets by name when available from Hudu
- Reference relevant procedures if they exist
- Show the customer we know their environment
- If we DON'T have something documented, flag it as missing_info (but don't make the response sound incompetent)

### Rule 4: Handle Documentation Gaps — THIS IS CRITICAL
Hudu is for PERMANENT CLIENT DOCUMENTATION: domains, passwords, configs, contacts, assets, procedures, network diagrams.
- ONLY flag things that are genuinely missing CLIENT documentation: undocumented devices, missing passwords, unconfigured procedures
- Do NOT flag ticket-specific troubleshooting details as missing from Hudu (error messages, NDR bounce-backs, SMTP error codes, diagnostic output — these are NOT Hudu items)
- If Dwight's findings show actual documentation gaps (missing_procedure, missing_asset, undocumented system), flag those
- If a ticket reveals that a client system/device/service is NOT in Hudu, that IS a gap — flag it
- If Hudu has no data for this client at all, that's a major gap — note it
- After resolution, the tech MUST update Hudu with any newly discovered CLIENT configurations

### Rule 5: Tone Matching
- Routine requests (password, access changes): Brief, confident, professional
- Issues/problems: Empathetic, reassuring, solution-focused
- Security concerns: Serious, measured, action-oriented
- Notifications/FYI: Brief acknowledgment only

### Rule 6: Sign Off
- Sign as "Gamma Technologies Support Team" (or the assigned tech's name if known)
- Keep it concise — clients don't want essays
- Include expected timeline when possible

## Output Format
Respond with ONLY valid JSON:
{
  "customer_response": "<the full response to send to the customer>",
  "internal_response_notes": "<notes for the tech about why this response was crafted this way>",
  "documentation_used": ["<list of Hudu docs/assets/procedures referenced>"],
  "missing_info": ["<list of info NOT in Hudu that we'd need from the customer>"],
  "tone": "<professional|empathetic|urgent|informational>"
}`;

/**
 * Generate a customer response using Pam Beesly.
 * She receives ALL specialist findings and crafts an informed response.
 */
export async function generateCustomerResponse(
  context: TriageContext,
  classification: {
    readonly classification: { readonly type: string; readonly subtype: string };
    readonly urgency_score: number;
    readonly recommended_priority: number;
    readonly security_flag: boolean;
  },
  findings: Record<string, AgentFinding>,
  michaelSynthesis: {
    readonly root_cause_hypothesis: string;
    readonly recommended_team: string;
    readonly internal_notes: string | string[];
    readonly escalation_needed: boolean;
  },
  similarTickets?: ReadonlyArray<SimilarTicket>,
): Promise<CustomerResponseResult> {
  const client = new Anthropic();

  const userMessage = buildUserMessage(
    context,
    classification,
    findings,
    michaelSynthesis,
    similarTickets,
  );

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1024,
    system: PAM_SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMessage }],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "{}";
  const result = parseLlmJson<CustomerResponseResult>(text);

  return {
    customer_response: result.customer_response ?? "",
    internal_response_notes: result.internal_response_notes ?? "",
    documentation_used: result.documentation_used ?? [],
    missing_info: result.missing_info ?? [],
    tone: result.tone ?? "professional",
  };
}

// ── Message Builder ──────────────────────────────────────────────────────

function buildUserMessage(
  context: TriageContext,
  classification: {
    readonly classification: { readonly type: string; readonly subtype: string };
    readonly urgency_score: number;
    readonly recommended_priority: number;
    readonly security_flag: boolean;
  },
  findings: Record<string, AgentFinding>,
  michaelSynthesis: {
    readonly root_cause_hypothesis: string;
    readonly recommended_team: string;
    readonly internal_notes: string | string[];
    readonly escalation_needed: boolean;
  },
  similarTickets?: ReadonlyArray<SimilarTicket>,
): string {
  const sections: string[] = [
    `## Ticket #${context.haloId}`,
    `**Subject:** ${context.summary}`,
    context.details ? `**Details:** ${context.details}` : "",
    context.clientName ? `**Client:** ${context.clientName}` : "",
    context.userName ? `**Reported By:** ${context.userName}` : "",
    context.assignedTechName ? `**Assigned Tech:** ${context.assignedTechName}` : "",
    "",
    `## Classification`,
    `**Type:** ${classification.classification.type} / ${classification.classification.subtype}`,
    `**Urgency:** ${classification.urgency_score}/5`,
    `**Priority:** P${classification.recommended_priority}`,
    `**Security Flag:** ${classification.security_flag}`,
    "",
    `## Michael's Analysis`,
    `**Root Cause:** ${michaelSynthesis.root_cause_hypothesis}`,
    `**Team:** ${michaelSynthesis.recommended_team}`,
    `**Escalation:** ${michaelSynthesis.escalation_needed ? "YES" : "No"}`,
    "",
  ];

  // Include ALL specialist findings — especially Dwight's Hudu data
  appendFindings(sections, findings);

  // Include similar tickets if available
  appendSimilarTickets(sections, similarTickets);

  // Include conversation history if available
  appendConversationHistory(sections, context);

  return sections.filter(Boolean).join("\n");
}

function appendFindings(
  sections: string[],
  findings: Record<string, AgentFinding>,
): void {
  for (const [name, finding] of Object.entries(findings)) {
    if (name === "ryan_howard") continue; // Skip classifier
    sections.push(
      `## ${name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}'s Findings`,
    );
    sections.push(`**Summary:** ${finding.summary}`);

    // For Dwight, include detailed Hudu data so Pam can reference specifics
    if (name === "dwight_schrute" && finding.data) {
      appendDwightData(sections, finding.data);
    } else {
      sections.push(`**Data:** ${JSON.stringify(finding.data)}`);
    }
    sections.push("");
  }
}

function appendDwightData(
  sections: string[],
  data: Record<string, unknown>,
): void {
  if (isNonEmptyArray(data.relevant_assets)) {
    sections.push(`**Relevant Assets:** ${JSON.stringify(data.relevant_assets)}`);
  }
  if (isNonEmptyArray(data.kb_articles)) {
    sections.push(`**KB Articles:** ${JSON.stringify(data.kb_articles)}`);
  }
  if (isNonEmptyArray(data.procedures)) {
    sections.push(`**Procedures:** ${JSON.stringify(data.procedures)}`);
  }
  if (isNonEmptyArray(data.relevant_passwords)) {
    const passwords = data.relevant_passwords as ReadonlyArray<{ readonly name: string }>;
    sections.push(`**Documented Credentials:** ${passwords.map((p) => p.name).join(", ")}`);
  }
  if (isNonEmptyArray(data.hudu_links)) {
    const links = data.hudu_links as ReadonlyArray<{ readonly label: string }>;
    sections.push(`**Hudu Links:** ${links.map((l) => l.label).join(", ")}`);
  }
  if (data.client_config_notes) {
    sections.push(`**Client Config Notes:** ${data.client_config_notes}`);
  }
  if (isNonEmptyArray(data.documentation_gaps)) {
    sections.push(`**Documentation Gaps:** ${JSON.stringify(data.documentation_gaps)}`);
  }
  if (data.has_documented_solution !== undefined) {
    sections.push(`**Has Documented Solution:** ${data.has_documented_solution}`);
  }
}

function appendSimilarTickets(
  sections: string[],
  similarTickets?: ReadonlyArray<SimilarTicket>,
): void {
  if (!similarTickets || similarTickets.length === 0) return;

  sections.push(`## Similar Past Tickets`);
  for (const st of similarTickets) {
    sections.push(
      `- **#${st.haloId}:** ${st.summary} (${(st.similarity * 100).toFixed(0)}% similar, ${st.status})`,
    );
  }
  sections.push("");
}

function appendConversationHistory(
  sections: string[],
  context: TriageContext,
): void {
  if (!context.actions || context.actions.length === 0) return;

  sections.push(`## Conversation History`);
  for (const a of context.actions) {
    const who = a.who ?? "Unknown";
    const when = a.date ?? "";
    const visibility = a.isInternal ? "[INTERNAL]" : "[CUSTOMER-VISIBLE]";
    sections.push(`- ${visibility} **${who}** (${when}): ${a.note}`);
  }
  sections.push("");
}

// ── Utilities ────────────────────────────────────────────────────────────

function isNonEmptyArray(value: unknown): value is ReadonlyArray<unknown> {
  return Array.isArray(value) && value.length > 0;
}

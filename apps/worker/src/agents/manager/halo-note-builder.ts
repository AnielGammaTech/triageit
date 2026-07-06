import type { AgentFinding } from "@triageit/shared";
import type { SimilarTicket } from "../similar-tickets.js";
import type { DuplicateCandidate } from "../duplicate-detector.js";

// ── URL to hyperlink converter ──────────────────────────────────────

/**
 * Convert raw URLs in text to clickable HTML hyperlinks.
 * Skips URLs already inside href="" attributes.
 */
function linkifyUrls(text: string): string {
  // Don't process if already contains href (already linkified)
  if (text.includes('href="http')) return text;

  // Match URLs not already inside an HTML attribute
  return text.replace(
    /(?<!\w|="|='|">)(https?:\/\/[^\s<>"')\]]+)/g,
    (url) => {
      // Extract display name from URL for cleaner output
      try {
        const parsed = new URL(url);
        const host = parsed.hostname.replace(/^www\./, "");
        const path = parsed.pathname === "/" ? "" : parsed.pathname;
        const display = `${host}${path}`.replace(/\/$/, "");
        return `<a href="${url}" style="color:#60a5fa;text-decoration:underline;">${display}</a>`;
      } catch {
        return `<a href="${url}" style="color:#60a5fa;text-decoration:underline;">${url}</a>`;
      }
    },
  );
}

// ── Agent name to display label ──────────────────────────────────────

export const AGENT_LABELS: Record<string, string> = {
  dwight_schrute: "Dwight Schrute (Documentation)",
  jim_halpert: "Jim Halpert (Identity)",
  andy_bernard: "Andy Bernard (Endpoint/RMM)",
  stanley_hudson: "Stanley Hudson (Cloud)",
  phyllis_vance: "Phyllis Vance (Email/DNS)",
  angela_martin: "Angela Martin (Security)",
  meredith_palmer: "Meredith Palmer (Backup/Recovery)",
  kelly_kapoor: "Kelly Kapoor (VoIP/Telephony)",
  erin_hannon: "Erin Hannon (Alert Specialist)",
  oscar_martinez: "Oscar Martinez (Backup/Cove/Unitrends)",
  holly_flax: "Holly Flax (Licensing/Pax8)",
};

// ── Halo Priority Labels ─────────────────────────────────────────────

const PRIORITY_LABELS: Record<number, string> = {
  1: "High – Severe Productivity Impact",
  2: "Affects Multiple Users",
  3: "Affects Single User",
  4: "Low – Minor Issue or Request",
};

function priorityLabel(p: number): string {
  return PRIORITY_LABELS[p] ?? `P${p}`;
}

// ── SLA Info type ────────────────────────────────────────────────────

export interface SlaInfo {
  readonly breached: boolean;
  readonly fixTargetMet?: boolean;
  readonly responseTargetMet?: boolean;
  readonly fixByDate?: string | null;
  readonly timerText?: string | null;
  readonly assignedTech?: string | null;
}

// ── Tech Notes Formatter ─────────────────────────────────────────────

export function formatTechNotes(notes: unknown): string {
  if (!notes) return "No notes available.";

  // Best case: LLM returned an array of steps (our new prompt format)
  if (Array.isArray(notes)) {
    const steps = notes
      .map((n) => (typeof n === "string" ? n.trim() : JSON.stringify(n)))
      .filter(Boolean)
      .slice(0, 5);
    if (steps.length > 0) {
      const items = steps.map((s) => `<li style="margin-bottom:6px;">${linkifyUrls(s)}</li>`).join("");
      return `<ol style="margin:4px 0;padding-left:20px;list-style:decimal;">${items}</ol>`;
    }
  }

  const text = typeof notes === "string" ? notes : JSON.stringify(notes);

  // Try splitting on numbered patterns like "1)", "1.", "(1)", or "STEP 1:"
  const numbered = text.split(/(?:^|\s)(?:\d+[\).\-:]|\(\d+\))\s*/g).filter(Boolean);
  if (numbered.length > 1) {
    const items = numbered.map((item) => `<li style="margin-bottom:6px;">${linkifyUrls(item.trim())}</li>`).join("");
    return `<ol style="margin:4px 0;padding-left:20px;list-style:decimal;">${items}</ol>`;
  }

  // Try splitting on sentence boundaries
  const sentences = text.split(/(?<=\.)\s+(?=[A-Z])/).filter(Boolean);
  if (sentences.length > 2) {
    const items = sentences.map((s) => `<li style="margin-bottom:6px;">${linkifyUrls(s.trim())}</li>`).join("");
    return `<ol style="margin:4px 0;padding-left:20px;list-style:decimal;">${items}</ol>`;
  }

  return linkifyUrls(text);
}

function toStringArray(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "string") return item.trim();
        if (item && typeof item === "object") {
          const record = item as Record<string, unknown>;
          const label = record.title ?? record.name ?? record.label ?? record.summary ?? record.note;
          return typeof label === "string" ? label.trim() : JSON.stringify(item);
        }
        return String(item).trim();
      })
      .filter(Boolean);
  }
  return [String(value).trim()].filter(Boolean);
}

function uniqueNonEmpty(items: ReadonlyArray<string>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const trimmed = item.trim();
    const key = trimmed.toLowerCase();
    if (!trimmed || seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

function formatBulletList(items: ReadonlyArray<string>, emptyText = "No connected-app findings available."): string {
  const clean = uniqueNonEmpty(items).slice(0, 8);
  if (clean.length === 0) return emptyText;
  return `<ul style="margin:4px 0;padding-left:18px;">${clean
    .map((item) => `<li style="margin-bottom:5px;">${linkifyUrls(item)}</li>`)
    .join("")}</ul>`;
}

function pickNamedItems(value: unknown): string[] {
  return toStringArray(value).slice(0, 5);
}

function collectConnectedAppContext(findings: Record<string, AgentFinding>): string[] {
  const items: string[] = [];
  const dwight = findings.dwight_schrute?.data;

  if (dwight) {
    const articles = pickNamedItems(dwight.kb_articles);
    const procedures = pickNamedItems(dwight.procedures);
    const assets = pickNamedItems(dwight.relevant_assets);
    const passwords = pickNamedItems(dwight.relevant_passwords);
    const configNotes = pickNamedItems(dwight.client_config_notes);

    if (articles.length > 0) items.push(`Hudu articles: ${articles.join(", ")}`);
    if (procedures.length > 0) items.push(`Hudu procedures: ${procedures.join(", ")}`);
    if (assets.length > 0) items.push(`Hudu assets: ${assets.join(", ")}`);
    if (passwords.length > 0) items.push(`Hudu credential entries to check: ${passwords.join(", ")}`);
    items.push(...configNotes.map((note) => `Hudu client note: ${note}`));
  }

  // Specialist summaries are NOT app context — Michael already synthesizes
  // them into the plan. Dumping them here doubled everything and buried the
  // useful Hudu facts under not-applicable essays.
  return uniqueNonEmpty(items);
}

// ── Full Triage Note ─────────────────────────────────────────────────

export interface BrandingConfig {
  readonly logoUrl?: string | null;
  readonly name?: string | null;
}

export function buildHaloNote(
  classification: {
    readonly classification: { readonly type: string; readonly subtype: string; readonly confidence: number };
    readonly urgency_score: number;
    readonly urgency_reasoning: string;
    readonly recommended_priority: number;
    readonly security_flag: boolean;
    readonly security_notes: string | null;
    readonly entities: ReadonlyArray<string>;
  },
  michaelResult: {
    readonly recommended_team: string;
    readonly recommended_agent?: string | null;
    readonly assignment_reasoning?: string | null;
    readonly manager_summary?: string | null;
    readonly evidence?: ReadonlyArray<string>;
    readonly connected_app_context?: ReadonlyArray<string>;
    readonly root_cause_hypothesis: string;
    readonly troubleshooting_steps?: ReadonlyArray<string>;
    readonly internal_notes: string | string[];
    readonly suggested_response: string | null;
    readonly workflow_reminder?: string | null;
    readonly kb_suggestions: ReadonlyArray<string>;
    readonly escalation_needed: boolean;
    readonly escalation_reason: string | null;
  },
  findings: Record<string, AgentFinding>,
  processingTime: number,
  // Similar tickets no longer render in the note but stay in the signature
  // so callers don't change; they still feed Michael's context upstream.
  _similarTickets?: ReadonlyArray<SimilarTicket>,
  duplicates?: ReadonlyArray<DuplicateCandidate>,
  slaInfo?: SlaInfo,
  branding?: BrandingConfig,
  originalPriority?: number | null,
): string {
  const agentCount = Object.keys(findings).length;
  // Dark theme base styles
  const border = "border-bottom:1px solid #3a3f4b;";
  const td1 = `style="padding:8px 12px;font-weight:600;width:100px;${border}font-size:13px;vertical-align:top;white-space:nowrap;color:#94a3b8;"`;
  const td2 = `style="padding:8px 12px;${border}font-size:14px;color:#e2e8f0;line-height:1.5;word-break:break-word;"`;

  const rows: string[] = [];

  // Header — gradient with optional logo
  const brandName = branding?.name ?? "TriageIt";
  const logoHtml = branding?.logoUrl
    ? `<img src="${branding.logoUrl}" alt="${brandName}" style="height:22px;width:auto;vertical-align:middle;margin-right:8px;border-radius:3px;" />`
    : "🤖 ";
  // Priority suggestion lives as a small header chip — the ticket itself
  // already shows the current priority, so no dedicated rows for it
  const prioritySuggestion =
    originalPriority && classification.recommended_priority !== originalPriority
      ? `<span style="background:rgba(255,255,255,0.2);padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;margin-right:10px;">Suggests ${priorityLabel(classification.recommended_priority)} ${classification.recommended_priority < originalPriority ? "⬆" : "⬇"}</span>`
      : "";
  rows.push(`<tr><td colspan="2" style="padding:10px 12px;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:white;font-size:15px;font-weight:700;">${logoHtml}AI Triage — ${brandName}<span style="float:right;font-weight:400;font-size:11px;opacity:0.8;">${prioritySuggestion}${agentCount} agents · ${(processingTime / 1000).toFixed(1)}s</span></td></tr>`);

  // SLA Breach — red alert banner, placed first for maximum visibility
  if (slaInfo?.breached) {
    const techName = slaInfo.assignedTech ?? "Assigned technician";
    const fixBy = slaInfo.fixByDate ? ` — Fix-by: ${new Date(slaInfo.fixByDate).toLocaleString()}` : "";
    const timer = slaInfo.timerText ? ` (${slaInfo.timerText})` : "";
    rows.push(`<tr style="background:#7f1d1d;"><td colspan="2" style="padding:10px 14px;font-size:14px;color:#fecaca;line-height:1.6;${border}"><strong style="color:#f87171;font-size:15px;">🚨 SLA BREACH — IMMEDIATE ACTION REQUIRED</strong><br/><strong>${techName}</strong>: The resolution SLA on this ticket has been breached${fixBy}${timer}. You must address this <strong>immediately</strong> — either resolve the issue and update the customer, or adjust the SLA target to the correct new completion date. Do not leave this ticket without an updated timeline.</td></tr>`);
  }

  // Classification
  rows.push(`<tr style="background:#252830;"><td ${td1}>Classification</td><td ${td2}><strong>${classification.classification.type} / ${classification.classification.subtype}</strong> <span style="color:#64748b;font-size:11px;">(${(classification.classification.confidence * 100).toFixed(0)}%)</span></td></tr>`);

  // Assignment suggestion for Bryanna — the manager prose row is gone
  // (it repeated Root Cause and Workflow nearly verbatim)
  if (michaelResult.recommended_agent) {
    const reason = michaelResult.assignment_reasoning
      ? ` <span style="color:#94a3b8;">— ${linkifyUrls(michaelResult.assignment_reasoning)}</span>`
      : "";
    rows.push(`<tr style="background:#1a2332;"><td style="padding:8px 12px;font-weight:700;width:100px;${border}font-size:13px;vertical-align:top;color:#93c5fd;">Assign</td><td style="padding:8px 12px;${border}font-size:14px;color:#dbeafe;line-height:1.55;word-break:break-word;"><strong style="color:#e2e8f0;">${michaelResult.recommended_agent}</strong> <span style="color:#64748b;">·</span> ${michaelResult.recommended_team}${reason}<br/><span style="font-size:10px;color:#64748b;">Suggestion for Bryanna — not auto-assigned</span></td></tr>`);
  }

  // Security
  if (classification.security_flag) {
    rows.push(`<tr style="background:#3b1018;"><td style="padding:8px 12px;font-weight:700;width:100px;${border}font-size:13px;vertical-align:top;color:#f87171;">⚠ Security</td><td style="padding:8px 12px;${border}font-size:14px;color:#fca5a5;line-height:1.5;word-break:break-word;">${linkifyUrls(classification.security_notes ?? "")}</td></tr>`);
  }

  // Escalation
  if (michaelResult.escalation_needed) {
    rows.push(`<tr style="background:#3b2508;"><td style="padding:8px 12px;font-weight:700;width:100px;${border}font-size:13px;vertical-align:top;color:#fbbf24;">⬆ Escalation</td><td style="padding:8px 12px;${border}font-size:14px;color:#fcd34d;line-height:1.5;word-break:break-word;">${linkifyUrls(michaelResult.escalation_reason ?? "")}</td></tr>`);
  }

  if (michaelResult.workflow_reminder) {
    rows.push(`<tr style="background:#3b2508;"><td style="padding:8px 12px;font-weight:700;width:100px;${border}font-size:13px;vertical-align:top;color:#fbbf24;">Workflow</td><td style="padding:8px 12px;${border}font-size:13px;color:#fcd34d;line-height:1.5;word-break:break-word;">${linkifyUrls(michaelResult.workflow_reminder)}</td></tr>`);
  }

  // Root Cause — amber tinted dark background
  rows.push(`<tr style="background:#332b1a;"><td style="padding:8px 12px;font-weight:600;width:100px;${border}font-size:13px;vertical-align:top;color:#fbbf24;">🔍 Root Cause</td><td style="padding:8px 12px;${border}font-size:14px;color:#fde68a;line-height:1.5;word-break:break-word;">${linkifyUrls(michaelResult.root_cause_hypothesis)}</td></tr>`);

  // Evidence row removed — root cause + app context carry the signal

  const appContext = uniqueNonEmpty([
    ...toStringArray(michaelResult.connected_app_context),
    ...collectConnectedAppContext(findings),
  ]).slice(0, 3);
  if (appContext.length > 0) {
    rows.push(`<tr style="background:#162216;"><td style="padding:8px 12px;font-weight:600;width:100px;${border}font-size:13px;vertical-align:top;color:#4ade80;">App Context</td><td style="padding:8px 12px;${border}font-size:13px;color:#bbf7d0;line-height:1.5;word-break:break-word;">${formatBulletList(appContext)}</td></tr>`);
  }

  // Tech plan — blue tinted dark background, parsed into numbered list
  const stepSource = michaelResult.troubleshooting_steps && michaelResult.troubleshooting_steps.length > 0
    ? michaelResult.troubleshooting_steps
    : michaelResult.internal_notes;
  const formattedNotes = formatTechNotes(stepSource);
  rows.push(`<tr style="background:#1a2332;"><td style="padding:8px 12px;font-weight:600;width:100px;${border}font-size:13px;vertical-align:top;color:#60a5fa;">Tech Plan</td><td style="padding:8px 12px;${border}font-size:13px;color:#bfdbfe;line-height:1.5;word-break:break-word;">${formattedNotes}</td></tr>`);

  // Quick Links — Hudu links from Dwight + backup quicklinks from Oscar/Meredith
  const dwightData = findings.dwight_schrute?.data;
  const huduLinks = (dwightData?.hudu_links as Array<{ label: string; url: string }>) ?? [];
  const relevantPasswords = (dwightData?.relevant_passwords as Array<{ name: string; type: string; note: string }>) ?? [];

  // Collect backup quicklinks from Oscar (Cove/Unitrends) and Meredith (Spanning)
  const oscarLinks = (findings.oscar_martinez?.data?.quicklinks as Array<{ label: string; url: string }>) ?? [];
  const meredithLinks = (findings.meredith_palmer?.data?.quicklinks as Array<{ label: string; url: string }>) ?? [];
  const backupLinks = [...oscarLinks, ...meredithLinks];

  // Andy's Datto console links for the reporter's / ticket-named devices
  const dattoDeviceLinks = (findings.andy_bernard?.data?.device_links as Array<{ label: string; url: string }>) ?? [];

  const allLinks = [...dattoDeviceLinks, ...huduLinks, ...backupLinks];

  if (allLinks.length > 0 || relevantPasswords.length > 0) {
    const linkItems = allLinks
      .map((l) => `<a href="${l.url}" style="color:#60a5fa;text-decoration:underline;">${l.label}</a>`)
      .join(" · ");
    const pwItems = relevantPasswords.map((p) => p.name).join(", ");
    const content = [
      linkItems,
      pwItems ? `<br/><span style="color:#94a3b8;font-size:11px;">Credentials: ${pwItems}</span>` : "",
    ]
      .filter(Boolean)
      .join("");
    rows.push(`<tr style="background:#162216;"><td style="padding:8px 12px;font-weight:600;width:100px;${border}font-size:13px;vertical-align:top;color:#4ade80;">📎 Quick Links</td><td style="padding:8px 12px;${border}font-size:13px;color:#bbf7d0;line-height:1.6;word-break:break-word;">${content}</td></tr>`);
  }

  // Similar-tickets section removed — it was noise for the techs. Similar
  // tickets still feed Michael's context and duplicate detection.

  // Duplicate warnings
  if (duplicates && duplicates.length > 0) {
    const dupItems = duplicates
      .slice(0, 2)
      .map((d) => `<strong style="color:#fbbf24;">#${d.haloId}</strong> ${d.summary} <span style="color:#64748b;font-size:11px;">(${(d.similarity * 100).toFixed(0)}%)</span>`)
      .join("<br/>");
    rows.push(`<tr style="background:#3b2508;"><td style="padding:8px 12px;font-weight:600;width:100px;${border}font-size:13px;vertical-align:top;color:#fbbf24;">⚠ Duplicates</td><td style="padding:8px 12px;${border}font-size:13px;color:#fde68a;line-height:1.6;word-break:break-word;">${dupItems}</td></tr>`);
  }

  // Documentation Gap — inline
  // Suggested Customer Reply
  if (michaelResult.suggested_response) {
    rows.push(`<tr style="background:#1a2332;"><td style="padding:8px 12px;font-weight:600;width:100px;${border}font-size:13px;vertical-align:top;color:#38bdf8;">💬 Reply</td><td style="padding:8px 12px;${border}font-size:13px;color:#bae6fd;line-height:1.5;word-break:break-word;"><em style="color:#7dd3fc;">"${linkifyUrls(michaelResult.suggested_response)}"</em><br/><span style="font-size:10px;color:#64748b;">Suggestion only — edit before sending</span></td></tr>`);
  }

  // KB Ideas removed from initial triage — they belong in the close review only

  // Doc Gaps removed from initial triage — they belong in the close review only

  // Priority recommendation lives in the header chip — no bottom row

  // No footer — the header already carries agent count and timing

  return `<table style="font-family:'Segoe UI',Roboto,Arial,sans-serif;width:100%;max-width:100%;border-collapse:collapse;font-size:13px;color:#e2e8f0;margin:0;padding:0;border:1px solid #3a3f4b;background:#1E2028;border-radius:8px;overflow:hidden;">${rows.join("")}</table>`;
}

// ── Compact Retriage Note ─────────────────────────────────────────────

export function buildCompactRetriageNote(
  classification: {
    readonly classification: { readonly type: string; readonly subtype: string; readonly confidence: number };
    readonly urgency_score: number;
    readonly recommended_priority: number;
  },
  michaelResult: {
    readonly recommended_team: string;
    readonly recommended_agent?: string | null;
    readonly assignment_reasoning?: string | null;
    readonly manager_summary?: string | null;
    readonly evidence?: ReadonlyArray<string>;
    readonly connected_app_context?: ReadonlyArray<string>;
    readonly root_cause_hypothesis: string;
    readonly troubleshooting_steps?: ReadonlyArray<string>;
    readonly internal_notes: string | string[];
    readonly suggested_response: string | null;
    readonly workflow_reminder?: string | null;
    readonly kb_suggestions: ReadonlyArray<string>;
    readonly escalation_needed: boolean;
    readonly escalation_reason: string | null;
  },
  findings: Record<string, AgentFinding>,
  processingTime: number,
  slaInfo?: SlaInfo,
  originalPriority?: number | null,
): string {
  const border = "border-bottom:1px solid #3a3f4b;";
  const rows: string[] = [];

  // Compact header — priority suggestion as a chip, no dedicated rows
  const compactPriorityChip =
    originalPriority && classification.recommended_priority !== originalPriority
      ? `<span style="background:rgba(255,255,255,0.2);padding:1px 6px;border-radius:8px;font-size:10px;font-weight:600;margin-right:8px;">Suggests ${priorityLabel(classification.recommended_priority)} ${classification.recommended_priority < originalPriority ? "⬆" : "⬇"}</span>`
      : "";
  rows.push(`<tr><td colspan="2" style="padding:6px 12px;background:linear-gradient(135deg,#4f46e5,#7c3aed);color:white;font-size:12px;font-weight:600;">📋 Retriage — TriageIt<span style="float:right;font-weight:400;font-size:10px;opacity:0.8;">${compactPriorityChip}${(processingTime / 1000).toFixed(1)}s</span></td></tr>`);

  // SLA Breach — red alert banner
  if (slaInfo?.breached) {
    const techName = slaInfo.assignedTech ?? "Assigned technician";
    const fixBy = slaInfo.fixByDate ? ` Fix-by: ${new Date(slaInfo.fixByDate).toLocaleString()}` : "";
    rows.push(`<tr style="background:#7f1d1d;"><td colspan="2" style="padding:6px 12px;font-size:12px;color:#fecaca;${border}"><strong style="color:#f87171;">🚨 SLA BREACHED</strong> — <strong>${techName}</strong>: act now.${fixBy}</td></tr>`);
  }

  // Status + Escalation on one line
  const escalationTag = michaelResult.escalation_needed
    ? ` <span style="background:#dc2626;color:white;padding:1px 6px;border-radius:3px;font-size:10px;font-weight:700;">⬆ ESCALATE</span>`
    : "";
  rows.push(`<tr style="background:#252830;"><td style="padding:5px 12px;font-weight:600;width:80px;${border}font-size:11px;color:#94a3b8;">Status</td><td style="padding:5px 12px;${border}font-size:12px;color:#e2e8f0;">${classification.classification.type}/${classification.classification.subtype} · ${michaelResult.recommended_team}${escalationTag}</td></tr>`);

  if (michaelResult.recommended_agent) {
    const reason = michaelResult.assignment_reasoning ? ` — ${linkifyUrls(michaelResult.assignment_reasoning)}` : "";
    rows.push(`<tr style="background:#1a2332;"><td style="padding:5px 12px;font-weight:600;width:80px;${border}font-size:11px;color:#93c5fd;">Assign</td><td style="padding:5px 12px;${border}font-size:11px;color:#dbeafe;line-height:1.4;"><strong>${michaelResult.recommended_agent}</strong>${reason} <span style="color:#64748b;font-size:9px;">· Suggestion for Bryanna</span></td></tr>`);
  }

  // Escalation reason (only if escalating)
  if (michaelResult.escalation_needed && michaelResult.escalation_reason) {
    rows.push(`<tr style="background:#3b2508;"><td style="padding:5px 12px;font-weight:700;width:80px;${border}font-size:11px;color:#fbbf24;">Why</td><td style="padding:5px 12px;${border}font-size:12px;color:#fcd34d;">${linkifyUrls(michaelResult.escalation_reason)}</td></tr>`);
  }

  if (michaelResult.workflow_reminder) {
    rows.push(`<tr style="background:#3b2508;"><td style="padding:5px 12px;font-weight:700;width:80px;${border}font-size:11px;color:#fbbf24;">Workflow</td><td style="padding:5px 12px;${border}font-size:11px;color:#fcd34d;line-height:1.4;">${linkifyUrls(michaelResult.workflow_reminder)}</td></tr>`);
  }

  const appContext = uniqueNonEmpty([
    ...toStringArray(michaelResult.connected_app_context),
    ...collectConnectedAppContext(findings),
  ]).slice(0, 4);
  if (appContext.length > 0) {
    rows.push(`<tr style="background:#162216;"><td style="padding:5px 12px;font-weight:600;width:80px;${border}font-size:11px;color:#4ade80;">Apps</td><td style="padding:5px 12px;${border}font-size:11px;color:#bbf7d0;line-height:1.4;">${formatBulletList(appContext)}</td></tr>`);
  }

  // Action items — keep short (formatTechNotes already applies linkifyUrls)
  const stepSource = michaelResult.troubleshooting_steps && michaelResult.troubleshooting_steps.length > 0
    ? michaelResult.troubleshooting_steps
    : michaelResult.internal_notes;
  const formattedNotes = formatTechNotes(stepSource);
  rows.push(`<tr style="background:#1a2332;"><td style="padding:5px 12px;font-weight:600;width:80px;${border}font-size:11px;color:#60a5fa;">Action</td><td style="padding:5px 12px;${border}font-size:11px;color:#bfdbfe;line-height:1.4;word-break:break-word;">${formattedNotes}</td></tr>`);

  // Suggested Customer Reply
  if (michaelResult.suggested_response) {
    rows.push(`<tr style="background:#1a2332;"><td style="padding:5px 12px;font-weight:600;width:80px;${border}font-size:11px;color:#38bdf8;">💬 Reply</td><td style="padding:5px 12px;${border}font-size:11px;color:#bae6fd;line-height:1.4;word-break:break-word;"><em style="color:#7dd3fc;">"${linkifyUrls(michaelResult.suggested_response)}"</em><br/><span style="font-size:9px;color:#64748b;">Suggestion only — edit before sending</span></td></tr>`);
  }

  // KB Article Suggestions
  // KB Ideas and Doc Gaps removed from retriage — they belong in the close review only

  // Priority recommendation lives in the header chip — no bottom row

  // Footer
  rows.push(`<tr style="background:#1E2028;"><td colspan="2" style="padding:3px 12px;color:#64748b;font-size:9px;text-align:right;">TriageIt AI · retriage · ${Object.keys(findings).length} agents</td></tr>`);

  return `<table style="font-family:'Segoe UI',Roboto,Arial,sans-serif;width:100%;max-width:100%;border-collapse:collapse;font-size:12px;color:#e2e8f0;border:1px solid #3a3f4b;background:#1E2028;border-radius:6px;overflow:hidden;">${rows.join("")}</table>`;
}

// ── Accountability Note ──────────────────────────────────────────────

export function buildAccountabilityNote(
  techName: string,
  haloId: number,
  urgencyScore: number,
  clientName: string | null,
): string {
  const urgencyLabel = urgencyScore >= 4 ? "CRITICAL" : urgencyScore >= 3 ? "HIGH" : "MEDIUM";
  const urgencyColor = urgencyScore >= 4 ? "#dc2626" : urgencyScore >= 3 ? "#f59e0b" : "#94a3b8";
  const clientLabel = clientName ? ` for <strong>${clientName}</strong>` : "";

  const rows: string[] = [];

  // Red header
  rows.push(
    `<tr><td colspan="2" style="padding:8px 12px;background:linear-gradient(135deg,#991b1b,#dc2626);color:white;font-size:12px;font-weight:700;">` +
    `🚩 No Progress Since Last Review</td></tr>`,
  );

  // Body
  rows.push(
    `<tr style="background:#2a1215;"><td colspan="2" style="padding:10px 12px;font-size:12px;color:#fca5a5;line-height:1.5;">` +
    `<strong>${techName}</strong> — ticket #${haloId}${clientLabel} was reviewed previously but <strong>no tech activity or customer communication</strong> has been logged since.<br/><br/>` +
    `<span style="color:${urgencyColor};font-weight:700;">Urgency: ${urgencyLabel} (${urgencyScore}/5)</span><br/>` +
    `Please update the customer or log an internal note with current status.` +
    `</td></tr>`,
  );

  // Footer
  rows.push(
    `<tr style="background:#1E2028;"><td colspan="2" style="padding:3px 12px;color:#64748b;font-size:9px;text-align:right;">` +
    `TriageIt AI · accountability check</td></tr>`,
  );

  return (
    `<table style="font-family:'Segoe UI',Roboto,Arial,sans-serif;width:100%;max-width:100%;border-collapse:collapse;` +
    `font-size:12px;color:#e2e8f0;border:2px solid #dc2626;background:#1E2028;border-radius:6px;overflow:hidden;">` +
    `${rows.join("")}</table>`
  );
}

// ── Fast Path Note Builders ──────────────────────────────────────────

export function buildFastPathNote(
  classification: {
    readonly classification: { readonly type: string; readonly subtype: string };
    readonly recommended_priority: number;
  },
  processingTime: number,
): string {
  return (
    `<table style="font-family:'Segoe UI',Roboto,Arial,sans-serif;width:100%;max-width:100%;border-collapse:collapse;background:#1E2028;border:1px solid #3a3f4b;border-radius:8px;overflow:hidden;">` +
    `<tr><td colspan="2" style="padding:10px 12px;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:white;font-size:15px;font-weight:700;">🤖 AI Triage — TriageIt<span style="float:right;font-weight:400;font-size:11px;opacity:0.8;">fast path · ${(processingTime / 1000).toFixed(1)}s</span></td></tr>` +
    `<tr style="background:#252830;"><td style="padding:8px 12px;font-weight:600;width:100px;border-bottom:1px solid #3a3f4b;font-size:13px;color:#94a3b8;">Classification</td><td style="padding:8px 12px;border-bottom:1px solid #3a3f4b;font-size:14px;color:#e2e8f0;"><strong>${classification.classification.type} / ${classification.classification.subtype}</strong></td></tr>` +
    `<tr style="background:#1E2028;"><td style="padding:8px 12px;font-weight:600;width:100px;border-bottom:1px solid #3a3f4b;font-size:13px;color:#4ade80;">Result</td><td style="padding:8px 12px;border-bottom:1px solid #3a3f4b;font-size:14px;color:#bbf7d0;">Notification / transactional — no action required. ${priorityLabel(classification.recommended_priority)}.</td></tr>` +
    `<tr style="background:#1E2028;"><td colspan="2" style="padding:6px 12px;color:#64748b;font-size:10px;text-align:right;">TriageIt AI · fast path · ${(processingTime / 1000).toFixed(1)}s</td></tr>` +
    `</table>`
  );
}

export function buildAlertPathNote(
  alertResult: {
    readonly alert_source: string;
    readonly alert_type: string;
    readonly affected_resource: string;
    readonly severity: string;
    readonly summary: string;
    readonly suggested_action: string;
    readonly actionable: boolean;
  },
  processingTime: number,
  similarTickets?: ReadonlyArray<SimilarTicket>,
): string {
  const severityColor =
    alertResult.severity === "critical" ? "#f87171"
      : alertResult.severity === "warning" ? "#fbbf24"
      : "#4ade80";
  const severityEmoji =
    alertResult.severity === "critical" ? "🔴"
      : alertResult.severity === "warning" ? "🟡"
      : "🟢";
  const actionBadge = alertResult.actionable
    ? `<span style="background:#dc2626;color:white;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;">ACTION NEEDED</span>`
    : `<span style="background:#059669;color:white;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;">INFO ONLY</span>`;

  // Build similar tickets row for alert note
  const alertSimilarRow = (similarTickets ?? []).length > 0
    ? (similarTickets ?? [])
        .map((t) => {
          const resolved = t.resolvedAt ? ` — <strong style="color:#4ade80;">RESOLVED</strong>` : "";
          return `<a href="#" style="color:#60a5fa;text-decoration:none;">⤴ #${t.haloId}</a> ${t.summary}${resolved} <span style="color:#64748b;font-size:11px;">(${(t.similarity * 100).toFixed(0)}% match${t.clientName ? `, ${t.clientName}` : ""})</span>`;
        })
        .join("<br/>")
    : "";

  const similarSection = alertSimilarRow
    ? `<tr style="background:#1a2332;"><td style="padding:8px 12px;font-weight:600;width:100px;border-bottom:1px solid #3a3f4b;font-size:13px;vertical-align:top;color:#818cf8;">🔗 Similar</td><td style="padding:8px 12px;border-bottom:1px solid #3a3f4b;font-size:13px;color:#c7d2fe;line-height:1.8;">${alertSimilarRow}<br/><span style="font-size:11px;color:#94a3b8;font-style:italic;">Check these tickets — a previous solution may apply here.</span></td></tr>`
    : "";

  return (
    `<table style="font-family:'Segoe UI',Roboto,Arial,sans-serif;width:100%;max-width:100%;border-collapse:collapse;background:#1E2028;border:1px solid #3a3f4b;border-radius:8px;overflow:hidden;">` +
    `<tr><td colspan="2" style="padding:10px 12px;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:white;font-size:15px;font-weight:700;">🤖 AI Triage — TriageIt<span style="float:right;font-weight:400;font-size:11px;opacity:0.8;">alert path · ${(processingTime / 1000).toFixed(1)}s</span></td></tr>` +
    `<tr style="background:#252830;"><td style="padding:8px 12px;font-weight:600;width:100px;border-bottom:1px solid #3a3f4b;font-size:13px;color:#94a3b8;">Source</td><td style="padding:8px 12px;border-bottom:1px solid #3a3f4b;font-size:14px;color:#e2e8f0;"><strong>${alertResult.alert_source}</strong> ${actionBadge}</td></tr>` +
    `<tr style="background:#1E2028;"><td style="padding:8px 12px;font-weight:600;width:100px;border-bottom:1px solid #3a3f4b;font-size:13px;color:#94a3b8;">Alert Type</td><td style="padding:8px 12px;border-bottom:1px solid #3a3f4b;font-size:14px;color:#e2e8f0;">${alertResult.alert_type}</td></tr>` +
    `<tr style="background:#252830;"><td style="padding:8px 12px;font-weight:600;width:100px;border-bottom:1px solid #3a3f4b;font-size:13px;color:#94a3b8;">Affected</td><td style="padding:8px 12px;border-bottom:1px solid #3a3f4b;font-size:14px;color:#e2e8f0;">${alertResult.affected_resource}</td></tr>` +
    `<tr style="background:#1E2028;"><td style="padding:8px 12px;font-weight:600;width:100px;border-bottom:1px solid #3a3f4b;font-size:13px;color:${severityColor};">${severityEmoji} Severity</td><td style="padding:8px 12px;border-bottom:1px solid #3a3f4b;font-size:14px;color:${severityColor};font-weight:700;">${alertResult.severity.toUpperCase()}</td></tr>` +
    `<tr style="background:#1a2332;"><td style="padding:8px 12px;font-weight:600;width:100px;border-bottom:1px solid #3a3f4b;font-size:13px;color:#60a5fa;">📋 Action</td><td style="padding:8px 12px;border-bottom:1px solid #3a3f4b;font-size:14px;color:#bfdbfe;">${linkifyUrls(alertResult.suggested_action)}</td></tr>` +
    `<tr style="background:#252830;"><td style="padding:8px 12px;font-weight:600;width:100px;border-bottom:1px solid #3a3f4b;font-size:13px;color:#94a3b8;">What is this</td><td style="padding:8px 12px;border-bottom:1px solid #3a3f4b;font-size:14px;color:#e2e8f0;">${linkifyUrls(alertResult.summary)}</td></tr>` +
    similarSection +
    `<tr style="background:#1E2028;"><td colspan="2" style="padding:6px 12px;color:#64748b;font-size:10px;text-align:right;">TriageIt AI · alert path · ${(processingTime / 1000).toFixed(1)}s</td></tr>` +
    `</table>`
  );
}

// ── Priority Recommendation Note ─────────────────────────────────────

export function buildPriorityRecommendationNote(
  currentPriority: number,
  recommendedPriority: number,
  urgencyReasoning: string,
): string {
  const direction = recommendedPriority < currentPriority ? "⬆ Upgrade" : "⬇ Downgrade";
  const dirColor = recommendedPriority < currentPriority ? "#f59e0b" : "#4ade80";

  return (
    `<table style="font-family:'Segoe UI',Roboto,Arial,sans-serif;width:100%;max-width:100%;border-collapse:collapse;background:#1E2028;border:1px solid #3a3f4b;border-radius:6px;overflow:hidden;">` +
    `<tr><td colspan="2" style="padding:8px 12px;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:white;font-size:12px;font-weight:600;">${direction} Priority Recommendation</td></tr>` +
    `<tr style="background:#252830;"><td style="padding:6px 12px;width:100px;font-size:12px;color:#94a3b8;border-bottom:1px solid #3a3f4b;">Current</td><td style="padding:6px 12px;font-size:13px;color:#e2e8f0;border-bottom:1px solid #3a3f4b;">${priorityLabel(currentPriority)}</td></tr>` +
    `<tr style="background:#1E2028;"><td style="padding:6px 12px;width:100px;font-size:12px;color:${dirColor};font-weight:600;border-bottom:1px solid #3a3f4b;">Recommended</td><td style="padding:6px 12px;font-size:13px;color:${dirColor};font-weight:700;border-bottom:1px solid #3a3f4b;">${priorityLabel(recommendedPriority)}</td></tr>` +
    `<tr style="background:#252830;"><td style="padding:6px 12px;width:100px;font-size:12px;color:#94a3b8;border-bottom:1px solid #3a3f4b;">Reason</td><td style="padding:6px 12px;font-size:12px;color:#cbd5e1;border-bottom:1px solid #3a3f4b;">${urgencyReasoning}</td></tr>` +
    `<tr style="background:#1E2028;"><td colspan="2" style="padding:4px 12px;color:#64748b;font-size:9px;text-align:right;">TriageIt AI · Priority Recommendation Only · Not Auto-Applied</td></tr>` +
    `</table>`
  );
}

// ── Documentation Gap Note ───────────────────────────────────────────

export function buildDocumentationGapNote(missingInfo: ReadonlyArray<string>): string {
  return (
    `<table style="font-family:'Segoe UI',Roboto,Arial,sans-serif;width:100%;max-width:100%;border-collapse:collapse;background:#1E2028;border:1px solid #3a3f4b;border-radius:8px;overflow:hidden;">` +
    `<tr><td style="padding:8px 12px;background:linear-gradient(135deg,#d97706,#f59e0b);color:white;font-size:13px;font-weight:700;">📝 Documentation Gap — Update Hudu After Resolution</td></tr>` +
    `<tr style="background:#332b1a;"><td style="padding:10px 14px;font-size:13px;color:#fde68a;line-height:1.6;">` +
    `<strong>Missing from Hudu:</strong><ul style="margin:6px 0;padding-left:20px;">` +
    missingInfo.map((info) => `<li>${info}</li>`).join("") +
    `</ul></td></tr>` +
    `<tr style="background:#1E2028;"><td style="padding:4px 12px;color:#64748b;font-size:9px;text-align:right;">TriageIt AI · Pam Beesly · Documentation Gap Alert</td></tr>` +
    `</table>`
  );
}

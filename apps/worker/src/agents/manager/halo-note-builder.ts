import type { AgentFinding } from "@triageit/shared";
import type { SimilarTicket } from "../similar-tickets.js";
import type { DuplicateCandidate } from "../duplicate-detector.js";

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
  oscar_martinez: "Oscar Martinez (Backup/Cove)",
};

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
      .filter(Boolean);
    if (steps.length > 0) {
      const items = steps.map((s) => `<li style="margin-bottom:6px;">${s}</li>`).join("");
      return `<ol style="margin:4px 0;padding-left:20px;list-style:decimal;">${items}</ol>`;
    }
  }

  const text = typeof notes === "string" ? notes : JSON.stringify(notes);

  // Try splitting on numbered patterns like "1)", "1.", "(1)", or "STEP 1:"
  const numbered = text.split(/(?:^|\s)(?:\d+[\).\-:]|\(\d+\))\s*/g).filter(Boolean);
  if (numbered.length > 1) {
    const items = numbered.map((item) => `<li style="margin-bottom:6px;">${item.trim()}</li>`).join("");
    return `<ol style="margin:4px 0;padding-left:20px;list-style:decimal;">${items}</ol>`;
  }

  // Try splitting on sentence boundaries
  const sentences = text.split(/(?<=\.)\s+(?=[A-Z])/).filter(Boolean);
  if (sentences.length > 2) {
    const items = sentences.map((s) => `<li style="margin-bottom:6px;">${s.trim()}</li>`).join("");
    return `<ol style="margin:4px 0;padding-left:20px;list-style:decimal;">${items}</ol>`;
  }

  return text;
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
    readonly root_cause_hypothesis: string;
    readonly internal_notes: string | string[];
    readonly escalation_needed: boolean;
    readonly escalation_reason: string | null;
  },
  findings: Record<string, AgentFinding>,
  processingTime: number,
  similarTickets?: ReadonlyArray<SimilarTicket>,
  duplicates?: ReadonlyArray<DuplicateCandidate>,
  slaInfo?: SlaInfo,
  branding?: BrandingConfig,
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
  rows.push(`<tr><td colspan="2" style="padding:10px 12px;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:white;font-size:15px;font-weight:700;">${logoHtml}AI Triage — ${brandName}<span style="float:right;font-weight:400;font-size:11px;opacity:0.8;">${agentCount} agents · ${(processingTime / 1000).toFixed(1)}s</span></td></tr>`);

  // SLA Breach — red alert banner, placed first for maximum visibility
  if (slaInfo?.breached) {
    const techName = slaInfo.assignedTech ?? "Assigned technician";
    const fixBy = slaInfo.fixByDate ? ` — Fix-by: ${new Date(slaInfo.fixByDate).toLocaleString()}` : "";
    const timer = slaInfo.timerText ? ` (${slaInfo.timerText})` : "";
    rows.push(`<tr style="background:#7f1d1d;"><td colspan="2" style="padding:10px 14px;font-size:14px;color:#fecaca;line-height:1.6;${border}"><strong style="color:#f87171;font-size:15px;">🚨 SLA BREACH — IMMEDIATE ACTION REQUIRED</strong><br/><strong>${techName}</strong>: The resolution SLA on this ticket has been breached${fixBy}${timer}. You must address this <strong>immediately</strong> — either resolve the issue and update the customer, or adjust the SLA target to the correct new completion date. Do not leave this ticket without an updated timeline.</td></tr>`);
  }

  // Classification
  rows.push(`<tr style="background:#252830;"><td ${td1}>Classification</td><td ${td2}><strong>${classification.classification.type} / ${classification.classification.subtype}</strong> <span style="color:#64748b;font-size:11px;">(${(classification.classification.confidence * 100).toFixed(0)}%)</span></td></tr>`);

  // Priority + Urgency merged into one row
  const urgencyColor = classification.urgency_score >= 4 ? "#f87171" : classification.urgency_score >= 3 ? "#f59e0b" : "#4ade80";
  const priorityColor = classification.recommended_priority <= 2 ? "#f87171" : classification.recommended_priority === 3 ? "#f59e0b" : "#4ade80";
  rows.push(`<tr style="background:#1E2028;"><td ${td1} style="padding:8px 12px;font-weight:600;width:100px;${border}font-size:13px;vertical-align:top;color:#94a3b8;">Priority</td><td ${td2}><strong style="color:${priorityColor};font-size:15px;">P${classification.recommended_priority}</strong> <span style="color:#64748b;">·</span> <strong style="color:${urgencyColor};">${classification.urgency_score}/5</strong> <span style="color:#64748b;font-size:11px;">urgency</span> <span style="color:#64748b;">·</span> <span style="color:#e2e8f0;">${michaelResult.recommended_team}</span></td></tr>`);
  if (classification.urgency_reasoning) {
    rows.push(`<tr style="background:#252830;"><td style="padding:4px 12px;${border}width:100px;"></td><td style="padding:4px 12px 8px;${border}font-size:12px;color:#94a3b8;line-height:1.4;word-break:break-word;">${classification.urgency_reasoning}</td></tr>`);
  }

  // Entities
  if (classification.entities.length > 0) {
    rows.push(`<tr style="background:#252830;"><td ${td1}>Entities</td><td ${td2}>${classification.entities.join(", ")}</td></tr>`);
  }

  // Security
  if (classification.security_flag) {
    rows.push(`<tr style="background:#3b1018;"><td style="padding:8px 12px;font-weight:700;width:100px;${border}font-size:13px;vertical-align:top;color:#f87171;">⚠ Security</td><td style="padding:8px 12px;${border}font-size:14px;color:#fca5a5;line-height:1.5;word-break:break-word;">${classification.security_notes}</td></tr>`);
  }

  // Escalation
  if (michaelResult.escalation_needed) {
    rows.push(`<tr style="background:#3b2508;"><td style="padding:8px 12px;font-weight:700;width:100px;${border}font-size:13px;vertical-align:top;color:#fbbf24;">⬆ Escalation</td><td style="padding:8px 12px;${border}font-size:14px;color:#fcd34d;line-height:1.5;word-break:break-word;">${michaelResult.escalation_reason}</td></tr>`);
  }

  // Root Cause — amber tinted dark background
  rows.push(`<tr style="background:#332b1a;"><td style="padding:8px 12px;font-weight:600;width:100px;${border}font-size:13px;vertical-align:top;color:#fbbf24;">🔍 Root Cause</td><td style="padding:8px 12px;${border}font-size:14px;color:#fde68a;line-height:1.5;word-break:break-word;">${michaelResult.root_cause_hypothesis}</td></tr>`);

  // Tech Notes — blue tinted dark background, parsed into numbered list
  const formattedNotes = formatTechNotes(michaelResult.internal_notes);
  rows.push(`<tr style="background:#1a2332;"><td style="padding:8px 12px;font-weight:600;width:100px;${border}font-size:13px;vertical-align:top;color:#60a5fa;">📋 Tech Notes</td><td style="padding:8px 12px;${border}font-size:13px;color:#bfdbfe;line-height:1.5;word-break:break-word;">${formattedNotes}</td></tr>`);

  // Specialist findings
  const specialists = Object.entries(findings).filter(([name]) => name !== "ryan_howard");
  if (specialists.length > 0) {
    rows.push(`<tr style="background:#1E2028;"><td colspan="2" style="padding:8px 12px;font-size:12px;font-weight:600;color:#94a3b8;${border}text-transform:uppercase;letter-spacing:0.5px;">Specialist Findings</td></tr>`);
    for (let i = 0; i < specialists.length; i++) {
      const [name, finding] = specialists[i];
      const label = AGENT_LABELS[name] ?? name;
      const bg = i % 2 === 0 ? "#252830" : "#1E2028";
      // Truncate long findings to keep the note compact
      const truncatedSummary = finding.summary.length > 300
        ? finding.summary.substring(0, 297) + "..."
        : finding.summary;
      rows.push(`<tr style="background:${bg};"><td style="padding:6px 12px;${border}font-size:12px;font-weight:600;color:#818cf8;width:100px;vertical-align:top;">${label}</td><td style="padding:6px 12px;${border}font-size:13px;color:#cbd5e1;line-height:1.4;word-break:break-word;">${truncatedSummary}</td></tr>`);
    }
  }

  // Quick Links — Hudu links and credentials from Dwight
  const dwightData = findings.dwight_schrute?.data;
  const huduLinks = (dwightData?.hudu_links as Array<{ label: string; url: string }>) ?? [];
  const relevantPasswords = (dwightData?.relevant_passwords as Array<{ name: string; type: string; note: string }>) ?? [];

  if (huduLinks.length > 0 || relevantPasswords.length > 0) {
    const linkItems = huduLinks
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

  // Similar tickets — actionable suggestions
  if (similarTickets && similarTickets.length > 0) {
    const similarItems = similarTickets
      .map((t) => {
        const resolved = t.resolvedAt ? ` — <strong style="color:#4ade80;">RESOLVED</strong>` : "";
        return `<a href="#" style="color:#60a5fa;text-decoration:none;">⤴ #${t.haloId}</a> ${t.summary}${resolved} <span style="color:#64748b;font-size:11px;">(${(t.similarity * 100).toFixed(0)}% match${t.clientName ? `, ${t.clientName}` : ""})</span>`;
      })
      .join("<br/>");
    const hasResolved = similarTickets.some((t) => t.resolvedAt);
    const hint = hasResolved
      ? `<br/><span style="font-size:11px;color:#94a3b8;font-style:italic;">💡 Check the resolved ticket(s) above — a previous fix may apply to this issue.</span>`
      : `<br/><span style="font-size:11px;color:#94a3b8;font-style:italic;">These tickets have similar context — cross-reference for patterns or related issues.</span>`;
    rows.push(`<tr style="background:#1a2332;"><td style="padding:8px 12px;font-weight:600;width:100px;${border}font-size:13px;vertical-align:top;color:#818cf8;">🔗 Similar</td><td style="padding:8px 12px;${border}font-size:13px;color:#c7d2fe;line-height:1.8;word-break:break-word;">${similarItems}${hint}</td></tr>`);
  }

  // Duplicate warnings
  if (duplicates && duplicates.length > 0) {
    const dupItems = duplicates
      .map((d) => `<strong style="color:#fbbf24;">#${d.haloId}</strong> ${d.summary} <span style="color:#64748b;font-size:11px;">(${(d.similarity * 100).toFixed(0)}% match)</span>`)
      .join("<br/>");
    rows.push(`<tr style="background:#3b2508;"><td style="padding:8px 12px;font-weight:600;width:100px;${border}font-size:13px;vertical-align:top;color:#fbbf24;">⚠ Duplicates</td><td style="padding:8px 12px;${border}font-size:13px;color:#fde68a;line-height:1.6;word-break:break-word;">${dupItems}<br/><span style="font-size:11px;color:#94a3b8;">Consider merging if same issue.</span></td></tr>`);
  }

  // Footer
  rows.push(`<tr style="background:#1E2028;"><td colspan="2" style="padding:6px 12px;color:#64748b;font-size:10px;text-align:right;">TriageIt AI · ${agentCount} agents · ${(processingTime / 1000).toFixed(1)}s</td></tr>`);

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
    readonly root_cause_hypothesis: string;
    readonly internal_notes: string | string[];
    readonly escalation_needed: boolean;
    readonly escalation_reason: string | null;
  },
  findings: Record<string, AgentFinding>,
  processingTime: number,
  slaInfo?: SlaInfo,
): string {
  const border = "border-bottom:1px solid #3a3f4b;";
  const rows: string[] = [];

  // Compact header
  rows.push(`<tr><td colspan="2" style="padding:8px 12px;background:linear-gradient(135deg,#4f46e5,#7c3aed);color:white;font-size:13px;font-weight:600;">📋 Retriage Check — TriageIt<span style="float:right;font-weight:400;font-size:10px;opacity:0.8;">${(processingTime / 1000).toFixed(1)}s</span></td></tr>`);

  // SLA Breach — red alert banner
  if (slaInfo?.breached) {
    const techName = slaInfo.assignedTech ?? "Assigned technician";
    const fixBy = slaInfo.fixByDate ? ` — Fix-by: ${new Date(slaInfo.fixByDate).toLocaleString()}` : "";
    const timer = slaInfo.timerText ? ` (${slaInfo.timerText})` : "";
    rows.push(`<tr style="background:#7f1d1d;"><td colspan="2" style="padding:8px 12px;font-size:13px;color:#fecaca;line-height:1.5;${border}"><strong style="color:#f87171;">🚨 SLA BREACHED</strong> — <strong>${techName}</strong>: Fix SLA immediately${fixBy}${timer}. Resolve the issue or update the SLA target date now.</td></tr>`);
  }

  // Status line
  rows.push(`<tr style="background:#252830;"><td style="padding:6px 12px;font-weight:600;width:100px;${border}font-size:12px;color:#94a3b8;">Status</td><td style="padding:6px 12px;${border}font-size:13px;color:#e2e8f0;">${classification.classification.type}/${classification.classification.subtype} · P${classification.recommended_priority} · ${michaelResult.recommended_team}</td></tr>`);

  // Escalation flag if needed
  if (michaelResult.escalation_needed) {
    rows.push(`<tr style="background:#3b2508;"><td style="padding:6px 12px;font-weight:700;width:100px;${border}font-size:12px;color:#fbbf24;">⬆ Escalate</td><td style="padding:6px 12px;${border}font-size:13px;color:#fcd34d;">${michaelResult.escalation_reason}</td></tr>`);
  }

  // Only include notes if they contain actionable info
  const formattedNotes = formatTechNotes(michaelResult.internal_notes);
  rows.push(`<tr style="background:#1a2332;"><td style="padding:6px 12px;font-weight:600;width:100px;${border}font-size:12px;color:#60a5fa;">Notes</td><td style="padding:6px 12px;${border}font-size:12px;color:#bfdbfe;line-height:1.4;word-break:break-word;">${formattedNotes}</td></tr>`);

  // Quick Links — Hudu links from Dwight (also in retriage)
  const dwightData = findings.dwight_schrute?.data;
  const huduLinks = (dwightData?.hudu_links as Array<{ label: string; url: string }>) ?? [];
  const relevantPasswords = (dwightData?.relevant_passwords as Array<{ name: string; type: string; note: string }>) ?? [];

  if (huduLinks.length > 0 || relevantPasswords.length > 0) {
    const linkItems = huduLinks
      .slice(0, 5) // Compact — only top 5 links
      .map((l) => `<a href="${l.url}" style="color:#60a5fa;text-decoration:underline;font-size:11px;">${l.label}</a>`)
      .join(" · ");
    const pwItems = relevantPasswords.slice(0, 5).map((p) => p.name).join(", ");
    const content = [
      linkItems,
      pwItems ? `<br/><span style="color:#94a3b8;font-size:10px;">Credentials: ${pwItems}</span>` : "",
    ]
      .filter(Boolean)
      .join("");
    rows.push(`<tr style="background:#162216;"><td style="padding:6px 12px;font-weight:600;width:100px;${border}font-size:11px;color:#4ade80;">📎 Links</td><td style="padding:6px 12px;${border}font-size:12px;color:#bbf7d0;line-height:1.4;word-break:break-word;">${content}</td></tr>`);
  }

  // Footer
  rows.push(`<tr style="background:#1E2028;"><td colspan="2" style="padding:4px 12px;color:#64748b;font-size:9px;text-align:right;">TriageIt AI · retriage</td></tr>`);

  return `<table style="font-family:'Segoe UI',Roboto,Arial,sans-serif;width:100%;max-width:100%;border-collapse:collapse;font-size:12px;color:#e2e8f0;border:1px solid #3a3f4b;background:#1E2028;border-radius:6px;overflow:hidden;">${rows.join("")}</table>`;
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
    `<tr style="background:#1E2028;"><td style="padding:8px 12px;font-weight:600;width:100px;border-bottom:1px solid #3a3f4b;font-size:13px;color:#4ade80;">Result</td><td style="padding:8px 12px;border-bottom:1px solid #3a3f4b;font-size:14px;color:#bbf7d0;">Notification / transactional — no action required. P${classification.recommended_priority} priority.</td></tr>` +
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
    `<tr style="background:#1a2332;"><td style="padding:8px 12px;font-weight:600;width:100px;border-bottom:1px solid #3a3f4b;font-size:13px;color:#60a5fa;">📋 Action</td><td style="padding:8px 12px;border-bottom:1px solid #3a3f4b;font-size:14px;color:#bfdbfe;">${alertResult.suggested_action}</td></tr>` +
    `<tr style="background:#252830;"><td style="padding:8px 12px;font-weight:600;width:100px;border-bottom:1px solid #3a3f4b;font-size:13px;color:#94a3b8;">What is this</td><td style="padding:8px 12px;border-bottom:1px solid #3a3f4b;font-size:14px;color:#e2e8f0;">${alertResult.summary}</td></tr>` +
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
    `<tr style="background:#252830;"><td style="padding:6px 12px;width:100px;font-size:12px;color:#94a3b8;border-bottom:1px solid #3a3f4b;">Current</td><td style="padding:6px 12px;font-size:13px;color:#e2e8f0;border-bottom:1px solid #3a3f4b;">P${currentPriority}</td></tr>` +
    `<tr style="background:#1E2028;"><td style="padding:6px 12px;width:100px;font-size:12px;color:${dirColor};font-weight:600;border-bottom:1px solid #3a3f4b;">Recommended</td><td style="padding:6px 12px;font-size:13px;color:${dirColor};font-weight:700;border-bottom:1px solid #3a3f4b;">P${recommendedPriority}</td></tr>` +
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

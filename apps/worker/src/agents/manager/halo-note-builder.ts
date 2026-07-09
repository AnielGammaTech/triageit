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
      .slice(0, 8);
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

/** Cap long specialist summaries inside the collapsed detail section. */
function truncateForDetail(text: string, maxChars: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, maxChars).replace(/\s+\S*$/, "")}…`;
}

/**
 * Collapsed "More detail" expander shared by the main triage note and the
 * compact retriage note. <details>/<summary> render collapsed in Halo's
 * agent UI (verified: tags survive Halo storage untouched) and degrade to
 * always-visible content if a renderer ever strips them.
 * Returns null when there is nothing worth expanding.
 */
function buildMoreDetailRow(params: {
  readonly findings: Record<string, AgentFinding>;
  readonly michaelResult: {
    readonly connected_app_context?: ReadonlyArray<string>;
  };
  readonly allLinks: ReadonlyArray<{ label: string; url: string }>;
  readonly relevantPasswords: ReadonlyArray<{ name: string; type: string; note: string }>;
  readonly urgencyReasoning?: string | null;
  readonly shownAppContextCount: number;
  readonly border: string;
}): string | null {
  const { findings, michaelResult, allLinks, relevantPasswords, urgencyReasoning, shownAppContextCount, border } = params;
  const detailBlocks: string[] = [];

  if (urgencyReasoning) {
    detailBlocks.push(
      `<div style="margin-bottom:8px;"><span style="color:#94a3b8;font-weight:600;font-size:11px;">URGENCY REASONING</span><br/><span style="color:#cbd5e1;">${linkifyUrls(urgencyReasoning)}</span></div>`,
    );
  }

  // Every specialist's own summary — Michael distills these into the rows
  // above, but the raw findings carry detail techs sometimes need
  const specialistBlocks = Object.entries(findings)
    .filter(([, f]) => (f.summary ?? "").trim().length > 0)
    .map(([name, f]) => {
      const label = AGENT_LABELS[name] ?? name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
      const conf = typeof f.confidence === "number" ? ` <span style="color:#64748b;font-size:10.5px;">${(f.confidence * 100).toFixed(0)}%</span>` : "";
      const summary = truncateForDetail(f.summary, 500);
      return `<div style="margin-bottom:7px;"><span style="color:#93c5fd;font-weight:600;">${label}</span>${conf}<br/><span style="color:#cbd5e1;">${linkifyKnownEntities(linkifyUrls(summary), allLinks)}</span></div>`;
    });
  if (specialistBlocks.length > 0) {
    detailBlocks.push(
      `<div style="margin-bottom:8px;"><span style="color:#94a3b8;font-weight:600;font-size:11px;">SPECIALIST FINDINGS (${specialistBlocks.length})</span></div>${specialistBlocks.join("")}`,
    );
  }

  // Angela's concrete action lists — trimmed from the slim note but
  // exactly what a tech wants when the ticket IS a security issue
  const angelaData = findings.angela_martin?.data;
  const immediateActions = toStringArray(angelaData?.immediate_actions).slice(0, 6);
  const investigationSteps = toStringArray(angelaData?.investigation_steps).slice(0, 6);
  if (immediateActions.length > 0 || investigationSteps.length > 0) {
    const items = [
      ...immediateActions.map((a) => `<li style="margin-bottom:3px;">${linkifyUrls(a)}</li>`),
      ...investigationSteps.map((s) => `<li style="margin-bottom:3px;color:#94a3b8;">${linkifyUrls(s)}</li>`),
    ].join("");
    detailBlocks.push(
      `<div style="margin-bottom:8px;"><span style="color:#f87171;font-weight:600;font-size:11px;">SECURITY ACTIONS &amp; INVESTIGATION</span><ol style="margin:4px 0 0 18px;padding:0;color:#fca5a5;">${items}</ol></div>`,
    );
  }

  // App context past the cap shown in the visible note
  const fullAppContext = uniqueNonEmpty([
    ...toStringArray(michaelResult.connected_app_context),
    ...collectConnectedAppContext(findings),
  ]);
  const overflowContext = fullAppContext.slice(shownAppContextCount, shownAppContextCount + 9);
  if (overflowContext.length > 0) {
    detailBlocks.push(
      `<div style="margin-bottom:8px;"><span style="color:#4ade80;font-weight:600;font-size:11px;">MORE APP CONTEXT</span><br/><span style="color:#bbf7d0;">${linkifyKnownEntities(formatBulletList(overflowContext), allLinks)}</span></div>`,
    );
  }

  // Credential pointers with their notes (slim note shows names only)
  if (relevantPasswords.length > 0) {
    const pwLines = relevantPasswords
      .slice(0, 6)
      .map((p) => `<li style="margin-bottom:2px;"><strong>${p.name}</strong>${p.type ? ` <span style="color:#64748b;">(${p.type})</span>` : ""}${p.note ? ` — ${p.note}` : ""}</li>`)
      .join("");
    detailBlocks.push(
      `<div style="margin-bottom:4px;"><span style="color:#4ade80;font-weight:600;font-size:11px;">CREDENTIALS IN HUDU</span><ul style="margin:4px 0 0 18px;padding:0;color:#bbf7d0;">${pwLines}</ul></div>`,
    );
  }

  if (detailBlocks.length === 0) return null;

  return (
    `<tr style="background:#1E2028;"><td colspan="2" style="padding:0;${border}">` +
    `<details style="margin:0;">` +
    `<summary style="cursor:pointer;padding:8px 12px;font-size:12px;font-weight:600;color:#94a3b8;list-style-position:inside;">▸ More detail — full specialist findings &amp; extended context <span style="font-weight:400;color:#64748b;">(click to expand)</span></summary>` +
    `<div style="padding:10px 14px;font-size:12px;line-height:1.55;border-top:1px solid #3a3f4b;">${detailBlocks.join("")}</div>` +
    `</details>` +
    `</td></tr>`
  );
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

/**
 * Hyperlink known entity names (devices, assets, credential entries) where
 * they're mentioned in note text, using the specialists' link lists.
 * "Bill-Office32" in App Context becomes a link to its Hudu/Datto page
 * instead of "(link in Hudu)" prose.
 */
function linkifyKnownEntities(
  html: string,
  links: ReadonlyArray<{ label: string; url: string }>,
): string {
  let out = html;
  for (const link of links) {
    // Meaningful tail of the label: "Computer Assets: Bill-Office32" →
    // "Bill-Office32"; strip "... in Hudu"-style suffixes
    const entity = (link.label.includes(":") ? link.label.split(":").pop()! : link.label)
      .replace(/\s+in\s+(hudu|datto(\s+rmm)?|cove|spanning|unifi)\s*$/i, "")
      .replace(/\s+passwords?\s*$/i, "")
      .trim();
    if (entity.length < 4) continue;

    const escaped = entity.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // First occurrence only, not already inside an anchor, not a partial word
    const re = new RegExp(`(?<![\\w-])(${escaped})(?![\\w-])(?![^<]*</a>)`, "i");
    if (re.test(out)) {
      out = out.replace(re, `<a href="${link.url}" style="color:#60a5fa;text-decoration:underline;">$1</a>`);
    }
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
  analyzedFiles?: ReadonlyArray<string>,
): string {
  const agentCount = Object.keys(findings).length;
  // Dark theme base styles
  const border = "border-bottom:1px solid #3a3f4b;";
  const td1 = `style="padding:8px 12px;font-weight:600;width:100px;${border}font-size:13px;vertical-align:top;white-space:nowrap;color:#94a3b8;"`;
  const td2 = `style="padding:8px 12px;${border}font-size:14px;color:#e2e8f0;line-height:1.5;word-break:break-word;"`;

  const rows: string[] = [];

  // Header — two-column hero band: brand identity left, classification
  // chip + run stats right. Table layout keeps it email/Halo-safe.
  const brandName = branding?.name ?? "TriageIt";
  const logoHtml = branding?.logoUrl
    ? `<img src="${branding.logoUrl}" alt="${brandName}" style="height:26px;width:auto;vertical-align:middle;margin-right:10px;border-radius:6px;" />`
    : "";
  // Priority suggestion lives as a small header chip — the ticket itself
  // already shows the current priority, so no dedicated rows for it
  const prioritySuggestion =
    originalPriority && classification.recommended_priority !== originalPriority
      ? `<span style="display:inline-block;background:rgba(255,255,255,0.22);border:1px solid rgba(255,255,255,0.3);padding:2px 9px;border-radius:11px;font-size:11px;font-weight:700;margin-right:6px;color:#fff;">Suggests ${priorityLabel(classification.recommended_priority)} ${classification.recommended_priority < originalPriority ? "⬆" : "⬇"}</span>`
      : "";
  const confidencePct = (classification.classification.confidence * 100).toFixed(0);
  const classificationChip = `<span style="display:inline-block;background:rgba(255,255,255,0.16);border:1px solid rgba(255,255,255,0.28);padding:3px 11px;border-radius:12px;font-size:11.5px;font-weight:700;color:#fff;text-transform:capitalize;">${classification.classification.type} / ${classification.classification.subtype}&nbsp;&nbsp;<span style="font-weight:600;opacity:0.75;">${confidencePct}%</span></span>`;
  rows.push(
    `<tr><td colspan="2" style="padding:0;">` +
      `<table width="100%" cellpadding="0" cellspacing="0" style="background:linear-gradient(120deg,#7f1d1d 0%,#991b1b 60%,#b91c1c 100%);">` +
      `<tr>` +
      `<td style="padding:13px 14px 12px;vertical-align:middle;">` +
      `${logoHtml}<span style="font-size:16px;font-weight:800;color:#fff;letter-spacing:0.01em;vertical-align:middle;">AI Triage</span>` +
      `<span style="font-size:10px;font-weight:700;color:rgba(255,255,255,0.6);margin-left:9px;vertical-align:middle;letter-spacing:0.14em;text-transform:uppercase;">${brandName}</span>` +
      `</td>` +
      `<td style="padding:13px 14px 12px;text-align:right;vertical-align:middle;white-space:nowrap;">` +
      `${prioritySuggestion}${classificationChip}` +
      `<div style="font-size:10px;color:rgba(255,255,255,0.65);margin-top:5px;letter-spacing:0.04em;">${agentCount} agents &middot; ${(processingTime / 1000).toFixed(1)}s</div>` +
      `</td>` +
      `</tr>` +
      `</table>` +
      `</td></tr>`,
  );

  // SLA Breach — red alert banner, placed first for maximum visibility
  if (slaInfo?.breached) {
    const techName = slaInfo.assignedTech ?? "Assigned technician";
    const fixBy = slaInfo.fixByDate ? ` — Fix-by: ${new Date(slaInfo.fixByDate).toLocaleString()}` : "";
    const timer = slaInfo.timerText ? ` (${slaInfo.timerText})` : "";
    rows.push(`<tr style="background:#7f1d1d;"><td colspan="2" style="padding:10px 14px;font-size:14px;color:#fecaca;line-height:1.6;${border}"><strong style="color:#f87171;font-size:15px;">🚨 SLA BREACH — IMMEDIATE ACTION REQUIRED</strong><br/><strong>${techName}</strong>: The resolution SLA on this ticket has been breached${fixBy}${timer}. You must address this <strong>immediately</strong> — either resolve the issue and update the customer, or adjust the SLA target to the correct new completion date. Do not leave this ticket without an updated timeline.</td></tr>`);
  }

  // Classification
  rows.push(`<tr style="background:#252830;"><td ${td1}>Classification</td><td ${td2}><strong>${classification.classification.type} / ${classification.classification.subtype}</strong> <span style="color:#64748b;font-size:11px;">(${(classification.classification.confidence * 100).toFixed(0)}%)</span></td></tr>`);

  // Specialist links collected up front so entity names anywhere in the
  // note can be hyperlinked in place
  const dwightData = findings.dwight_schrute?.data;
  const huduLinks = (dwightData?.hudu_links as Array<{ label: string; url: string }>) ?? [];
  const relevantPasswords = (dwightData?.relevant_passwords as Array<{ name: string; type: string; note: string }>) ?? [];
  const oscarLinks = (findings.oscar_martinez?.data?.quicklinks as Array<{ label: string; url: string }>) ?? [];
  const meredithLinks = (findings.meredith_palmer?.data?.quicklinks as Array<{ label: string; url: string }>) ?? [];
  const dattoDeviceLinks = (findings.andy_bernard?.data?.device_links as Array<{ label: string; url: string }>) ?? [];
  const allLinks = [...dattoDeviceLinks, ...huduLinks, ...oscarLinks, ...meredithLinks];

  // Dispatch — one compact row: assignment suggestion + workflow reminder
  {
    const dispatchLines: string[] = [];
    if (michaelResult.recommended_agent) {
      const reason = michaelResult.assignment_reasoning
        ? ` <span style="color:#94a3b8;">— ${linkifyUrls(michaelResult.assignment_reasoning)}</span>`
        : "";
      dispatchLines.push(`<strong style="color:#e2e8f0;">${michaelResult.recommended_agent}</strong> <span style="color:#64748b;">·</span> ${michaelResult.recommended_team}${reason}`);
    }
    if (michaelResult.workflow_reminder) {
      dispatchLines.push(`<span style="color:#fcd34d;">${linkifyUrls(michaelResult.workflow_reminder)}</span>`);
    }
    if (dispatchLines.length > 0) {
      rows.push(`<tr style="background:#1a2332;"><td style="padding:6px 12px;font-weight:700;width:100px;${border}font-size:12px;vertical-align:top;color:#93c5fd;">Dispatch</td><td style="padding:6px 12px;${border}font-size:12px;color:#dbeafe;line-height:1.5;word-break:break-word;">${dispatchLines.join("<br/>")}<br/><span style="font-size:10px;color:#64748b;">Suggestions for Bryanna — nothing auto-applied</span></td></tr>`);
    }
  }

  // Security
  if (classification.security_flag) {
    rows.push(`<tr style="background:#3b1018;"><td style="padding:8px 12px;font-weight:700;width:100px;${border}font-size:13px;vertical-align:top;color:#f87171;">⚠ Security</td><td style="padding:8px 12px;${border}font-size:14px;color:#fca5a5;line-height:1.5;word-break:break-word;">${linkifyUrls(classification.security_notes ?? "")}</td></tr>`);
  }

  // Escalation
  if (michaelResult.escalation_needed) {
    rows.push(`<tr style="background:#3b2508;"><td style="padding:8px 12px;font-weight:700;width:100px;${border}font-size:13px;vertical-align:top;color:#fbbf24;">⬆ Escalation</td><td style="padding:8px 12px;${border}font-size:14px;color:#fcd34d;line-height:1.5;word-break:break-word;">${linkifyUrls(michaelResult.escalation_reason ?? "")}</td></tr>`);
  }

  // Licensing — rendered straight from Holly's structured Pax8 output so a
  // license gap can never be buried by the synthesis. Only appears when
  // there is something actionable (mismatch, subscription problem, or a
  // concrete Pax8 action); "licensing is fine" stays in the expander.
  {
    const holly = findings.holly_flax?.data;
    if (holly) {
      const mismatch = holly.license_mismatch as
        | { detected?: boolean; current_plan?: string; needed_for?: string; recommended_plan?: string; explanation?: string }
        | undefined;
      const issues = toStringArray(holly.licensing_issues);
      const actions = toStringArray(holly.recommended_actions);
      const lines: string[] = [];
      if (mismatch?.detected) {
        const path = [mismatch.current_plan, mismatch.recommended_plan].filter(Boolean).join(" → ");
        lines.push(`<strong style="color:#fbcfe8;">${path || "License upgrade needed"}</strong>${mismatch.explanation ? ` — ${mismatch.explanation}` : mismatch.needed_for ? ` — needed for ${mismatch.needed_for}` : ""}`);
      }
      lines.push(...issues.slice(0, 2));
      if (actions.length > 0) {
        lines.push(`<span style="color:#f9a8d4;">Pax8 action: ${actions.slice(0, 2).join(" · ")}</span>`);
      }
      if (mismatch?.detected || issues.length > 0) {
        // Headline visible, essay collapsed — Holly's full reasoning ran
        // half a screen (user, 2026-07-09)
        const headlinePlain = (mismatch?.detected
          ? [mismatch.current_plan, mismatch.recommended_plan].filter(Boolean).join(" → ") || "license upgrade needed"
          : issues[0] ?? "subscription issue"
        ).replace(/<[^>]+>/g, "");
        const headline = headlinePlain.length > 90 ? `${headlinePlain.slice(0, 90).replace(/\s+\S*$/, "")}…` : headlinePlain;
        rows.push(
          `<tr style="background:#331a2b;"><td colspan="2" style="padding:0;${border}"><details style="margin:0;">` +
          `<summary style="cursor:pointer;padding:7px 12px;font-size:12.5px;font-weight:700;color:#f472b6;list-style-position:inside;">🪪 Licensing — <span style="color:#fbcfe8;font-weight:600;">${headline}</span> <span style="font-weight:400;color:#64748b;font-size:11px;">(click for detail &amp; Pax8 action)</span></summary>` +
          `<div style="padding:8px 12px;border-top:1px solid #3a3f4b;font-size:12.5px;color:#fbcfe8;line-height:1.55;word-break:break-word;">${lines.filter(Boolean).join("<br/>")}</div>` +
          `</details></td></tr>`,
        );
      }
    }
  }

  // Root Cause — amber tinted dark background (workflow reminder lives in
  // the Dispatch row); device/asset names hyperlinked in place
  rows.push(`<tr style="background:#332b1a;"><td style="padding:8px 12px;font-weight:600;width:100px;${border}font-size:13px;vertical-align:top;color:#fbbf24;">🔍 Root Cause</td><td style="padding:8px 12px;${border}font-size:14px;color:#fde68a;line-height:1.5;word-break:break-word;">${linkifyKnownEntities(linkifyUrls(michaelResult.root_cause_hypothesis), allLinks)}</td></tr>`);

  // Evidence row removed — root cause + app context carry the signal

  const appContext = uniqueNonEmpty([
    ...toStringArray(michaelResult.connected_app_context),
    ...collectConnectedAppContext(findings),
  ]).slice(0, 5);
  if (appContext.length > 0) {
    rows.push(`<tr style="background:#162216;"><td style="padding:8px 12px;font-weight:600;width:100px;${border}font-size:13px;vertical-align:top;color:#4ade80;">App Context</td><td style="padding:8px 12px;${border}font-size:13px;color:#bbf7d0;line-height:1.5;word-break:break-word;">${linkifyKnownEntities(formatBulletList(appContext), allLinks)}</td></tr>`);
  }

  // Quick Links — directly under App Context, above the Tech Plan, so the
  // tech sees the doors before the steps that walk through them
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

  // Tech plan — blue tinted dark background, parsed into numbered list
  const stepSource = michaelResult.troubleshooting_steps && michaelResult.troubleshooting_steps.length > 0
    ? michaelResult.troubleshooting_steps
    : michaelResult.internal_notes;
  const formattedNotes = linkifyKnownEntities(formatTechNotes(stepSource), allLinks);
  rows.push(`<tr style="background:#1a2332;"><td style="padding:8px 12px;font-weight:600;width:100px;${border}font-size:13px;vertical-align:top;color:#60a5fa;">Tech Plan</td><td style="padding:8px 12px;${border}font-size:13px;color:#bfdbfe;line-height:1.5;word-break:break-word;">${formattedNotes}</td></tr>`);

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

  // Collapsed deep-dive — full specialist findings and extended context the
  // slim note deliberately omits (shared with the retriage note)
  {
    const detailRow = buildMoreDetailRow({
      findings,
      michaelResult,
      allLinks,
      relevantPasswords,
      urgencyReasoning: classification.urgency_reasoning,
      shownAppContextCount: 5,
      border,
    });
    if (detailRow) rows.push(detailRow);
  }

  // Evidence trail — which attachments the AI actually read for this triage
  if (analyzedFiles && analyzedFiles.length > 0) {
    rows.push(
      `<tr style="background:#1E2028;"><td colspan="2" style="padding:6px 12px;font-size:10.5px;color:#64748b;">Analyzed attachments: ${analyzedFiles.map((f) => `<span style="color:#94a3b8;">${f}</span>`).join(" · ")}</td></tr>`,
    );
  }

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

  // Dispatch — assignment + workflow in one compact row
  {
    const dispatchLines: string[] = [];
    if (michaelResult.recommended_agent) {
      const reason = michaelResult.assignment_reasoning ? ` — ${linkifyUrls(michaelResult.assignment_reasoning)}` : "";
      dispatchLines.push(`<strong>${michaelResult.recommended_agent}</strong>${reason}`);
    }
    if (michaelResult.workflow_reminder) {
      dispatchLines.push(`<span style="color:#fcd34d;">${linkifyUrls(michaelResult.workflow_reminder)}</span>`);
    }
    if (dispatchLines.length > 0) {
      rows.push(`<tr style="background:#1a2332;"><td style="padding:5px 12px;font-weight:600;width:80px;${border}font-size:11px;color:#93c5fd;">Dispatch</td><td style="padding:5px 12px;${border}font-size:11px;color:#dbeafe;line-height:1.4;">${dispatchLines.join("<br/>")} <span style="color:#64748b;font-size:9px;">· Suggestions for Bryanna</span></td></tr>`);
    }
  }

  // Escalation reason (only if escalating)
  if (michaelResult.escalation_needed && michaelResult.escalation_reason) {
    rows.push(`<tr style="background:#3b2508;"><td style="padding:5px 12px;font-weight:700;width:80px;${border}font-size:11px;color:#fbbf24;">Why</td><td style="padding:5px 12px;${border}font-size:12px;color:#fcd34d;">${linkifyUrls(michaelResult.escalation_reason)}</td></tr>`);
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

  // Collapsed deep-dive — same expander as the main note; retriage is when
  // techs most often want the full specialist detail behind the summary
  {
    const dwightData = findings.dwight_schrute?.data;
    const retriageLinks = [
      ...((findings.andy_bernard?.data?.device_links as Array<{ label: string; url: string }>) ?? []),
      ...((dwightData?.hudu_links as Array<{ label: string; url: string }>) ?? []),
      ...((findings.oscar_martinez?.data?.quicklinks as Array<{ label: string; url: string }>) ?? []),
      ...((findings.meredith_palmer?.data?.quicklinks as Array<{ label: string; url: string }>) ?? []),
    ];
    const retriagePasswords = (dwightData?.relevant_passwords as Array<{ name: string; type: string; note: string }>) ?? [];
    const detailRow = buildMoreDetailRow({
      findings,
      michaelResult,
      allLinks: retriageLinks,
      relevantPasswords: retriagePasswords,
      shownAppContextCount: 4,
      border,
    });
    if (detailRow) rows.push(detailRow);
  }

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

/**
 * Branded Halo note for the automated SLA escalation phone calls — a proper
 * TriageIt header band + styled body, matching the triage/tech-review notes
 * (not the plain bold-text notes these used to be).
 */

function esc(t: string): string {
  return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

type Tone = "breach" | "info" | "noanswer";

const TONE: Record<Tone, { grad: string; chipBg: string; chipText: string; label: string }> = {
  breach: { grad: "linear-gradient(120deg,#b91c1c,#7f1d1d)", chipBg: "#7f1d1d", chipText: "#fecaca", label: "SLA CALL" },
  info: { grad: "linear-gradient(120deg,#b91c1c,#7f1d1d)", chipBg: "#7f1d1d", chipText: "#fecaca", label: "CALL" },
  noanswer: { grad: "linear-gradient(120deg,#b45309,#7c2d12)", chipBg: "#7c2d12", chipText: "#fed7aa", label: "NO ANSWER" },
};

export interface EscalationNoteOptions {
  readonly title: string;
  readonly tone?: Tone;
  /** e.g. "Matthew Lawyer · Jul 10, 10:18 AM" */
  readonly meta?: string | null;
  /** Lead sentence, plain text. */
  readonly intro?: string | null;
  /** Labeled rows, e.g. { label: "Reason given", value: "..." }. */
  readonly fields?: ReadonlyArray<{ readonly label: string; readonly value: string }>;
  /** Highlighted callout, e.g. the agreed next-action date. */
  readonly highlight?: { readonly label: string; readonly value: string } | null;
  /** Collapsed section (summary is escaped, html is raw pre-built markup). */
  readonly collapsed?: { readonly summary: string; readonly html: string } | null;
}

export function buildEscalationCallNote(opts: EscalationNoteOptions): string {
  const tone = TONE[opts.tone ?? "breach"];

  const header =
    `<tr><td style="padding:10px 14px;background:${tone.grad};">` +
    `<span style="color:#fff;font-size:13px;font-weight:700;letter-spacing:0.01em;">📞 ${esc(opts.title)}</span>` +
    `<span style="float:right;font-size:10px;font-weight:700;color:${tone.chipText};background:rgba(0,0,0,0.25);padding:2px 8px;border-radius:10px;letter-spacing:0.04em;">${tone.label}</span>` +
    `</td></tr>`;

  const metaRow = opts.meta
    ? `<tr><td style="padding:6px 14px;background:#1a1114;border-bottom:1px solid #3a1f24;font-size:11px;color:#a1a1aa;">${esc(opts.meta)}</td></tr>`
    : "";

  const bodyParts: string[] = [];
  if (opts.intro) {
    bodyParts.push(`<div style="color:#e2e8f0;">${esc(opts.intro)}</div>`);
  }
  for (const f of opts.fields ?? []) {
    bodyParts.push(
      `<div style="margin-top:8px;"><span style="color:#f87171;font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:0.03em;">${esc(f.label)}</span><br/>` +
        `<span style="color:#cbd5e1;">${esc(f.value)}</span></div>`,
    );
  }
  if (opts.highlight) {
    bodyParts.push(
      `<div style="margin-top:10px;padding:8px 12px;background:#1f1417;border-left:3px solid #dc2626;border-radius:4px;">` +
        `<span style="color:#fca5a5;font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:0.03em;">${esc(opts.highlight.label)}</span><br/>` +
        `<span style="color:#fff;font-weight:700;font-size:14px;">${esc(opts.highlight.value)}</span></div>`,
    );
  }
  const body = `<tr><td style="padding:12px 14px;font-size:12.5px;line-height:1.6;">${bodyParts.join("")}</td></tr>`;

  const collapsed = opts.collapsed
    ? `<tr><td style="padding:0 14px 12px;">` +
      `<details><summary style="cursor:pointer;color:#94a3b8;font-size:11.5px;">▸ ${esc(opts.collapsed.summary)}</summary>` +
      `<div style="padding:8px 0;line-height:1.6;font-size:12px;color:#cbd5e1;">${opts.collapsed.html}</div></details></td></tr>`
    : "";

  return (
    `<table style="border-collapse:collapse;width:100%;max-width:640px;border:1px solid #3a1f24;border-radius:10px;overflow:hidden;background:#151013;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">` +
    header +
    metaRow +
    body +
    collapsed +
    `</table>`
  );
}

"use client";

import { useState, useCallback, useEffect, type ReactNode } from "react";
import { KBBuilder } from "./kb-builder";
import {
  T,
  IconRefresh,
  IconSparkles,
  IconClipboardCheck,
  IconCopy,
  IconReply,
  IconBot,
  IconChevron,
  IconRadar,
  IconBrain,
  IconNote,
  IconActivity,
} from "./theme";

// ── Shared Button Style Helper ─────────────────────────────────────────

interface BtnStyle {
  readonly color: string;
  readonly bg: string;
  readonly border: string;
}

export function btnBase(s: BtnStyle): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    padding: "7px 12px",
    fontSize: "10.5px",
    fontWeight: 600,
    fontFamily: T.sans,
    color: s.color,
    backgroundColor: s.bg,
    border: `1px solid ${s.border}`,
    borderRadius: "7px",
    cursor: "pointer",
    transition: "border-color 0.18s ease, background-color 0.18s ease, color 0.18s ease, opacity 0.18s ease",
    whiteSpace: "nowrap" as const,
    letterSpacing: "0.01em",
    lineHeight: 1,
  };
}

function Spinner({ color }: { readonly color: string }) {
  return (
    <span
      style={{
        display: "inline-block",
        width: "10px",
        height: "10px",
        border: `1.5px solid ${color}40`,
        borderTopColor: color,
        borderRadius: "50%",
        animation: "spin 0.6s linear infinite",
      }}
    />
  );
}

// ── Copy Button ─────────────────────────────────────────────────────────

function CopyButton({
  text,
  label,
}: {
  readonly text: string;
  readonly label: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      try {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      } catch {
        const w = window.open("", "_blank", "width=500,height=300");
        if (w) {
          w.document.write(`<pre style="white-space:pre-wrap;font-size:13px;padding:16px;">${text.replace(/</g, "&lt;")}</pre>`);
          w.document.close();
        }
        return;
      }
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [text]);

  const style = copied
    ? btnBase({ color: T.green, bg: "rgba(61,220,132,0.08)", border: "rgba(61,220,132,0.28)" })
    : btnBase({ color: T.textMute, bg: T.surface1, border: T.line });

  return (
    <button onClick={handleCopy} style={style} className={copied ? undefined : "tg-btn-ghost"}>
      <IconCopy size={11} />
      {copied ? "Copied" : label}
    </button>
  );
}

// ── Re-Triage Button ────────────────────────────────────────────────────

function ReTriageButton({
  haloId,
  token,
}: {
  readonly haloId: number;
  readonly token: string;
}) {
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");

  const handleRetriage = useCallback(async () => {
    if (state === "loading") return;
    setState("loading");

    try {
      const response = await fetch("/api/embed/triage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ halo_id: haloId, token }),
      });

      if (response.ok) {
        setState("done");
        setTimeout(() => window.location.reload(), 5000);
      } else {
        setState("error");
        setTimeout(() => setState("idle"), 3000);
      }
    } catch {
      setState("error");
      setTimeout(() => setState("idle"), 3000);
    }
  }, [haloId, token, state]);

  const bg: Record<string, string> = {
    idle: `linear-gradient(135deg, ${T.brand}, ${T.brandDeep})`,
    loading: `linear-gradient(135deg, ${T.brand}, ${T.brandDeep})`,
    done: T.green,
    error: T.red,
  };

  const labels: Record<string, string> = {
    idle: "Re-Triage",
    loading: "Triaging...",
    done: "Queued",
    error: "Failed",
  };

  return (
    <button
      onClick={handleRetriage}
      disabled={state === "loading" || state === "done"}
      className="tg-btn-primary"
      style={{
        ...btnBase({ color: "#fff", bg: "transparent", border: "transparent" }),
        background: bg[state],
        fontWeight: 700,
        boxShadow: state === "idle" ? `0 2px 14px -4px ${T.brand}99` : "none",
        cursor: state === "loading" || state === "done" ? "not-allowed" : "pointer",
        opacity: state === "loading" ? 0.85 : 1,
      }}
    >
      {state === "loading" ? <Spinner color="#fff" /> : <IconRefresh size={11} color="#fff" />}
      {labels[state]}
    </button>
  );
}

// ── SummarizeIT Button ──────────────────────────────────────────────────

function SummarizeITButton({
  haloId,
  token,
}: {
  readonly haloId: number;
  readonly token: string;
}) {
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [summary, setSummary] = useState<string | null>(null);

  const handleSummarize = useCallback(async () => {
    if (state === "loading") return;
    setState("loading");
    setSummary(null);

    try {
      const response = await fetch("/api/embed/summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ halo_id: haloId, token }),
      });

      if (response.ok) {
        const data = (await response.json()) as { summary: string };
        setSummary(data.summary);
        setState("done");
      } else {
        setState("error");
        setTimeout(() => setState("idle"), 3000);
      }
    } catch {
      setState("error");
      setTimeout(() => setState("idle"), 3000);
    }
  }, [haloId, token, state]);

  const styles: Record<string, BtnStyle> = {
    idle: { color: T.amber, bg: "rgba(245,200,76,0.06)", border: "rgba(245,200,76,0.22)" },
    loading: { color: T.amber, bg: "rgba(245,200,76,0.10)", border: "rgba(245,200,76,0.28)" },
    done: { color: T.amber, bg: "rgba(245,200,76,0.06)", border: "rgba(245,200,76,0.22)" },
    error: { color: T.red, bg: "rgba(255,77,94,0.06)", border: "rgba(255,77,94,0.22)" },
  };

  const labels: Record<string, string> = {
    idle: "Summarize",
    loading: "Summarizing...",
    done: "Summarize",
    error: "Failed",
  };

  return (
    <>
      <button
        onClick={handleSummarize}
        disabled={state === "loading"}
        className="tg-btn-amber"
        style={{
          ...btnBase(styles[state]),
          cursor: state === "loading" ? "not-allowed" : "pointer",
          opacity: state === "loading" ? 0.85 : 1,
        }}
      >
        {state === "loading" ? <Spinner color={T.amber} /> : <IconSparkles size={11} />}
        {labels[state]}
      </button>

      {summary && (
        <div
          style={{
            gridColumn: "1 / -1",
            width: "100%",
            padding: "12px 14px",
            background: "linear-gradient(135deg, rgba(245,200,76,0.05), rgba(245,200,76,0.01))",
            border: "1px solid rgba(245,200,76,0.16)",
            borderRadius: "8px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "7px" }}>
            <IconSparkles size={10} color={T.amber} />
            <span style={{ fontSize: "9px", fontWeight: 700, color: T.amber, letterSpacing: "0.12em", fontFamily: T.mono }}>
              SUMMARY
            </span>
            <button
              onClick={() => { setState("idle"); setSummary(null); }}
              style={dismissBtnStyle}
              className="tg-btn-ghost"
            >
              dismiss
            </button>
          </div>
          <p style={{
            color: T.textSoft,
            margin: 0,
            whiteSpace: "pre-wrap" as const,
            fontSize: "11.5px",
            lineHeight: 1.65,
            fontFamily: T.sans,
          }}>
            {summary}
          </p>
        </div>
      )}
    </>
  );
}

// ── Suggest Customer Reply Button ───────────────────────────────────────

function SuggestReplyButton({
  haloId,
  token,
}: {
  readonly haloId: number;
  readonly token: string;
}) {
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [reply, setReply] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleSuggest = useCallback(async () => {
    if (state === "loading") return;
    setState("loading");

    try {
      const response = await fetch("/api/embed/suggest-reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ halo_id: haloId, token }),
      });

      if (response.ok) {
        const data = (await response.json()) as { reply: string };
        setReply(data.reply);
        setState("done");
      } else {
        setState("error");
        setTimeout(() => setState("idle"), 3000);
      }
    } catch {
      setState("error");
      setTimeout(() => setState("idle"), 3000);
    }
  }, [haloId, token, state]);

  const handleCopy = useCallback(async () => {
    if (!reply) return;
    try {
      await navigator.clipboard.writeText(reply);
    } catch {
      try {
        const textarea = document.createElement("textarea");
        textarea.value = reply;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      } catch {
        const w = window.open("", "_blank", "width=500,height=300");
        if (w) {
          w.document.write(`<pre style="white-space:pre-wrap;font-size:13px;padding:16px;">${reply.replace(/</g, "&lt;")}</pre>`);
          w.document.close();
        }
        return;
      }
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [reply]);

  if (state === "done" && reply) {
    return (
      <div style={{ gridColumn: "1 / -1", width: "100%" }}>
        <div style={{
          background: "linear-gradient(135deg, rgba(139,124,255,0.06), rgba(139,124,255,0.01))",
          border: "1px solid rgba(139,124,255,0.16)",
          borderRadius: "8px",
          padding: "12px 14px",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "7px" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "9px", fontWeight: 700, color: T.brand, letterSpacing: "0.12em", fontFamily: T.mono }}>
              <IconReply size={10} color={T.brand} />
              SUGGESTED REPLY
            </span>
            <div style={{ display: "flex", gap: "5px" }}>
              <button
                onClick={handleCopy}
                style={{
                  ...dismissBtnStyle,
                  marginLeft: 0,
                  color: copied ? T.green : T.textMute,
                  borderColor: copied ? "rgba(61,220,132,0.28)" : T.line,
                }}
                className="tg-btn-ghost"
              >
                {copied ? "copied" : "copy"}
              </button>
              <button
                onClick={() => { setState("idle"); setReply(null); }}
                style={{ ...dismissBtnStyle, marginLeft: 0 }}
                className="tg-btn-ghost"
              >
                dismiss
              </button>
            </div>
          </div>
          <p style={{ fontSize: "11.5px", color: T.textSoft, lineHeight: 1.65, margin: 0, whiteSpace: "pre-wrap" as const, fontFamily: T.sans }}>
            {reply}
          </p>
        </div>
      </div>
    );
  }

  const styles: Record<string, BtnStyle> = {
    idle: { color: T.textMute, bg: T.surface1, border: T.line },
    loading: { color: T.brand, bg: "rgba(139,124,255,0.08)", border: "rgba(139,124,255,0.22)" },
    error: { color: T.red, bg: "rgba(255,77,94,0.06)", border: "rgba(255,77,94,0.22)" },
    done: { color: T.green, bg: "rgba(61,220,132,0.06)", border: "rgba(61,220,132,0.22)" },
  };

  return (
    <button
      onClick={handleSuggest}
      disabled={state === "loading"}
      className="tg-btn-ghost"
      style={{
        ...btnBase(styles[state]),
        cursor: state === "loading" ? "not-allowed" : "pointer",
      }}
    >
      {state === "loading" ? <Spinner color={T.brand} /> : <IconReply size={11} />}
      {state === "error" ? "Failed" : state === "loading" ? "Generating..." : "Suggest Reply"}
    </button>
  );
}

// ── Ask Agent Dropdown Button ──────────────────────────────────────────

const INVOKABLE_AGENTS = [
  { id: "dwight_schrute", name: "Dwight", desc: "Hudu / KB", color: T.green },
  { id: "darryl_philbin", name: "Darryl", desc: "M365 / CIPP", color: T.blue },
  { id: "andy_bernard", name: "Andy", desc: "Datto RMM", color: T.teal },
  { id: "holly_flax", name: "Holly", desc: "Licensing", color: T.pink },
  { id: "angela_martin", name: "Angela", desc: "Security", color: T.red },
  { id: "jim_halpert", name: "Jim", desc: "Identity", color: T.brand },
  { id: "phyllis_vance", name: "Phyllis", desc: "Email/DNS", color: T.orange },
  { id: "creed_bratton", name: "Creed", desc: "UniFi", color: T.blue },
] as const;

function AskAgentButton({
  haloId,
  token,
}: {
  readonly haloId: number;
  readonly token: string;
}) {
  const [open, setOpen] = useState(false);
  const [invoking, setInvoking] = useState<string | null>(null);
  const [result, setResult] = useState<{ agentName: string; status: "done" | "error" } | null>(null);

  const handleInvoke = useCallback(async (agentId: string, agentName: string) => {
    setInvoking(agentId);
    setOpen(false);

    try {
      const response = await fetch("/api/embed/agent-invoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ halo_id: haloId, agent_name: agentId, token }),
      });

      if (response.ok) {
        setResult({ agentName, status: "done" });
        setInvoking(null);
        setTimeout(() => window.location.reload(), 2000);
        return;
      } else {
        setResult({ agentName, status: "error" });
      }
    } catch {
      setResult({ agentName, status: "error" });
    }

    setInvoking(null);
    setTimeout(() => setResult(null), 3000);
  }, [haloId, token]);

  useEffect(() => {
    if (!open) return;
    const handleClick = () => setOpen(false);
    const timer = setTimeout(() => document.addEventListener("click", handleClick), 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("click", handleClick);
    };
  }, [open]);

  const isLoading = invoking !== null;
  const label = isLoading
    ? `${INVOKABLE_AGENTS.find((a) => a.id === invoking)?.name ?? "..."}...`
    : result
      ? result.status === "done" ? `${result.agentName} done` : `${result.agentName} failed`
      : "Ask Agent";

  const color = isLoading ? T.brand : result ? (result.status === "done" ? T.green : T.red) : T.textMute;
  const bg = isLoading ? "rgba(139,124,255,0.08)" : result ? (result.status === "done" ? "rgba(61,220,132,0.08)" : "rgba(255,77,94,0.06)") : T.surface1;
  const border = isLoading ? "rgba(139,124,255,0.22)" : result ? (result.status === "done" ? "rgba(61,220,132,0.22)" : "rgba(255,77,94,0.22)") : T.line;

  return (
    <div style={{ position: "relative", display: "inline-block" }}>
      <button
        onClick={(e) => {
          e.stopPropagation();
          if (!isLoading) setOpen(!open);
        }}
        disabled={isLoading}
        className="tg-btn-ghost"
        style={{
          ...btnBase({ color, bg, border }),
          cursor: isLoading ? "not-allowed" : "pointer",
        }}
      >
        {isLoading ? <Spinner color={T.brand} /> : <IconBot size={12} />}
        {label}
        {!isLoading && !result && (
          <IconChevron
            size={10}
            color={T.textFaint}
            style={{ transform: open ? "rotate(-90deg)" : "rotate(90deg)", transition: "transform 0.15s ease" }}
          />
        )}
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            zIndex: 50,
            minWidth: "196px",
            background: T.surface2,
            border: `1px solid ${T.lineStrong}`,
            borderRadius: "9px",
            boxShadow: "0 12px 32px rgba(0,0,0,0.65)",
            overflow: "hidden",
            animation: "fadeIn 0.12s ease",
            padding: "4px",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {INVOKABLE_AGENTS.map((agent) => (
            <button
              key={agent.id}
              onClick={() => handleInvoke(agent.id, agent.name)}
              className="tg-menu-item"
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                width: "100%",
                padding: "7px 9px",
                backgroundColor: "transparent",
                border: "none",
                borderRadius: "6px",
                cursor: "pointer",
                fontFamily: T.sans,
                textAlign: "left" as const,
                transition: "background-color 0.12s ease",
              }}
            >
              <span style={{
                width: "6px",
                height: "6px",
                borderRadius: "50%",
                backgroundColor: agent.color,
                boxShadow: `0 0 6px ${agent.color}66`,
                flexShrink: 0,
              }} />
              <span style={{ fontSize: "11px", fontWeight: 600, color: T.text, minWidth: "52px" }}>
                {agent.name}
              </span>
              <span style={{ fontSize: "9.5px", color: T.textMute }}>
                {agent.desc}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Close Review Button ──────────────────────────────────────────────────

function CloseReviewButton({
  haloId,
  token,
}: {
  readonly haloId: number;
  readonly token: string;
}) {
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");

  const handleCloseReview = useCallback(async () => {
    if (state === "loading") return;
    setState("loading");

    try {
      const response = await fetch("/api/embed/close-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ halo_id: haloId, token }),
      });

      if (response.ok) {
        setState("done");
        setTimeout(() => window.location.reload(), 3000);
      } else {
        setState("error");
        setTimeout(() => setState("idle"), 3000);
      }
    } catch {
      setState("error");
      setTimeout(() => setState("idle"), 3000);
    }
  }, [haloId, token, state]);

  const styles: Record<string, BtnStyle> = {
    idle: { color: T.teal, bg: "rgba(45,212,191,0.06)", border: "rgba(45,212,191,0.22)" },
    loading: { color: T.teal, bg: "rgba(45,212,191,0.10)", border: "rgba(45,212,191,0.28)" },
    done: { color: T.green, bg: "rgba(61,220,132,0.10)", border: "rgba(61,220,132,0.28)" },
    error: { color: T.red, bg: "rgba(255,77,94,0.06)", border: "rgba(255,77,94,0.22)" },
  };

  const labels: Record<string, string> = {
    idle: "Close Review",
    loading: "Reviewing...",
    done: "Posted",
    error: "Failed",
  };

  return (
    <button
      onClick={handleCloseReview}
      disabled={state === "loading" || state === "done"}
      className="tg-btn-ghost"
      style={{
        ...btnBase(styles[state]),
        cursor: state === "loading" || state === "done" ? "not-allowed" : "pointer",
      }}
    >
      {state === "loading" ? <Spinner color={T.teal} /> : <IconClipboardCheck size={11} />}
      {labels[state]}
    </button>
  );
}

// ── Quick Action Bar ────────────────────────────────────────────────────

export function QuickActions({
  ticketId,
  haloId,
  suggestedResponse,
  internalNotes,
  token,
}: {
  readonly ticketId: string;
  readonly haloId: number;
  readonly suggestedResponse: string | null;
  readonly internalNotes: string | null;
  readonly token: string;
}) {
  void ticketId;
  return (
    <div style={{
      display: "flex",
      gap: "6px",
      flexWrap: "wrap" as const,
      alignItems: "flex-start",
    }}>
      {/* Primary actions */}
      <ReTriageButton haloId={haloId} token={token} />
      <SummarizeITButton haloId={haloId} token={token} />
      <CloseReviewButton haloId={haloId} token={token} />

      {/* Separator */}
      <div style={{ width: "1px", height: "26px", backgroundColor: T.line, alignSelf: "center" }} />

      {/* Secondary actions */}
      {suggestedResponse && <CopyButton text={suggestedResponse} label="Copy Resp" />}
      {internalNotes && <CopyButton text={internalNotes} label="Copy Notes" />}
      <SuggestReplyButton haloId={haloId} token={token} />
      <KBBuilder haloId={haloId} token={token} />
      <AskAgentButton haloId={haloId} token={token} />
    </div>
  );
}

// ── Collapsible Section ─────────────────────────────────────────────────

const SECTION_ICONS: Record<string, (props: { size?: number; color?: string }) => React.ReactElement> = {
  radar: (p) => <IconRadar {...p} />,
  brain: (p) => <IconBrain {...p} />,
  note: (p) => <IconNote {...p} />,
  activity: (p) => <IconActivity {...p} />,
};

export function CollapsibleSection({
  title,
  accent = T.brand,
  defaultOpen = false,
  badge,
  tag,
  icon,
  children,
}: {
  readonly title: string;
  readonly accent?: string;
  readonly defaultOpen?: boolean;
  readonly badge?: string;
  readonly tag?: string;
  readonly icon?: string;
  readonly children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const SectionIcon = icon ? SECTION_ICONS[icon] : undefined;

  return (
    <div style={{
      background: `linear-gradient(180deg, ${T.surface2}, ${T.surface1})`,
      border: `1px solid ${T.line}`,
      borderRadius: "9px",
      marginBottom: "7px",
      overflow: "hidden",
      position: "relative",
    }}>
      {/* Accent hairline */}
      <div style={{
        position: "absolute",
        top: 0,
        left: 0,
        bottom: 0,
        width: "2px",
        background: `linear-gradient(180deg, ${accent}, ${accent}33)`,
      }} />
      <button
        onClick={() => setOpen(!open)}
        className="tg-section-head"
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          width: "100%",
          padding: "9px 13px",
          backgroundColor: "transparent",
          border: "none",
          cursor: "pointer",
          textAlign: "left" as const,
          fontFamily: T.mono,
          transition: "background-color 0.15s ease",
        }}
      >
        <IconChevron
          size={10}
          color={accent}
          style={{
            transform: open ? "rotate(90deg)" : "rotate(0deg)",
            transition: "transform 0.18s ease",
            opacity: 0.7,
          }}
        />
        {SectionIcon && <SectionIcon size={11} color={accent} />}
        {tag && (
          <span style={{
            fontSize: "8px",
            fontWeight: 700,
            color: accent,
            backgroundColor: `${accent}18`,
            padding: "2px 6px",
            borderRadius: "4px",
            letterSpacing: "0.1em",
          }}>
            {tag}
          </span>
        )}
        <span style={{
          fontSize: "10px",
          fontWeight: 600,
          color: T.textSoft,
          textTransform: "uppercase" as const,
          letterSpacing: "0.1em",
          flex: 1,
        }}>
          {title}
        </span>
        {badge && (
          <span style={{
            fontSize: "9px",
            fontWeight: 500,
            color: T.textFaint,
          }}>
            {badge}
          </span>
        )}
      </button>
      {open && (
        <div style={{ padding: "2px 13px 12px 13px", animation: "fadeIn 0.18s ease" }}>{children}</div>
      )}
    </div>
  );
}

// ── Triage Button (for embed empty state) ────────────────────────────────

export function EmbedTriageButton({
  haloId,
  token,
}: {
  readonly haloId: number;
  readonly token: string;
}) {
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");

  const handleTriage = useCallback(async () => {
    if (state === "loading") return;
    setState("loading");

    try {
      const response = await fetch("/api/embed/triage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ halo_id: haloId, token }),
      });

      if (response.ok) {
        setState("done");
        const poll = setInterval(() => {
          window.location.reload();
        }, 5000);
        setTimeout(() => clearInterval(poll), 180_000);
      } else {
        setState("error");
        setTimeout(() => setState("idle"), 3000);
      }
    } catch {
      setState("error");
      setTimeout(() => setState("idle"), 3000);
    }
  }, [haloId, token, state]);

  return (
    <div style={{ display: "flex", flexDirection: "column" as const, alignItems: "center", gap: "10px" }}>
      <button
        onClick={handleTriage}
        disabled={state === "loading" || state === "done"}
        className="tg-btn-primary"
        style={{
          ...btnBase({ color: "#fff", bg: "transparent", border: "transparent" }),
          background:
            state === "done" ? T.green
            : state === "error" ? T.red
            : `linear-gradient(135deg, ${T.brand}, ${T.brandDeep})`,
          boxShadow: state === "idle" ? `0 4px 20px -6px ${T.brand}99` : "none",
          padding: "11px 26px",
          fontSize: "12px",
          fontWeight: 700,
          borderRadius: "9px",
          cursor: state === "loading" || state === "done" ? "not-allowed" : "pointer",
          opacity: state === "loading" ? 0.85 : 1,
        }}
      >
        {state === "loading" && <Spinner color="#fff" />}
        {state === "idle" && "Triage This Ticket"}
        {state === "loading" && "Triaging..."}
        {state === "done" && "Triaging -- refreshing..."}
        {state === "error" && "Failed -- Try Again"}
      </button>
      {state === "done" && (
        <span style={{ fontSize: "10px", color: T.textFaint }}>
          Auto-refreshing when complete
        </span>
      )}
    </div>
  );
}

// ── Auto Refresh (for triaging state) ────────────────────────────────────

export function AutoRefresh() {
  const [dots, setDots] = useState("");

  useEffect(() => {
    const interval = setInterval(() => {
      window.location.reload();
    }, 5000);
    const dotInterval = setInterval(() => {
      setDots((d) => (d.length >= 3 ? "" : d + "."));
    }, 500);
    return () => {
      clearInterval(interval);
      clearInterval(dotInterval);
    };
  }, []);

  return (
    <span style={{ fontSize: "10px", color: T.brand, opacity: 0.75, fontFamily: T.mono }}>
      auto-refreshing{dots}
    </span>
  );
}

// ── Shared small styles ─────────────────────────────────────────────────

const dismissBtnStyle: React.CSSProperties = {
  marginLeft: "auto",
  padding: "3px 8px",
  fontSize: "9px",
  fontWeight: 600,
  color: T.textMute,
  backgroundColor: "transparent",
  border: `1px solid ${T.line}`,
  borderRadius: "5px",
  cursor: "pointer",
  fontFamily: T.mono,
  transition: "color 0.15s ease, border-color 0.15s ease",
};

// ── Global styles (fonts, keyframes, hover classes) ─────────────────────

export function GlobalStyles() {
  return (
    <style
      dangerouslySetInnerHTML={{
        __html: `
          @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600;700&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap');

          * { box-sizing: border-box; }
          body { margin: 0; background: ${T.bg}; }

          ::-webkit-scrollbar { width: 5px; height: 5px; }
          ::-webkit-scrollbar-track { background: transparent; }
          ::-webkit-scrollbar-thumb { background: ${T.surface3}; border-radius: 3px; }
          ::-webkit-scrollbar-thumb:hover { background: ${T.lineStrong}; }

          ::selection { background: rgba(139,124,255,0.30); }

          @keyframes spin { to { transform: rotate(360deg); } }
          @keyframes fadeIn {
            from { opacity: 0; transform: translateY(3px); }
            to { opacity: 1; transform: translateY(0); }
          }
          @keyframes revealUp {
            from { opacity: 0; transform: translateY(8px); }
            to { opacity: 1; transform: translateY(0); }
          }
          @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.35; }
          }

          .tg-reveal { animation: revealUp 0.45s cubic-bezier(0.22, 1, 0.36, 1) both; }
          .tg-d1 { animation-delay: 0.05s; }
          .tg-d2 { animation-delay: 0.10s; }
          .tg-d3 { animation-delay: 0.16s; }
          .tg-d4 { animation-delay: 0.22s; }

          .tg-pulse { animation: pulse 1.8s ease-in-out infinite; }

          .tg-btn-primary:not(:disabled):hover { opacity: 0.88 !important; }
          .tg-btn-ghost:not(:disabled):hover {
            border-color: ${T.lineStrong} !important;
            color: ${T.textSoft} !important;
          }
          .tg-btn-amber:not(:disabled):hover { border-color: rgba(245,200,76,0.4) !important; }
          .tg-menu-item:hover { background-color: ${T.surface3} !important; }
          .tg-section-head:hover { background-color: rgba(140,150,190,0.04); }
          .tg-card { transition: border-color 0.18s ease, transform 0.18s ease; }
          .tg-card:hover { border-color: ${T.lineStrong}; }

          button:focus-visible, input:focus-visible {
            outline: 2px solid ${T.brand};
            outline-offset: 1px;
          }

          @media (prefers-reduced-motion: reduce) {
            .tg-reveal, .tg-pulse { animation: none !important; }
            * { transition-duration: 0.01ms !important; }
          }
        `,
      }}
    />
  );
}

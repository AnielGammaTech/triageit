"use client";

import { useState, useCallback, useEffect, type ReactNode } from "react";

// ── Shared Button Style Helper ─────────────────────────────────────────

interface BtnStyle {
  readonly color: string;
  readonly bg: string;
  readonly border: string;
  readonly hoverBg?: string;
  readonly hoverBorder?: string;
}

function btnBase(s: BtnStyle): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: "5px",
    padding: "6px 10px",
    fontSize: "10px",
    fontWeight: 600,
    fontFamily: "'JetBrains Mono', 'SF Mono', monospace",
    color: s.color,
    backgroundColor: s.bg,
    border: `1px solid ${s.border}`,
    borderRadius: "4px",
    cursor: "pointer",
    transition: "all 0.15s ease",
    whiteSpace: "nowrap" as const,
    letterSpacing: "0.02em",
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
    ? btnBase({ color: "#00b894", bg: "rgba(0,184,148,0.08)", border: "rgba(0,184,148,0.25)" })
    : btnBase({ color: "#636e72", bg: "#12131a", border: "#1e2028" });

  return (
    <button
      onClick={handleCopy}
      style={style}
      onMouseEnter={(e) => {
        if (!copied) {
          e.currentTarget.style.borderColor = "#2d3040";
          e.currentTarget.style.color = "#8b8fa3";
        }
      }}
      onMouseLeave={(e) => {
        if (!copied) {
          e.currentTarget.style.borderColor = "#1e2028";
          e.currentTarget.style.color = "#636e72";
        }
      }}
    >
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

  const styles: Record<string, BtnStyle> = {
    idle: { color: "#fff", bg: "#6c5ce7", border: "#6c5ce7" },
    loading: { color: "#fff", bg: "#6c5ce7", border: "#6c5ce7" },
    done: { color: "#fff", bg: "#00b894", border: "#00b894" },
    error: { color: "#fff", bg: "#ff4757", border: "#ff4757" },
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
      style={{
        ...btnBase(styles[state]),
        fontWeight: 700,
        cursor: state === "loading" || state === "done" ? "not-allowed" : "pointer",
        opacity: state === "loading" ? 0.8 : 1,
      }}
      onMouseEnter={(e) => {
        if (state === "idle") e.currentTarget.style.opacity = "0.85";
      }}
      onMouseLeave={(e) => {
        if (state === "idle") e.currentTarget.style.opacity = "1";
      }}
    >
      {state === "loading" && <Spinner color="#fff" />}
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
    idle: { color: "#fdcb6e", bg: "rgba(253,203,110,0.06)", border: "rgba(253,203,110,0.2)" },
    loading: { color: "#fdcb6e", bg: "rgba(253,203,110,0.1)", border: "rgba(253,203,110,0.25)" },
    done: { color: "#fdcb6e", bg: "rgba(253,203,110,0.06)", border: "rgba(253,203,110,0.2)" },
    error: { color: "#ff4757", bg: "rgba(255,71,87,0.06)", border: "rgba(255,71,87,0.2)" },
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
        style={{
          ...btnBase(styles[state]),
          cursor: state === "loading" ? "not-allowed" : "pointer",
          opacity: state === "loading" ? 0.8 : 1,
        }}
        onMouseEnter={(e) => {
          if (state !== "loading") {
            e.currentTarget.style.borderColor = "rgba(253,203,110,0.35)";
          }
        }}
        onMouseLeave={(e) => {
          if (state !== "loading") {
            e.currentTarget.style.borderColor = "rgba(253,203,110,0.2)";
          }
        }}
      >
        {state === "loading" && <Spinner color="#fdcb6e" />}
        {labels[state]}
      </button>

      {summary && (
        <div
          style={{
            gridColumn: "1 / -1",
            padding: "10px 12px",
            background: "rgba(253,203,110,0.04)",
            border: "1px solid rgba(253,203,110,0.12)",
            borderRadius: "4px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "6px" }}>
            <span style={{ fontSize: "9px", fontWeight: 800, color: "#fdcb6e", letterSpacing: "0.1em" }}>
              SUMMARY
            </span>
            <button
              onClick={() => { setState("idle"); setSummary(null); }}
              style={{
                marginLeft: "auto",
                padding: "2px 6px",
                fontSize: "9px",
                fontWeight: 600,
                color: "#636e72",
                backgroundColor: "transparent",
                border: "1px solid #1e2028",
                borderRadius: "3px",
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              dismiss
            </button>
          </div>
          <p style={{
            color: "#8b8fa3",
            margin: 0,
            whiteSpace: "pre-wrap" as const,
            fontSize: "11px",
            lineHeight: 1.6,
            fontFamily: "'Inter', system-ui, sans-serif",
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
      <div style={{ gridColumn: "1 / -1" }}>
        <div style={{
          backgroundColor: "rgba(162, 155, 254, 0.04)",
          border: "1px solid rgba(162, 155, 254, 0.12)",
          borderRadius: "4px",
          padding: "10px 12px",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
            <span style={{ fontSize: "9px", fontWeight: 800, color: "#a29bfe", letterSpacing: "0.1em" }}>
              SUGGESTED REPLY
            </span>
            <div style={{ display: "flex", gap: "4px" }}>
              <button
                onClick={handleCopy}
                style={{
                  padding: "2px 6px",
                  fontSize: "9px",
                  fontWeight: 600,
                  color: copied ? "#00b894" : "#636e72",
                  backgroundColor: "transparent",
                  border: `1px solid ${copied ? "rgba(0,184,148,0.25)" : "#1e2028"}`,
                  borderRadius: "3px",
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                {copied ? "copied" : "copy"}
              </button>
              <button
                onClick={() => { setState("idle"); setReply(null); }}
                style={{
                  padding: "2px 6px",
                  fontSize: "9px",
                  fontWeight: 600,
                  color: "#636e72",
                  backgroundColor: "transparent",
                  border: "1px solid #1e2028",
                  borderRadius: "3px",
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                dismiss
              </button>
            </div>
          </div>
          <p style={{ fontSize: "11px", color: "#8b8fa3", lineHeight: 1.6, margin: 0, whiteSpace: "pre-wrap" as const, fontFamily: "'Inter', system-ui, sans-serif" }}>
            {reply}
          </p>
        </div>
      </div>
    );
  }

  const styles: Record<string, BtnStyle> = {
    idle: { color: "#636e72", bg: "#12131a", border: "#1e2028" },
    loading: { color: "#a29bfe", bg: "rgba(162,155,254,0.08)", border: "rgba(162,155,254,0.2)" },
    error: { color: "#ff4757", bg: "rgba(255,71,87,0.06)", border: "rgba(255,71,87,0.2)" },
    done: { color: "#00b894", bg: "rgba(0,184,148,0.06)", border: "rgba(0,184,148,0.2)" },
  };

  return (
    <button
      onClick={handleSuggest}
      disabled={state === "loading"}
      style={{
        ...btnBase(styles[state]),
        cursor: state === "loading" ? "not-allowed" : "pointer",
      }}
      onMouseEnter={(e) => {
        if (state === "idle") {
          e.currentTarget.style.borderColor = "#2d3040";
          e.currentTarget.style.color = "#8b8fa3";
        }
      }}
      onMouseLeave={(e) => {
        if (state === "idle") {
          e.currentTarget.style.borderColor = "#1e2028";
          e.currentTarget.style.color = "#636e72";
        }
      }}
    >
      {state === "loading" && <Spinner color="#a29bfe" />}
      {state === "error" ? "Failed" : state === "loading" ? "Generating..." : "Suggest Reply"}
    </button>
  );
}

// ── Generate KB Button ──────────────────────────────────────────────────

function GenerateKBButton({
  haloId,
  token,
}: {
  readonly haloId: number;
  readonly token: string;
}) {
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");

  const handleGenerate = useCallback(async () => {
    if (state === "loading") return;
    setState("loading");

    try {
      const response = await fetch("/api/embed/kb-ideas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ halo_id: haloId, token }),
      });

      if (response.ok) {
        setState("done");
        setTimeout(() => window.location.reload(), 2000);
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
    idle: { color: "#636e72", bg: "#12131a", border: "#1e2028" },
    loading: { color: "#74b9ff", bg: "rgba(116,185,255,0.08)", border: "rgba(116,185,255,0.2)" },
    done: { color: "#00b894", bg: "rgba(0,184,148,0.08)", border: "rgba(0,184,148,0.2)" },
    error: { color: "#ff4757", bg: "rgba(255,71,87,0.06)", border: "rgba(255,71,87,0.2)" },
  };

  const labels: Record<string, string> = {
    idle: "Gen KB",
    loading: "Generating...",
    done: "KB Done",
    error: "Failed",
  };

  return (
    <button
      onClick={handleGenerate}
      disabled={state === "loading"}
      style={{
        ...btnBase(styles[state]),
        cursor: state === "loading" ? "not-allowed" : "pointer",
      }}
      onMouseEnter={(e) => {
        if (state === "idle") {
          e.currentTarget.style.borderColor = "#2d3040";
          e.currentTarget.style.color = "#8b8fa3";
        }
      }}
      onMouseLeave={(e) => {
        if (state === "idle") {
          e.currentTarget.style.borderColor = "#1e2028";
          e.currentTarget.style.color = "#636e72";
        }
      }}
    >
      {state === "loading" && <Spinner color="#74b9ff" />}
      {labels[state]}
    </button>
  );
}

// ── Ask Agent Dropdown Button ──────────────────────────────────────────

const INVOKABLE_AGENTS = [
  { id: "dwight_schrute", name: "Dwight", desc: "Hudu / KB", color: "#00b894" },
  { id: "darryl_philbin", name: "Darryl", desc: "M365 / CIPP", color: "#74b9ff" },
  { id: "andy_bernard", name: "Andy", desc: "Datto RMM", color: "#00cec9" },
  { id: "holly_flax", name: "Holly", desc: "Licensing", color: "#fd79a8" },
  { id: "angela_martin", name: "Angela", desc: "Security", color: "#ff4757" },
  { id: "jim_halpert", name: "Jim", desc: "Identity", color: "#a29bfe" },
  { id: "phyllis_vance", name: "Phyllis", desc: "Email/DNS", color: "#ff8c42" },
  { id: "creed_bratton", name: "Creed", desc: "UniFi", color: "#0984e3" },
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

  const color = isLoading ? "#a29bfe" : result ? (result.status === "done" ? "#00b894" : "#ff4757") : "#636e72";
  const bg = isLoading ? "rgba(162,155,254,0.08)" : result ? (result.status === "done" ? "rgba(0,184,148,0.08)" : "rgba(255,71,87,0.06)") : "#12131a";
  const border = isLoading ? "rgba(162,155,254,0.2)" : result ? (result.status === "done" ? "rgba(0,184,148,0.2)" : "rgba(255,71,87,0.2)") : "#1e2028";

  return (
    <div style={{ position: "relative", display: "inline-block" }}>
      <button
        onClick={(e) => {
          e.stopPropagation();
          if (!isLoading) setOpen(!open);
        }}
        disabled={isLoading}
        style={{
          ...btnBase({ color, bg, border }),
          cursor: isLoading ? "not-allowed" : "pointer",
        }}
        onMouseEnter={(e) => {
          if (!isLoading && !result) {
            e.currentTarget.style.borderColor = "#2d3040";
            e.currentTarget.style.color = "#8b8fa3";
          }
        }}
        onMouseLeave={(e) => {
          if (!isLoading && !result) {
            e.currentTarget.style.borderColor = "#1e2028";
            e.currentTarget.style.color = "#636e72";
          }
        }}
      >
        {isLoading && <Spinner color="#a29bfe" />}
        {label}
        {!isLoading && !result && (
          <span style={{ fontSize: "7px", opacity: 0.4 }}>{open ? "\u25B2" : "\u25BC"}</span>
        )}
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 3px)",
            left: 0,
            zIndex: 50,
            minWidth: "180px",
            background: "#12131a",
            border: "1px solid #1e2028",
            borderRadius: "4px",
            boxShadow: "0 8px 24px rgba(0,0,0,0.6)",
            overflow: "hidden",
            animation: "fadeIn 0.1s ease",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {INVOKABLE_AGENTS.map((agent) => (
            <button
              key={agent.id}
              onClick={() => handleInvoke(agent.id, agent.name)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                width: "100%",
                padding: "7px 10px",
                backgroundColor: "transparent",
                border: "none",
                cursor: "pointer",
                fontFamily: "'JetBrains Mono', 'SF Mono', monospace",
                textAlign: "left" as const,
                transition: "background-color 0.1s ease",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = "#1e2028";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = "transparent";
              }}
            >
              <span style={{
                width: "6px",
                height: "6px",
                borderRadius: "2px",
                backgroundColor: agent.color,
                flexShrink: 0,
              }} />
              <span style={{ fontSize: "10px", fontWeight: 700, color: "#c8ccd4", minWidth: "50px" }}>
                {agent.name}
              </span>
              <span style={{ fontSize: "9px", color: "#3d4051" }}>
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
    idle: { color: "#00cec9", bg: "rgba(0,206,201,0.06)", border: "rgba(0,206,201,0.2)" },
    loading: { color: "#00cec9", bg: "rgba(0,206,201,0.1)", border: "rgba(0,206,201,0.25)" },
    done: { color: "#00b894", bg: "rgba(0,184,148,0.1)", border: "rgba(0,184,148,0.25)" },
    error: { color: "#ff4757", bg: "rgba(255,71,87,0.06)", border: "rgba(255,71,87,0.2)" },
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
      style={{
        ...btnBase(styles[state]),
        cursor: state === "loading" || state === "done" ? "not-allowed" : "pointer",
      }}
      onMouseEnter={(e) => {
        if (state === "idle") {
          e.currentTarget.style.borderColor = "rgba(0,206,201,0.35)";
        }
      }}
      onMouseLeave={(e) => {
        if (state === "idle") {
          e.currentTarget.style.borderColor = "rgba(0,206,201,0.2)";
        }
      }}
    >
      {state === "loading" && <Spinner color="#00cec9" />}
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
      <div style={{ width: "1px", height: "24px", backgroundColor: "#1e2028", alignSelf: "center" }} />

      {/* Secondary actions */}
      {suggestedResponse && <CopyButton text={suggestedResponse} label="Copy Resp" />}
      {internalNotes && <CopyButton text={internalNotes} label="Copy Notes" />}
      <SuggestReplyButton haloId={haloId} token={token} />
      <GenerateKBButton haloId={haloId} token={token} />
      <AskAgentButton haloId={haloId} token={token} />
    </div>
  );
}

// ── Collapsible Section ─────────────────────────────────────────────────

export function CollapsibleSection({
  title,
  accent = "#6c5ce7",
  defaultOpen = false,
  badge,
  tag,
  children,
}: {
  readonly title: string;
  readonly accent?: string;
  readonly defaultOpen?: boolean;
  readonly badge?: string;
  readonly tag?: string;
  readonly children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div style={{
      background: "#12131a",
      border: "1px solid #1e2028",
      borderLeft: `2px solid ${accent}`,
      borderRadius: "4px",
      marginBottom: "6px",
      overflow: "hidden",
    }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          width: "100%",
          padding: "8px 12px",
          backgroundColor: "transparent",
          border: "none",
          cursor: "pointer",
          textAlign: "left" as const,
          fontFamily: "'JetBrains Mono', 'SF Mono', monospace",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = "#1a1b24";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = "transparent";
        }}
      >
        <span style={{
          fontSize: "8px",
          color: accent,
          transition: "transform 0.15s ease",
          transform: open ? "rotate(90deg)" : "rotate(0deg)",
          display: "inline-block",
          opacity: 0.6,
        }}>
          &#9654;
        </span>
        {tag && (
          <span style={{
            fontSize: "8px",
            fontWeight: 800,
            color: accent,
            backgroundColor: `${accent}15`,
            padding: "1px 5px",
            borderRadius: "2px",
            letterSpacing: "0.08em",
          }}>
            {tag}
          </span>
        )}
        <span style={{
          fontSize: "10px",
          fontWeight: 700,
          color: "#636e72",
          textTransform: "uppercase" as const,
          letterSpacing: "0.06em",
          flex: 1,
        }}>
          {title}
        </span>
        {badge && (
          <span style={{
            fontSize: "9px",
            fontWeight: 500,
            color: "#3d4051",
          }}>
            {badge}
          </span>
        )}
      </button>
      {open && (
        <div style={{ padding: "0 12px 10px 12px" }}>{children}</div>
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
        style={{
          ...btnBase({
            color: "#fff",
            bg: state === "done" ? "#00b894" : state === "error" ? "#ff4757" : "#6c5ce7",
            border: state === "done" ? "#00b894" : state === "error" ? "#ff4757" : "#6c5ce7",
          }),
          padding: "10px 24px",
          fontSize: "12px",
          fontWeight: 700,
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
        <span style={{ fontSize: "10px", color: "#3d4051" }}>
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
    <span style={{ fontSize: "10px", color: "#6c5ce7", opacity: 0.7, fontFamily: "'JetBrains Mono', 'SF Mono', monospace" }}>
      auto-refreshing{dots}
    </span>
  );
}

// ── Spinner keyframes ───────────────────────────────────────────────────

export function SpinnerStyles() {
  return (
    <style
      dangerouslySetInnerHTML={{
        __html: `
          @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700;800&display=swap');
          @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
          @keyframes fadeIn {
            from { opacity: 0; transform: translateY(2px); }
            to { opacity: 1; transform: translateY(0); }
          }
          * { box-sizing: border-box; }
          body { margin: 0; background: #0c0d10; }
          ::-webkit-scrollbar { width: 4px; }
          ::-webkit-scrollbar-track { background: transparent; }
          ::-webkit-scrollbar-thumb { background: #1e2028; border-radius: 2px; }
        `,
      }}
    />
  );
}

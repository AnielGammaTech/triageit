"use client";

import { useState, useCallback, useEffect, type ReactNode } from "react";

// ── Copy Button ─────────────────────────────────────────────────────────

function CopyButton({
  text,
  label,
  icon,
}: {
  readonly text: string;
  readonly label: string;
  readonly icon: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      // Try clipboard API first (works in top-level and permitted iframes)
      await navigator.clipboard.writeText(text);
    } catch {
      try {
        // Fallback for iframes: use textarea + execCommand
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      } catch {
        // Last resort for cross-origin iframes: open a small window with copyable text
        const w = window.open("", "_blank", "width=500,height=300");
        if (w) {
          w.document.write(`<pre style="white-space:pre-wrap;font-size:13px;padding:16px;">${text.replace(/</g, "&lt;")}</pre>`);
          w.document.close();
        }
        return; // Don't show "Copied!" since user needs to manually copy
      }
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [text]);

  return (
    <button
      onClick={handleCopy}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "6px",
        padding: "7px 14px",
        fontSize: "11px",
        fontWeight: 600,
        fontFamily: "inherit",
        color: copied ? "#34d399" : "#a1a1aa",
        backgroundColor: copied ? "rgba(52, 211, 153, 0.08)" : "rgba(255,255,255,0.03)",
        border: `1px solid ${copied ? "rgba(52, 211, 153, 0.25)" : "rgba(255,255,255,0.06)"}`,
        borderRadius: "8px",
        cursor: "pointer",
        transition: "all 0.2s ease",
        whiteSpace: "nowrap" as const,
        letterSpacing: "0.01em",
      }}
      onMouseEnter={(e) => {
        if (!copied) {
          e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.06)";
          e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)";
          e.currentTarget.style.color = "#d4d4d8";
        }
      }}
      onMouseLeave={(e) => {
        if (!copied) {
          e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.03)";
          e.currentTarget.style.borderColor = "rgba(255,255,255,0.06)";
          e.currentTarget.style.color = "#a1a1aa";
        }
      }}
    >
      <span style={{ fontSize: "13px" }}>{copied ? "\u2713" : icon}</span>
      {copied ? "Copied!" : label}
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
        // Auto-refresh after a short delay to show updated notes
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

  const config = {
    idle: { label: "Re-Triage", bg: "linear-gradient(135deg, #b91c1c, #4f46e5)", color: "#fff" },
    loading: { label: "Triaging...", bg: "linear-gradient(135deg, #b91c1c, #4f46e5)", color: "#fff" },
    done: { label: "Queued!", bg: "linear-gradient(135deg, #10b981, #059669)", color: "#fff" },
    error: { label: "Failed", bg: "linear-gradient(135deg, #ef4444, #dc2626)", color: "#fff" },
  } as const;

  const c = config[state];

  return (
    <button
      onClick={handleRetriage}
      disabled={state === "loading" || state === "done"}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "6px",
        padding: "7px 16px",
        fontSize: "11px",
        fontWeight: 700,
        fontFamily: "inherit",
        color: c.color,
        background: c.bg,
        border: "none",
        borderRadius: "8px",
        cursor: state === "loading" || state === "done" ? "not-allowed" : "pointer",
        transition: "all 0.2s ease",
        opacity: state === "loading" ? 0.8 : 1,
        whiteSpace: "nowrap" as const,
        letterSpacing: "0.02em",
        boxShadow: state === "idle" ? "0 1px 4px rgba(99, 102, 241, 0.3)" : "none",
      }}
      onMouseEnter={(e) => {
        if (state === "idle") {
          e.currentTarget.style.boxShadow = "0 2px 8px rgba(99, 102, 241, 0.45)";
          e.currentTarget.style.transform = "translateY(-1px)";
        }
      }}
      onMouseLeave={(e) => {
        if (state === "idle") {
          e.currentTarget.style.boxShadow = "0 1px 4px rgba(99, 102, 241, 0.3)";
          e.currentTarget.style.transform = "translateY(0)";
        }
      }}
    >
      {state === "loading" && (
        <span
          style={{
            display: "inline-block",
            width: "11px",
            height: "11px",
            border: "2px solid rgba(255,255,255,0.3)",
            borderTopColor: "#fff",
            borderRadius: "50%",
            animation: "spin 0.6s linear infinite",
          }}
        />
      )}
      {c.label}
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

  return (
    <>
      <button
        onClick={handleSummarize}
        disabled={state === "loading"}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "6px",
          padding: "7px 14px",
          fontSize: "11px",
          fontWeight: 700,
          fontFamily: "inherit",
          color: state === "done" ? "#fbbf24" : state === "error" ? "#f87171" : "#fbbf24",
          background: state === "loading"
            ? "rgba(251, 191, 36, 0.08)"
            : "linear-gradient(135deg, rgba(251, 191, 36, 0.12), rgba(251, 191, 36, 0.05))",
          border: "1px solid rgba(251, 191, 36, 0.2)",
          borderRadius: "8px",
          cursor: state === "loading" ? "not-allowed" : "pointer",
          transition: "all 0.2s ease",
          opacity: state === "loading" ? 0.8 : 1,
          whiteSpace: "nowrap" as const,
          letterSpacing: "0.01em",
        }}
        onMouseEnter={(e) => {
          if (state === "idle" || state === "done") {
            e.currentTarget.style.borderColor = "rgba(251, 191, 36, 0.35)";
            e.currentTarget.style.transform = "translateY(-1px)";
          }
        }}
        onMouseLeave={(e) => {
          if (state === "idle" || state === "done") {
            e.currentTarget.style.borderColor = "rgba(251, 191, 36, 0.2)";
            e.currentTarget.style.transform = "translateY(0)";
          }
        }}
      >
        {state === "loading" && (
          <span
            style={{
              display: "inline-block",
              width: "11px",
              height: "11px",
              border: "2px solid rgba(251, 191, 36, 0.3)",
              borderTopColor: "#fbbf24",
              borderRadius: "50%",
              animation: "spin 0.6s linear infinite",
            }}
          />
        )}
        {state === "error"
          ? "Failed"
          : state === "loading"
            ? "Summarizing..."
            : "SummarizeIT"}
      </button>

      {summary && (
        <div
          style={{
            width: "100%",
            marginTop: "10px",
            padding: "14px 16px",
            background: "linear-gradient(135deg, rgba(251, 191, 36, 0.06), rgba(251, 191, 36, 0.02))",
            border: "1px solid rgba(251, 191, 36, 0.15)",
            borderRadius: "10px",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              marginBottom: "8px",
            }}
          >
            <span style={{ fontSize: "12px", fontWeight: 700, color: "#fbbf24" }}>
              SummarizeIT
            </span>
            <span style={{ fontSize: "10px", color: "rgba(251, 191, 36, 0.4)" }}>
              Tech Activity Summary
            </span>
          </div>
          <p
            style={{
              color: "#d4d4d8",
              margin: 0,
              whiteSpace: "pre-wrap" as const,
              fontSize: "12px",
              lineHeight: 1.7,
            }}
          >
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
      <div style={{ width: "100%" }}>
        <div
          style={{
            backgroundColor: "rgba(99, 102, 241, 0.06)",
            border: "1px solid rgba(99, 102, 241, 0.15)",
            borderRadius: "10px",
            padding: "12px 14px",
            marginTop: "8px",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
            <span style={{ fontSize: "11px", fontWeight: 700, color: "#818cf8", letterSpacing: "0.03em", textTransform: "uppercase" as const }}>
              Suggested Customer Reply
            </span>
            <div style={{ display: "flex", gap: "6px" }}>
              <button
                onClick={handleCopy}
                style={{
                  padding: "4px 10px",
                  fontSize: "10px",
                  fontWeight: 600,
                  color: copied ? "#34d399" : "#a1a1aa",
                  backgroundColor: copied ? "rgba(52, 211, 153, 0.08)" : "rgba(255,255,255,0.04)",
                  border: `1px solid ${copied ? "rgba(52, 211, 153, 0.2)" : "rgba(255,255,255,0.06)"}`,
                  borderRadius: "6px",
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                {copied ? "Copied!" : "Copy"}
              </button>
              <button
                onClick={() => { setState("idle"); setReply(null); }}
                style={{
                  padding: "4px 10px",
                  fontSize: "10px",
                  fontWeight: 600,
                  color: "#a1a1aa",
                  backgroundColor: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.06)",
                  borderRadius: "6px",
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                Dismiss
              </button>
            </div>
          </div>
          <p style={{ fontSize: "12px", color: "#d4d4d8", lineHeight: 1.6, margin: 0, whiteSpace: "pre-wrap" as const }}>
            {reply}
          </p>
        </div>
      </div>
    );
  }

  const config = {
    idle: { label: "Suggest Reply", bg: "rgba(255,255,255,0.03)", color: "#a1a1aa", border: "rgba(255,255,255,0.06)" },
    loading: { label: "Generating...", bg: "rgba(99, 102, 241, 0.1)", color: "#818cf8", border: "rgba(99, 102, 241, 0.2)" },
    error: { label: "Failed", bg: "rgba(239, 68, 68, 0.1)", color: "#f87171", border: "rgba(239, 68, 68, 0.2)" },
    done: { label: "Done", bg: "rgba(52, 211, 153, 0.1)", color: "#34d399", border: "rgba(52, 211, 153, 0.2)" },
  } as const;

  const c = config[state];

  return (
    <button
      onClick={handleSuggest}
      disabled={state === "loading"}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "6px",
        padding: "7px 14px",
        fontSize: "11px",
        fontWeight: 600,
        fontFamily: "inherit",
        color: c.color,
        backgroundColor: c.bg,
        border: `1px solid ${c.border}`,
        borderRadius: "8px",
        cursor: state === "loading" ? "not-allowed" : "pointer",
        transition: "all 0.2s ease",
        whiteSpace: "nowrap" as const,
        letterSpacing: "0.01em",
      }}
      onMouseEnter={(e) => {
        if (state === "idle") {
          e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.06)";
          e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)";
          e.currentTarget.style.color = "#d4d4d8";
        }
      }}
      onMouseLeave={(e) => {
        if (state === "idle") {
          e.currentTarget.style.backgroundColor = c.bg;
          e.currentTarget.style.borderColor = c.border;
          e.currentTarget.style.color = c.color;
        }
      }}
    >
      {state === "loading" && (
        <span
          style={{
            display: "inline-block",
            width: "11px",
            height: "11px",
            border: "2px solid rgba(129, 140, 248, 0.3)",
            borderTopColor: "#818cf8",
            borderRadius: "50%",
            animation: "spin 0.6s linear infinite",
          }}
        />
      )}
      <span style={{ fontSize: "13px" }}>💬</span>
      {c.label}
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
        // Reload to show the KB note in TriageIT Notes
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

  const config = {
    idle: { label: "Generate KB", bg: "rgba(255,255,255,0.03)", color: "#a1a1aa", border: "rgba(255,255,255,0.06)" },
    loading: { label: "Generating...", bg: "rgba(14, 165, 233, 0.1)", color: "#38bdf8", border: "rgba(14, 165, 233, 0.2)" },
    done: { label: "KB Generated!", bg: "rgba(52, 211, 153, 0.1)", color: "#34d399", border: "rgba(52, 211, 153, 0.2)" },
    error: { label: "Failed", bg: "rgba(239, 68, 68, 0.1)", color: "#f87171", border: "rgba(239, 68, 68, 0.2)" },
  } as const;

  const c = config[state];

  return (
    <button
      onClick={handleGenerate}
      disabled={state === "loading"}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "6px",
        padding: "7px 14px",
        fontSize: "11px",
        fontWeight: 600,
        fontFamily: "inherit",
        color: c.color,
        backgroundColor: c.bg,
        border: `1px solid ${c.border}`,
        borderRadius: "8px",
        cursor: state === "loading" ? "not-allowed" : "pointer",
        transition: "all 0.2s ease",
        whiteSpace: "nowrap" as const,
        letterSpacing: "0.01em",
      }}
      onMouseEnter={(e) => {
        if (state === "idle") {
          e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.06)";
          e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)";
          e.currentTarget.style.color = "#d4d4d8";
        }
      }}
      onMouseLeave={(e) => {
        if (state === "idle") {
          e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.03)";
          e.currentTarget.style.borderColor = "rgba(255,255,255,0.06)";
          e.currentTarget.style.color = "#a1a1aa";
        }
      }}
    >
      {state === "loading" && (
        <span
          style={{
            display: "inline-block",
            width: "11px",
            height: "11px",
            border: "2px solid rgba(14, 165, 233, 0.3)",
            borderTopColor: "#38bdf8",
            borderRadius: "50%",
            animation: "spin 0.6s linear infinite",
          }}
        />
      )}
      <span style={{ fontSize: "13px" }}>{state === "done" ? "\u2713" : "\uD83D\uDCDA"}</span>
      {c.label}
    </button>
  );
}

// ── Ask Agent Dropdown Button ──────────────────────────────────────────

const INVOKABLE_AGENTS = [
  { id: "dwight_schrute", name: "Dwight", desc: "Hudu docs & KB", color: "#10b981" },
  { id: "darryl_philbin", name: "Darryl", desc: "M365 & CIPP", color: "#3b82f6" },
  { id: "andy_bernard", name: "Andy", desc: "Datto RMM", color: "#06b6d4" },
  { id: "holly_flax", name: "Holly", desc: "Licensing", color: "#ec4899" },
  { id: "angela_martin", name: "Angela", desc: "Security", color: "#ef4444" },
  { id: "jim_halpert", name: "Jim", desc: "Identity", color: "#8b5cf6" },
  { id: "phyllis_vance", name: "Phyllis", desc: "Email/DNS", color: "#f97316" },
  { id: "creed_bratton", name: "Creed", desc: "UniFi", color: "#0ea5e9" },
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
        // Reload to show agent findings
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

  // Close dropdown on outside click
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
  const buttonLabel = isLoading
    ? `Asking ${INVOKABLE_AGENTS.find((a) => a.id === invoking)?.name ?? "agent"}...`
    : result
      ? result.status === "done"
        ? `${result.agentName} responded!`
        : `${result.agentName} failed`
      : "Ask Agent";

  const buttonColor = isLoading
    ? "#a78bfa"
    : result
      ? result.status === "done" ? "#34d399" : "#f87171"
      : "#a1a1aa";

  const buttonBg = isLoading
    ? "rgba(167, 139, 250, 0.1)"
    : result
      ? result.status === "done" ? "rgba(52, 211, 153, 0.1)" : "rgba(239, 68, 68, 0.1)"
      : "rgba(255,255,255,0.03)";

  const buttonBorder = isLoading
    ? "rgba(167, 139, 250, 0.2)"
    : result
      ? result.status === "done" ? "rgba(52, 211, 153, 0.2)" : "rgba(239, 68, 68, 0.2)"
      : "rgba(255,255,255,0.06)";

  return (
    <div style={{ position: "relative", display: "inline-block" }}>
      <button
        onClick={(e) => {
          e.stopPropagation();
          if (!isLoading) setOpen(!open);
        }}
        disabled={isLoading}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "6px",
          padding: "7px 14px",
          fontSize: "11px",
          fontWeight: 600,
          fontFamily: "inherit",
          color: buttonColor,
          backgroundColor: buttonBg,
          border: `1px solid ${buttonBorder}`,
          borderRadius: "8px",
          cursor: isLoading ? "not-allowed" : "pointer",
          transition: "all 0.2s ease",
          whiteSpace: "nowrap" as const,
          letterSpacing: "0.01em",
        }}
        onMouseEnter={(e) => {
          if (!isLoading && !result) {
            e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.06)";
            e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)";
            e.currentTarget.style.color = "#d4d4d8";
          }
        }}
        onMouseLeave={(e) => {
          if (!isLoading && !result) {
            e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.03)";
            e.currentTarget.style.borderColor = "rgba(255,255,255,0.06)";
            e.currentTarget.style.color = "#a1a1aa";
          }
        }}
      >
        {isLoading && (
          <span
            style={{
              display: "inline-block",
              width: "11px",
              height: "11px",
              border: "2px solid rgba(167, 139, 250, 0.3)",
              borderTopColor: "#a78bfa",
              borderRadius: "50%",
              animation: "spin 0.6s linear infinite",
            }}
          />
        )}
        <span style={{ fontSize: "13px" }}>{result?.status === "done" ? "\u2713" : "\uD83E\uDD16"}</span>
        {buttonLabel}
        {!isLoading && !result && (
          <span style={{ fontSize: "8px", marginLeft: "2px", opacity: 0.5 }}>{open ? "\u25B2" : "\u25BC"}</span>
        )}
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            zIndex: 50,
            minWidth: "200px",
            background: "#1a1a1f",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: "10px",
            boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
            overflow: "hidden",
            animation: "fadeIn 0.15s ease",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={{ padding: "8px 12px", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
            <span style={{ fontSize: "10px", fontWeight: 700, color: "#52525b", textTransform: "uppercase" as const, letterSpacing: "0.08em" }}>
              Invoke Agent
            </span>
          </div>
          {INVOKABLE_AGENTS.map((agent) => (
            <button
              key={agent.id}
              onClick={() => handleInvoke(agent.id, agent.name)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "10px",
                width: "100%",
                padding: "9px 12px",
                backgroundColor: "transparent",
                border: "none",
                cursor: "pointer",
                fontFamily: "inherit",
                textAlign: "left" as const,
                transition: "background-color 0.15s ease",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.04)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = "transparent";
              }}
            >
              <span
                style={{
                  width: "8px",
                  height: "8px",
                  borderRadius: "50%",
                  backgroundColor: agent.color,
                  flexShrink: 0,
                  boxShadow: `0 0 6px ${agent.color}40`,
                }}
              />
              <span style={{ fontSize: "12px", fontWeight: 600, color: "#e4e4e7", minWidth: "55px" }}>
                {agent.name}
              </span>
              <span style={{ fontSize: "10px", color: "#52525b" }}>
                {agent.desc}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
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
  void ticketId; // kept for potential future use
  return (
    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" as const, alignItems: "center" }}>
      {suggestedResponse && (
        <CopyButton text={suggestedResponse} label="Copy Response" icon={"✉"} />
      )}
      {internalNotes && (
        <CopyButton text={internalNotes} label="Copy Notes" icon={"📋"} />
      )}
      <SuggestReplyButton haloId={haloId} token={token} />
      <SummarizeITButton haloId={haloId} token={token} />
      <GenerateKBButton haloId={haloId} token={token} />
      <AskAgentButton haloId={haloId} token={token} />
      <CloseReviewButton haloId={haloId} token={token} />
      <ReTriageButton haloId={haloId} token={token} />
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

  const config = {
    idle: { label: "Close Review", bg: "rgba(5, 150, 105, 0.08)", color: "#34d399", border: "rgba(52, 211, 153, 0.2)" },
    loading: { label: "Reviewing...", bg: "rgba(5, 150, 105, 0.12)", color: "#34d399", border: "rgba(52, 211, 153, 0.25)" },
    done: { label: "Posted!", bg: "rgba(5, 150, 105, 0.15)", color: "#34d399", border: "rgba(52, 211, 153, 0.3)" },
    error: { label: "Failed", bg: "rgba(239, 68, 68, 0.1)", color: "#f87171", border: "rgba(239, 68, 68, 0.2)" },
  } as const;

  const c = config[state];

  return (
    <button
      onClick={handleCloseReview}
      disabled={state === "loading" || state === "done"}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "6px",
        padding: "7px 14px",
        fontSize: "11px",
        fontWeight: 600,
        fontFamily: "inherit",
        color: c.color,
        backgroundColor: c.bg,
        border: `1px solid ${c.border}`,
        borderRadius: "8px",
        cursor: state === "loading" || state === "done" ? "not-allowed" : "pointer",
        transition: "all 0.2s ease",
        whiteSpace: "nowrap" as const,
        letterSpacing: "0.01em",
      }}
      onMouseEnter={(e) => {
        if (state === "idle") {
          e.currentTarget.style.backgroundColor = "rgba(5, 150, 105, 0.15)";
          e.currentTarget.style.borderColor = "rgba(52, 211, 153, 0.35)";
        }
      }}
      onMouseLeave={(e) => {
        if (state === "idle") {
          e.currentTarget.style.backgroundColor = c.bg;
          e.currentTarget.style.borderColor = c.border;
        }
      }}
    >
      {state === "loading" && (
        <span
          style={{
            display: "inline-block",
            width: "11px",
            height: "11px",
            border: "2px solid rgba(52, 211, 153, 0.3)",
            borderTopColor: "#34d399",
            borderRadius: "50%",
            animation: "spin 0.6s linear infinite",
          }}
        />
      )}
      <span style={{ fontSize: "13px" }}>{state === "done" ? "✓" : "✅"}</span>
      {c.label}
    </button>
  );
}

// ── Collapsible Section ─────────────────────────────────────────────────

export function CollapsibleSection({
  title,
  accent = "#b91c1c",
  defaultOpen = false,
  badge,
  children,
}: {
  readonly title: string;
  readonly accent?: string;
  readonly defaultOpen?: boolean;
  readonly badge?: string;
  readonly children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div
      style={{
        backgroundColor: "rgba(255,255,255,0.02)",
        border: "1px solid rgba(255,255,255,0.05)",
        borderLeft: `3px solid ${accent}`,
        borderRadius: "10px",
        marginBottom: "10px",
        overflow: "hidden",
        backdropFilter: "blur(8px)",
      }}
    >
      <button
        onClick={() => setOpen(!open)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          width: "100%",
          padding: "11px 16px",
          backgroundColor: "transparent",
          border: "none",
          cursor: "pointer",
          textAlign: "left" as const,
          fontFamily: "inherit",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.02)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = "transparent";
        }}
      >
        <span
          style={{
            fontSize: "9px",
            color: accent,
            transition: "transform 0.2s ease",
            transform: open ? "rotate(90deg)" : "rotate(0deg)",
            display: "inline-block",
            opacity: 0.7,
          }}
        >
          &#9654;
        </span>
        <span
          style={{
            fontSize: "11px",
            fontWeight: 700,
            color: "#a1a1aa",
            textTransform: "uppercase" as const,
            letterSpacing: "0.06em",
            flex: 1,
          }}
        >
          {title}
        </span>
        {badge && (
          <span
            style={{
              fontSize: "10px",
              fontWeight: 600,
              padding: "2px 8px",
              borderRadius: "10px",
              backgroundColor: `${accent}15`,
              color: accent,
              border: `1px solid ${accent}25`,
            }}
          >
            {badge}
          </span>
        )}
      </button>
      {open && (
        <div style={{ padding: "0 16px 14px 16px" }}>{children}</div>
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
        // Start polling for results
        const poll = setInterval(() => {
          window.location.reload();
        }, 5000);
        // Stop polling after 3 minutes
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
    <div style={{ display: "flex", flexDirection: "column" as const, alignItems: "center", gap: "12px" }}>
      <button
        onClick={handleTriage}
        disabled={state === "loading" || state === "done"}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "8px",
          padding: "10px 24px",
          fontSize: "13px",
          fontWeight: 700,
          fontFamily: "inherit",
          color: "#fff",
          background: state === "done"
            ? "linear-gradient(135deg, #10b981, #059669)"
            : state === "error"
              ? "linear-gradient(135deg, #ef4444, #dc2626)"
              : "linear-gradient(135deg, #b91c1c, #4f46e5)",
          border: "none",
          borderRadius: "10px",
          cursor: state === "loading" || state === "done" ? "not-allowed" : "pointer",
          transition: "all 0.2s ease",
          opacity: state === "loading" ? 0.85 : 1,
          boxShadow: state === "idle" ? "0 2px 12px rgba(99, 102, 241, 0.4)" : "none",
          letterSpacing: "0.02em",
        }}
      >
        {state === "loading" && (
          <span
            style={{
              display: "inline-block",
              width: "14px",
              height: "14px",
              border: "2px solid rgba(255,255,255,0.3)",
              borderTopColor: "#fff",
              borderRadius: "50%",
              animation: "spin 0.6s linear infinite",
            }}
          />
        )}
        {state === "idle" && "Triage This Ticket"}
        {state === "loading" && "Triaging..."}
        {state === "done" && "Triaging — refreshing..."}
        {state === "error" && "Failed — Try Again"}
      </button>
      {state === "done" && (
        <span style={{ fontSize: "11px", color: "#b91c1c", opacity: 0.7 }}>
          Page will refresh automatically when triage completes
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
    <span style={{ fontSize: "11px", color: "#b91c1c", opacity: 0.7 }}>
      Auto-refreshing{dots}
    </span>
  );
}

// ── Spinner keyframes ───────────────────────────────────────────────────

export function SpinnerStyles() {
  return (
    <style
      dangerouslySetInnerHTML={{
        __html: `
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
          @keyframes fadeIn {
            from { opacity: 0; transform: translateY(4px); }
            to { opacity: 1; transform: translateY(0); }
          }
          * { box-sizing: border-box; }
          body { margin: 0; }
          ::-webkit-scrollbar { width: 6px; }
          ::-webkit-scrollbar-track { background: transparent; }
          ::-webkit-scrollbar-thumb { background: #27272a; border-radius: 3px; }
        `,
      }}
    />
  );
}

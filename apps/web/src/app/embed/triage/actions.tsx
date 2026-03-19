"use client";

import { useState, useCallback, type ReactNode } from "react";

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
      await navigator.clipboard.writeText(text);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
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

function ReTriageButton({ ticketId }: { readonly ticketId: string }) {
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">(
    "idle",
  );

  const handleRetriage = useCallback(async () => {
    if (state === "loading") return;
    setState("loading");

    try {
      const response = await fetch("/api/triage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticket_id: ticketId }),
      });

      if (response.ok) {
        setState("done");
        setTimeout(() => window.location.reload(), 1500);
      } else {
        setState("error");
        setTimeout(() => setState("idle"), 3000);
      }
    } catch {
      setState("error");
      setTimeout(() => setState("idle"), 3000);
    }
  }, [ticketId, state]);

  const config = {
    idle: { label: "Re-Triage", bg: "linear-gradient(135deg, #6366f1, #4f46e5)", color: "#fff" },
    loading: { label: "Triaging...", bg: "linear-gradient(135deg, #6366f1, #4f46e5)", color: "#fff" },
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

function SummarizeITButton({ haloId }: { readonly haloId: number }) {
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [summary, setSummary] = useState<string | null>(null);

  const handleSummarize = useCallback(async () => {
    if (state === "loading") return;
    setState("loading");
    setSummary(null);

    try {
      const response = await fetch("/api/summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ halo_id: haloId }),
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
  }, [haloId, state]);

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

// ── Quick Action Bar ────────────────────────────────────────────────────

export function QuickActions({
  ticketId,
  haloId,
  suggestedResponse,
  internalNotes,
}: {
  readonly ticketId: string;
  readonly haloId: number;
  readonly suggestedResponse: string | null;
  readonly internalNotes: string | null;
}) {
  return (
    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" as const, alignItems: "center" }}>
      {suggestedResponse && (
        <CopyButton text={suggestedResponse} label="Copy Response" icon="\u2709" />
      )}
      {internalNotes && (
        <CopyButton text={internalNotes} label="Copy Notes" icon="\u270E" />
      )}
      <SummarizeITButton haloId={haloId} />
      <ReTriageButton ticketId={ticketId} />
    </div>
  );
}

// ── Collapsible Section ─────────────────────────────────────────────────

export function CollapsibleSection({
  title,
  accent = "#6366f1",
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

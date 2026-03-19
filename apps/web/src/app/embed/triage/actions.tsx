"use client";

import { useState, useCallback, type ReactNode } from "react";

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
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for iframes without clipboard permission
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [text]);

  return (
    <button
      onClick={handleCopy}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "6px",
        padding: "6px 12px",
        fontSize: "12px",
        fontWeight: 600,
        color: copied ? "#10b981" : "#d4d4d8",
        backgroundColor: copied ? "rgba(16, 185, 129, 0.1)" : "#18181b",
        border: `1px solid ${copied ? "rgba(16, 185, 129, 0.3)" : "#27272a"}`,
        borderRadius: "6px",
        cursor: "pointer",
        transition: "all 0.15s ease",
        whiteSpace: "nowrap" as const,
      }}
      onMouseEnter={(e) => {
        if (!copied) {
          e.currentTarget.style.backgroundColor = "#27272a";
          e.currentTarget.style.borderColor = "#3f3f46";
        }
      }}
      onMouseLeave={(e) => {
        if (!copied) {
          e.currentTarget.style.backgroundColor = "#18181b";
          e.currentTarget.style.borderColor = "#27272a";
        }
      }}
    >
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
        // Reload page after a brief pause to show success
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

  const labelMap = {
    idle: "Re-Triage",
    loading: "Triaging...",
    done: "Triggered!",
    error: "Failed",
  } as const;

  const colorMap = {
    idle: "#6366f1",
    loading: "#6366f1",
    done: "#10b981",
    error: "#ef4444",
  } as const;

  return (
    <button
      onClick={handleRetriage}
      disabled={state === "loading" || state === "done"}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "6px",
        padding: "6px 12px",
        fontSize: "12px",
        fontWeight: 600,
        color: "#fff",
        backgroundColor: colorMap[state],
        border: "none",
        borderRadius: "6px",
        cursor: state === "loading" || state === "done" ? "not-allowed" : "pointer",
        transition: "all 0.15s ease",
        opacity: state === "loading" ? 0.7 : 1,
        whiteSpace: "nowrap" as const,
      }}
      onMouseEnter={(e) => {
        if (state === "idle") {
          e.currentTarget.style.backgroundColor = "#4f46e5";
        }
      }}
      onMouseLeave={(e) => {
        if (state === "idle") {
          e.currentTarget.style.backgroundColor = "#6366f1";
        }
      }}
    >
      {state === "loading" && (
        <span
          style={{
            display: "inline-block",
            width: "12px",
            height: "12px",
            border: "2px solid rgba(255,255,255,0.3)",
            borderTopColor: "#fff",
            borderRadius: "50%",
            animation: "spin 0.6s linear infinite",
          }}
        />
      )}
      {labelMap[state]}
    </button>
  );
}

// ── Quick Action Bar ────────────────────────────────────────────────────

export function QuickActions({
  ticketId,
  suggestedResponse,
  internalNotes,
}: {
  readonly ticketId: string;
  readonly suggestedResponse: string | null;
  readonly internalNotes: string | null;
}) {
  return (
    <div
      style={{
        display: "flex",
        gap: "8px",
        flexWrap: "wrap" as const,
        alignItems: "center",
      }}
    >
      {suggestedResponse && (
        <CopyButton text={suggestedResponse} label="Copy Response" />
      )}
      {internalNotes && (
        <CopyButton text={internalNotes} label="Copy Notes" />
      )}
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
        backgroundColor: "#111113",
        border: "1px solid #1e1e22",
        borderLeft: `3px solid ${accent}`,
        borderRadius: "8px",
        marginBottom: "10px",
        overflow: "hidden",
      }}
    >
      <button
        onClick={() => setOpen(!open)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          width: "100%",
          padding: "10px 14px",
          backgroundColor: "transparent",
          border: "none",
          cursor: "pointer",
          textAlign: "left" as const,
        }}
      >
        <span
          style={{
            fontSize: "10px",
            color: "#71717a",
            transition: "transform 0.15s ease",
            transform: open ? "rotate(90deg)" : "rotate(0deg)",
            display: "inline-block",
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
            letterSpacing: "0.05em",
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
              padding: "1px 6px",
              borderRadius: "4px",
              backgroundColor: "rgba(99, 102, 241, 0.15)",
              color: "#818cf8",
              border: "1px solid rgba(99, 102, 241, 0.2)",
            }}
          >
            {badge}
          </span>
        )}
      </button>
      {open && (
        <div style={{ padding: "0 14px 12px 14px" }}>{children}</div>
      )}
    </div>
  );
}

// ── Spinner keyframes (injected once) ───────────────────────────────────

export function SpinnerStyles() {
  return (
    <style
      dangerouslySetInnerHTML={{
        __html: `
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
        `,
      }}
    />
  );
}

import { accentVar } from "@/components/browser-frame";
import { MockPanel } from "@/components/mock-ui";

const NAV = ["Command", "Dispatch", "Tickets", "SLA Hunter", "Prison Mike", "Toby"] as const;

const SPECIALISTS = [
  { initials: "MS", name: "Michael Scott", role: "Triage Manager", color: "#f59e0b" },
  { initials: "DS", name: "Dwight Schrute", role: "Documentation", color: "#10b981" },
  { initials: "AM", name: "Angela Martin", role: "Security Assessment", color: "#b91c1c" },
] as const;

export function TriageitMockup() {
  const accent = accentVar("triageit");
  return (
    <div
      className="mock-root overflow-hidden rounded-md border"
      style={
        {
          "--mock-bg": "#09090b",
          "--mock-panel": "#111113",
          "--mock-panel-2": "#18181b",
          "--mock-border": "#1e1e22",
          "--mock-text": "#fafafa",
          "--mock-muted": "rgba(255,255,255,0.5)",
          borderColor: "var(--mock-border)",
          background: "var(--mock-bg)",
        } as React.CSSProperties
      }
    >
      <div className="flex items-center gap-3 px-2.5 py-1.5" style={{ background: "#1a0a0a" }}>
        <span className="font-display text-[10px] font-bold tracking-tight">
          <span className="text-white">Triage</span>
          <span style={{ color: accent }}>IT</span>
        </span>
        <div className="flex items-center gap-2 text-[7px] font-medium">
          {NAV.map((item, i) => (
            <span
              key={item}
              className="pb-0.5"
              style={
                i === 2
                  ? { color: "#fff", borderBottom: `2px solid ${accent}` }
                  : { color: "rgba(255,255,255,0.45)" }
              }
            >
              {item}
            </span>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2 p-2.5 text-[color:var(--mock-text)]">
        <div className="flex flex-wrap items-center justify-between gap-1.5">
          <span className="font-display text-[11px] font-semibold">
            Ticket #4821 <span className="text-[color:var(--mock-muted)]">· Dunder Mifflin</span>
          </span>
          <div className="flex items-center gap-1">
            <span
              className="rounded-full px-1.5 py-0.5 text-[8px] font-medium"
              style={{ background: "rgba(185,28,28,0.18)", color: "#f87171" }}
            >
              Security
            </span>
            <span
              className="flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[8px] font-medium"
              style={{ background: "rgba(16,185,129,0.18)", color: "#34d399" }}
            >
              <span className="size-1 animate-pulse rounded-full bg-emerald-400" /> Live
            </span>
          </div>
        </div>

        <div className="flex gap-1.5">
          <span className="rounded-md px-1.5 py-1 text-[8px] font-medium text-white" style={{ background: "#b45309" }}>
            SummarizeIT
          </span>
          <span className="rounded-md px-1.5 py-1 text-[8px] font-medium text-white" style={{ background: accent }}>
            Re-triage
          </span>
          <span className="rounded-md px-1.5 py-1 text-[8px] font-medium text-white" style={{ background: "#4f46e5" }}>
            Ask Agent
          </span>
        </div>

        <div
          className="grid grid-cols-4 gap-1.5 rounded-lg border p-2"
          style={{ borderColor: "var(--mock-border)", background: "var(--mock-panel)" }}
        >
          {[
            { label: "Classification", value: "Email / M365", color: undefined },
            { label: "AI Priority", value: "P2 · Urgency 4/5", color: "#f97316" },
            { label: "Team", value: "Escalation", color: undefined },
            { label: "Security", value: "Flagged", color: "#f87171" },
          ].map((cell) => (
            <div key={cell.label} className="flex flex-col gap-0.5">
              <span className="text-[7px] uppercase tracking-wider text-[color:var(--mock-muted)]">
                {cell.label}
              </span>
              <span className="text-[9px] font-medium" style={cell.color ? { color: cell.color } : undefined}>
                {cell.value}
              </span>
            </div>
          ))}
        </div>

        <MockPanel title="Specialist findings" accent={accent}>
          {SPECIALISTS.map((s) => (
            <div key={s.initials} className="flex items-center gap-1.5">
              <span
                className="flex size-4 shrink-0 items-center justify-center rounded-full text-[7px] font-semibold text-white"
                style={{ background: s.color }}
              >
                {s.initials}
              </span>
              <span className="truncate text-[9px]">
                {s.name} <span className="text-[color:var(--mock-muted)]">— {s.role}</span>
              </span>
            </div>
          ))}
        </MockPanel>
      </div>
    </div>
  );
}

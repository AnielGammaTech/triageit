"use client";

import { accentVar } from "@/components/browser-frame";
import { MockupTabButton, MockupViewport, useMockupView } from "../mockup-tabs";
import { TicketDetailView } from "./ticket-detail";
import { TicketsListView } from "./tickets-list";
import { SlaHunterView } from "./sla-hunter";

const NAV = ["Command", "Dispatch", "Tickets", "SLA Hunter", "Prison Mike", "Toby"] as const;

type View = "tickets-list" | "ticket-detail" | "sla-hunter";

// Only the nav items with a real, spec'd secondary screen are wired up;
// Command / Prison Mike / Toby stay inert (default cursor, no-op) same as
// every other non-nav element in the mockup.
const NAV_VIEW: Partial<Record<(typeof NAV)[number], View>> = {
  Dispatch: "tickets-list",
  Tickets: "ticket-detail",
  "SLA Hunter": "sla-hunter",
};

export function TriageitMockup() {
  const accent = accentVar("triageit");
  const [view, setView] = useMockupView<View>("ticket-detail");

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
          {NAV.map((item) => {
            const linkedView = NAV_VIEW[item];
            if (!linkedView) {
              return (
                <span key={item} className="pb-0.5" style={{ color: "rgba(255,255,255,0.45)" }}>
                  {item}
                </span>
              );
            }
            return (
              <MockupTabButton
                key={item}
                view={linkedView}
                label={item}
                active={view === linkedView}
                onSelect={setView}
                className="pb-0.5"
                activeStyle={{ color: "#fff", borderBottom: `2px solid ${accent}` }}
                idleStyle={{ color: "rgba(255,255,255,0.45)", borderBottom: "2px solid transparent" }}
              />
            );
          })}
        </div>
      </div>

      <MockupViewport view={view}>
        {view === "ticket-detail" ? <TicketDetailView accent={accent} /> : null}
        {view === "tickets-list" ? <TicketsListView /> : null}
        {view === "sla-hunter" ? <SlaHunterView /> : null}
      </MockupViewport>
    </div>
  );
}

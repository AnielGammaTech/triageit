"use client";

import { MockupTabButton, MockupViewport, useMockupView } from "../mockup-tabs";
import { DashboardView } from "./dashboard";
import { InvoicesView } from "./invoices";
import { SupportView } from "./support";

type View = "dashboard" | "invoices" | "support";

const TABS: readonly { label: string; view: View }[] = [
  { label: "Dashboard", view: "dashboard" },
  { label: "Invoices", view: "invoices" },
  { label: "Support", view: "support" },
];

// Client-facing view (task 17 re-skin) — PortalIT's audience is the
// customer, not Gamma Tech staff. Chrome matches the staff build's
// slate-900/violet-700 theme (.superpowers/sdd/ui-specs/portalit.md).
export function PortalitMockup() {
  const [view, setView] = useMockupView<View>("dashboard");

  return (
    <div
      className="mock-root overflow-hidden rounded-md border"
      style={
        {
          "--mock-bg": "#f8fafc",
          "--mock-panel": "#ffffff",
          "--mock-panel-2": "#f1f5f9",
          "--mock-border": "#e2e8f0",
          "--mock-text": "#0f172a",
          "--mock-muted": "#64748b",
          borderColor: "var(--mock-border)",
          background: "var(--mock-bg)",
        } as React.CSSProperties
      }
    >
      <div className="flex items-center justify-between gap-3 px-2.5 py-1.5" style={{ background: "#0f172a" }}>
        <div className="flex items-center gap-3">
          <span className="font-display text-[10px] font-bold">
            <span className="text-white">Portal</span>
            <span style={{ color: "#a78bfa" }}>IT</span>
          </span>
          <div className="hidden items-center gap-2.5 text-[7px] font-medium sm:flex">
            {TABS.map((tab) => (
              <MockupTabButton
                key={tab.view}
                view={tab.view}
                label={tab.label}
                active={view === tab.view}
                onSelect={setView}
                className="pb-0.5"
                activeStyle={{ color: "#fff", borderBottom: "2px solid #a78bfa" }}
                idleStyle={{ color: "rgba(255,255,255,0.55)", borderBottom: "2px solid transparent" }}
              />
            ))}
          </div>
        </div>
        <span className="flex size-3.5 shrink-0 items-center justify-center rounded-full text-[6px] font-semibold text-white" style={{ background: "#5b21b6" }}>
          DM
        </span>
      </div>

      <MockupViewport view={view}>
        {view === "dashboard" ? <DashboardView /> : null}
        {view === "invoices" ? <InvoicesView /> : null}
        {view === "support" ? <SupportView /> : null}
      </MockupViewport>
    </div>
  );
}

"use client";

import { MockupTabButton, MockupViewport, useMockupView } from "../mockup-tabs";
import { ActivityTasksView } from "./activity-tasks";
import { DashboardView } from "./dashboard";
import { StockView } from "./stock";

const NAV = ["Dashboard", "Activity", "Schedule", "Customers", "Stock", "Reports"] as const;

type View = "dashboard" | "activity" | "stock";

// "Activity" is where the Monday-style task board actually lives, so it's
// the default/active tab even though it renders first in the mockup today.
const NAV_VIEW: Partial<Record<(typeof NAV)[number], View>> = {
  Dashboard: "dashboard",
  Activity: "activity",
  Stock: "stock",
};

export function ProjectitMockup() {
  const [view, setView] = useMockupView<View>("activity");

  return (
    <div
      className="mock-root overflow-hidden rounded-md border"
      style={
        {
          "--mock-bg": "#f5f6f8",
          "--mock-panel": "#ffffff",
          "--mock-panel-2": "#f5f6f8",
          "--mock-border": "#e4e7eb",
          "--mock-text": "#0f172a",
          "--mock-muted": "#64748b",
          borderColor: "var(--mock-border)",
          background: "var(--mock-bg)",
        } as React.CSSProperties
      }
    >
      <div
        className="flex items-center gap-3 px-2.5 py-1.5"
        style={{ background: "linear-gradient(90deg,#0f2f44,#133f5c)" }}
      >
        <span className="font-display text-[10px] font-bold">
          <span className="text-white">Project</span>
          <span style={{ color: "#74c7ff" }}>IT</span>
        </span>
        <div className="flex items-center gap-2 text-[7px] font-medium">
          {NAV.map((item) => {
            const linkedView = NAV_VIEW[item];
            if (!linkedView) {
              return (
                <span key={item} className="rounded px-1 py-0.5" style={{ color: "rgba(255,255,255,0.55)" }}>
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
                className="rounded px-1 py-0.5"
                activeStyle={{ background: "rgba(255,255,255,0.1)", color: "#fff" }}
                idleStyle={{ color: "rgba(255,255,255,0.55)" }}
              />
            );
          })}
          <span className="rounded px-1 py-0.5 font-semibold" style={{ color: "#10b981" }}>
            ManageIT
          </span>
        </div>
      </div>

      <MockupViewport view={view}>
        {view === "activity" ? <ActivityTasksView /> : null}
        {view === "dashboard" ? <DashboardView /> : null}
        {view === "stock" ? <StockView /> : null}
      </MockupViewport>
    </div>
  );
}

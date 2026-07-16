"use client";

import { MockupTabButton, MockupViewport, useMockupView } from "../mockup-tabs";
import { IncidentDetailView } from "./incident-detail";
import { TenantsView } from "./tenants";
import { ReportingView } from "./reporting";

const NAV = ["Tenants", "Incidents", "Reporting", "Policies", "Settings"] as const;

type View = "tenants" | "incidents" | "reporting";

const NAV_VIEW: Partial<Record<(typeof NAV)[number], View>> = {
  Tenants: "tenants",
  Incidents: "incidents",
  Reporting: "reporting",
};

export function SecureitMockup() {
  const [view, setView] = useMockupView<View>("incidents");

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
      <div className="flex items-center gap-2.5 px-2.5 py-1.5" style={{ background: "#0b0f14" }}>
        <span className="flex size-3.5 items-center justify-center rounded-[3px] bg-white text-[7px] font-bold text-[#0b0f14]">
          S
        </span>
        <span className="text-[9px] font-semibold text-white">SecureIT</span>
        <div className="ml-2 flex items-center gap-2 text-[7px] font-medium">
          {NAV.map((item) => {
            const linkedView = NAV_VIEW[item];
            if (!linkedView) {
              return (
                <span key={item} className="px-1 py-0.5" style={{ color: "rgba(255,255,255,0.55)" }}>
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
                className="rounded-sm px-1 py-0.5"
                activeStyle={{ background: "rgba(255,255,255,0.1)", color: "#fff" }}
                idleStyle={{ color: "rgba(255,255,255,0.55)" }}
              />
            );
          })}
        </div>
      </div>

      <MockupViewport view={view}>
        {view === "incidents" ? <IncidentDetailView /> : null}
        {view === "tenants" ? <TenantsView /> : null}
        {view === "reporting" ? <ReportingView /> : null}
      </MockupViewport>
    </div>
  );
}

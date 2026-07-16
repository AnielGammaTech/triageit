"use client";

import { accentVar } from "@/components/browser-frame";
import { MockupTabButton, MockupViewport, useMockupView } from "../mockup-tabs";
import { DashboardView } from "./dashboard";
import { SyncRunsView } from "./sync-runs";
import { CustomersView } from "./customers";

const NAV = ["Dashboard", "Adminland", "Connections", "Sync Runs", "Customers", "Contacts", "Phones"] as const;

type View = "dashboard" | "sync-runs" | "customers";

const NAV_VIEW: Partial<Record<(typeof NAV)[number], View>> = {
  Dashboard: "dashboard",
  "Sync Runs": "sync-runs",
  Customers: "customers",
};

export function ConnectitMockup() {
  const accent = accentVar("connectit");
  const [view, setView] = useMockupView<View>("dashboard");

  return (
    <div
      className="mock-root flex overflow-hidden rounded-md border"
      style={
        {
          "--mock-bg": "#f5f7fb",
          "--mock-panel": "#ffffff",
          "--mock-panel-2": "#f8fafd",
          "--mock-border": "#dbe4f0",
          "--mock-text": "#142033",
          "--mock-muted": "#5d6b82",
          borderColor: "var(--mock-border)",
          background: "var(--mock-bg)",
        } as React.CSSProperties
      }
    >
      <div className="flex w-[68px] shrink-0 flex-col gap-2 p-2" style={{ background: "#101827" }}>
        <div className="flex items-center gap-1">
          <span className="flex size-3.5 items-center justify-center rounded-[3px] text-[6px] font-bold text-white" style={{ background: accent }}>
            C
          </span>
          <span className="text-[7px] font-bold text-white">ConnectIT</span>
        </div>
        <div className="flex flex-col gap-1 text-[6.5px] font-medium">
          {NAV.map((item) => {
            const linkedView = NAV_VIEW[item];
            if (!linkedView) {
              return (
                <span key={item} className="truncate rounded px-1 py-0.5" style={{ color: "#9fb0c8" }}>
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
                className="truncate rounded px-1 py-0.5"
                activeStyle={{ background: "#24364f", color: "#e8edf6" }}
                idleStyle={{ color: "#9fb0c8" }}
              />
            );
          })}
        </div>
      </div>

      <MockupViewport view={view} className="flex flex-1 flex-col">
        {view === "dashboard" ? <DashboardView /> : null}
        {view === "sync-runs" ? <SyncRunsView /> : null}
        {view === "customers" ? <CustomersView /> : null}
      </MockupViewport>
    </div>
  );
}

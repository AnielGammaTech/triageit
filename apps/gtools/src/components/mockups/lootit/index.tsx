"use client";

import { MockupTabButton, MockupViewport, useMockupView } from "../mockup-tabs";
import { DashboardView } from "./dashboard";
import { KbView } from "./kb";
import { SettingsView } from "./settings";

type View = "dashboard" | "kb" | "settings";

const TABS: readonly { label: string; view: View }[] = [
  { label: "Dashboard", view: "dashboard" },
  { label: "KB", view: "kb" },
  { label: "Settings", view: "settings" },
];

export function LootitMockup() {
  const [view, setView] = useMockupView<View>("dashboard");

  return (
    <div
      className="mock-root overflow-hidden rounded-md border"
      style={
        {
          "--mock-bg": "#F8FAFC",
          "--mock-panel": "#ffffff",
          "--mock-panel-2": "#F8FAFC",
          "--mock-border": "#E5E7EB",
          "--mock-text": "#16181D",
          "--mock-muted": "#6b7280",
          borderColor: "var(--mock-border)",
          background: "var(--mock-bg)",
        } as React.CSSProperties
      }
    >
      <div className="flex items-center justify-between px-2.5 py-1.5" style={{ background: "linear-gradient(90deg, #2E0820, #4A1035)" }}>
        <div className="flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logos/lootit.svg" width={14} height={14} alt="" aria-hidden />
          <span className="font-display text-[10px] font-bold">
            <span style={{ color: "#F472B6", textShadow: "0 0 6px rgba(244,114,182,0.6)" }}>Loot</span>
            <span className="text-white">IT</span>
          </span>
          <div className="hidden items-center gap-1 text-[7px] font-medium text-white/60 sm:flex">
            {TABS.map((tab, i) => (
              <span key={tab.view} className="flex items-center gap-1">
                {i > 0 ? <span className="text-white/35">·</span> : null}
                <MockupTabButton
                  view={tab.view}
                  label={tab.label}
                  active={view === tab.view}
                  onSelect={setView}
                  activeStyle={{ color: "#fff" }}
                  idleStyle={{ color: "rgba(255,255,255,0.6)" }}
                />
              </span>
            ))}
          </div>
          <span className="hidden text-[7px] text-white/35 sm:inline">↗ PortalIT</span>
        </div>
        <span className="hidden text-[6.5px] text-white/45 sm:inline">ops@gamma.tech</span>
      </div>

      <MockupViewport view={view}>
        {view === "dashboard" ? <DashboardView /> : null}
        {view === "kb" ? <KbView /> : null}
        {view === "settings" ? <SettingsView /> : null}
      </MockupViewport>
    </div>
  );
}

"use client";

import { MockupTabButton, MockupViewport, useMockupView } from "../mockup-tabs";
import { DashboardView } from "./dashboard";
import { ToolsView } from "./tools";
import { TextitView } from "./textit";

const NAV = ["Dashboard", "Tools", "TextIT", "Runs", "Settings"] as const;

type View = "dashboard" | "tools" | "textit";

const NAV_VIEW: Partial<Record<(typeof NAV)[number], View>> = {
  Dashboard: "dashboard",
  Tools: "tools",
  TextIT: "textit",
};

export function RunitMockup() {
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
      <div
        className="flex items-center justify-center gap-3 px-2.5 py-1.5"
        style={{ background: "linear-gradient(90deg,#0f2f44,#133f5c)" }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logos/runit.svg" width={14} height={14} alt="" aria-hidden />
        <span className="font-display text-[10px] font-bold">
          <span className="text-white">Run</span>
          <span style={{ color: "#F59E0B" }}>IT</span>
        </span>
        <div className="flex items-center gap-2 text-[7px] font-medium">
          {NAV.map((item) => {
            const linkedView = NAV_VIEW[item];
            if (!linkedView) {
              return (
                <span key={item} className="rounded-full px-1.5 py-0.5" style={{ color: "rgba(255,255,255,0.55)" }}>
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
                className="rounded-full px-1.5 py-0.5"
                activeStyle={{ background: "rgba(255,255,255,0.1)", color: "#b4e1ff" }}
                idleStyle={{ color: "rgba(255,255,255,0.55)" }}
              />
            );
          })}
        </div>
      </div>

      <MockupViewport view={view}>
        {view === "dashboard" ? <DashboardView /> : null}
        {view === "tools" ? <ToolsView /> : null}
        {view === "textit" ? <TextitView /> : null}
      </MockupViewport>
    </div>
  );
}

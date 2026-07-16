"use client";

import { accentVar } from "@/components/browser-frame";
import { MockupTabButton, MockupViewport, useMockupView } from "../mockup-tabs";
import { BuilderView } from "./builder";
import { QuotesView } from "./quotes";
import { DashboardView } from "./dashboard";

type View = "builder" | "quotes" | "dashboard";

export function QuoteitMockup() {
  const accent = accentVar("quoteit");
  const [view, setView] = useMockupView<View>("builder");

  return (
    <div
      className="mock-root overflow-hidden rounded-md border"
      style={
        {
          "--mock-bg": "#f9fafb",
          "--mock-panel": "#ffffff",
          "--mock-panel-2": "#f3f4f6",
          "--mock-border": "#e5e7eb",
          "--mock-text": "#0f1729",
          "--mock-muted": "#6b7280",
          borderColor: "var(--mock-border)",
          background: "var(--mock-bg)",
        } as React.CSSProperties
      }
    >
      <div className="flex items-center justify-between px-2.5 py-1.5" style={{ background: "#0f1729" }}>
        <div className="flex items-center gap-2.5">
          <span className="font-display text-[10px] font-bold">
            <span className="text-white">Quote</span>
            <span style={{ color: accent }}>IT</span>
          </span>
          <div className="hidden items-center gap-1 text-[7px] font-medium text-white/50 sm:flex">
            <MockupTabButton
              view="dashboard"
              label="Dashboard"
              active={view === "dashboard"}
              onSelect={setView}
              activeStyle={{ color: "#fff" }}
              idleStyle={{ color: "rgba(255,255,255,0.5)" }}
            />
            <span>·</span>
            <MockupTabButton
              view="quotes"
              label="Quotes"
              active={view === "quotes"}
              onSelect={setView}
              activeStyle={{ color: "#fff" }}
              idleStyle={{ color: "rgba(255,255,255,0.5)" }}
            />
            <span>· CRM · Catalog</span>
          </div>
        </div>
        <MockupTabButton
          view="builder"
          label="+ New Quote"
          active={view === "builder"}
          onSelect={setView}
          className="rounded-full px-2 py-0.5 text-[7px] font-semibold text-white"
          activeStyle={{ background: `linear-gradient(90deg, ${accent}, #fb923c)`, boxShadow: "0 0 0 2px rgba(255,255,255,0.35)" }}
          idleStyle={{ background: `linear-gradient(90deg, ${accent}, #fb923c)` }}
        />
      </div>

      <MockupViewport view={view}>
        {view === "builder" ? <BuilderView /> : null}
        {view === "quotes" ? <QuotesView /> : null}
        {view === "dashboard" ? <DashboardView /> : null}
      </MockupViewport>
    </div>
  );
}

"use client";

import { MockupTabButton, MockupViewport, useMockupView } from "../mockup-tabs";
import { DashboardView } from "./dashboard";
import { AccountsView } from "./accounts";
import { PipelineView } from "./pipeline";

const NAV = ["Dashboard", "Accounts", "QBR", "Pipeline", "Reports"] as const;

type View = "dashboard" | "accounts" | "pipeline";

const NAV_VIEW: Partial<Record<(typeof NAV)[number], View>> = {
  Dashboard: "dashboard",
  Accounts: "accounts",
  Pipeline: "pipeline",
};

export function AccountitMockup() {
  const [view, setView] = useMockupView<View>("dashboard");

  return (
    <div
      className="mock-root overflow-hidden rounded-md border"
      style={{ "--mock-bg": "#f8fafc", "--mock-panel": "#ffffff", "--mock-panel-2": "#f1f5f9", "--mock-border": "#e2e8f0", "--mock-text": "#0f172a", "--mock-muted": "#64748b", borderColor: "var(--mock-border)", background: "var(--mock-bg)" } as React.CSSProperties}
    >
      <div className="flex items-center justify-between gap-2 px-2.5 py-1.5" style={{ background: "#1e2532" }}>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logos/accountit.svg" width={16} height={16} alt="" aria-hidden />
            <div className="flex flex-col leading-none">
              <span className="font-display text-[9px] font-bold">
                <span className="text-white">Account</span>
                <span style={{ color: "#D946EF" }}>IT</span>
              </span>
              <span className="text-[5.5px] font-semibold uppercase tracking-wider text-white/40">CRM</span>
            </div>
          </div>
          <div className="hidden items-center gap-2 text-[6.5px] font-medium sm:flex">
            {NAV.map((item) => {
              const linkedView = NAV_VIEW[item];
              if (!linkedView) {
                return (
                  <span key={item} className="rounded px-1 py-0.5" style={{ color: "rgba(255,255,255,0.45)" }}>
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
                  activeStyle={{ background: "rgba(255,255,255,0.1)", color: "#fff", boxShadow: "inset 0 -1.5px 0 #818cf8" }}
                  idleStyle={{ color: "rgba(255,255,255,0.45)" }}
                />
              );
            })}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="rounded-full bg-white px-1.5 py-0.5 text-[6.5px] font-semibold" style={{ color: "#1e2532" }}>QuoteIT ↗</span>
          <span className="flex size-3.5 items-center justify-center rounded-full text-[6px] font-semibold text-white" style={{ background: "#475569" }}>J</span>
        </div>
      </div>

      <MockupViewport view={view}>
        {view === "dashboard" ? <DashboardView /> : null}
        {view === "accounts" ? <AccountsView /> : null}
        {view === "pipeline" ? <PipelineView /> : null}
      </MockupViewport>
    </div>
  );
}

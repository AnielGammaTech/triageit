"use client";

import { MockupTabButton, MockupViewport, useMockupView } from "../mockup-tabs";
import { BuyView } from "./buy";
import { StorefrontView } from "./storefront";
import { AdminView } from "./admin";

type View = "buy" | "storefront" | "admin";

const TABS: readonly { label: string; view: View }[] = [
  { label: "Buy", view: "buy" },
  { label: "Storefront", view: "storefront" },
  { label: "Admin", view: "admin" },
];

// VendIT's real UI has no unified nav (a bare buy page, a storefront, and a
// separately-themed admin/POS surface) — this small pill row is the
// mockup's own switcher between those three real surfaces, not an
// invented in-app control. Customer surfaces (Buy/Storefront) are dark per
// the real app; Admin is genuinely light-themed in the real app too, so
// the whole frame's theme vars flip with it rather than faking a dark
// admin screen that doesn't exist.
const DARK_VARS = {
  "--mock-bg": "#09090b",
  "--mock-panel": "#18181b",
  "--mock-panel-2": "#27272a",
  "--mock-border": "#27272a",
  "--mock-text": "#ffffff",
  "--mock-muted": "#a1a1aa",
} as const;

const LIGHT_VARS = {
  "--mock-bg": "#f4f4f5",
  "--mock-panel": "#ffffff",
  "--mock-panel-2": "#f4f4f5",
  "--mock-border": "#e4e4e7",
  "--mock-text": "#18181b",
  "--mock-muted": "#71717a",
} as const;

export function VenditMockup() {
  const [view, setView] = useMockupView<View>("buy");
  const themeVars = view === "admin" ? LIGHT_VARS : DARK_VARS;

  return (
    <div
      className="mock-root flex flex-col items-center gap-2 overflow-hidden rounded-md border p-3"
      style={{ ...themeVars, borderColor: "var(--mock-border)", background: "var(--mock-bg)" } as React.CSSProperties}
    >
      <div className="flex items-center gap-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logos/vendit.svg" width={12} height={12} alt="" aria-hidden />
        <span className="text-[7px] font-semibold uppercase tracking-[0.25em] text-[color:var(--mock-muted)]">VendIT</span>
        <span className="flex items-center gap-1">
          {TABS.map((tab) => (
            <MockupTabButton
              key={tab.view}
              view={tab.view}
              label={tab.label}
              active={view === tab.view}
              onSelect={setView}
              className="rounded-full border px-1.5 py-0.5 text-[6px] font-medium uppercase tracking-wider"
              activeStyle={{ borderColor: "#10b981", color: "#10b981", background: "color-mix(in srgb, #10b981 12%, transparent)" }}
              idleStyle={{ borderColor: "var(--mock-border)", color: "var(--mock-muted)" }}
            />
          ))}
        </span>
      </div>

      <MockupViewport view={view} className="flex w-full flex-1 flex-col items-center">
        {view === "buy" ? <BuyView /> : null}
        {view === "storefront" ? <StorefrontView /> : null}
        {view === "admin" ? <AdminView /> : null}
      </MockupViewport>
    </div>
  );
}

"use client";

import { accentVar } from "@/components/browser-frame";
import { MockupTabButton, MockupViewport, useMockupView } from "../mockup-tabs";
import { BulkCsvView } from "./bulk-csv";
import { SingleLookupView } from "./single-lookup";
import { HistoryView } from "./history";

type View = "single-lookup" | "bulk-csv" | "history";

const TABS: readonly { label: string; view: View }[] = [
  { label: "Single Lookup", view: "single-lookup" },
  { label: "Bulk CSV", view: "bulk-csv" },
  { label: "History", view: "history" },
];

export function PhoneitMockup() {
  const accent = accentVar("phoneit");
  const [view, setView] = useMockupView<View>("bulk-csv");

  return (
    <div
      className="mock-root overflow-hidden rounded-md border"
      style={
        {
          "--mock-bg": "#0f1117",
          "--mock-panel": "#161b22",
          "--mock-panel-2": "#0f1117",
          "--mock-border": "#30363d",
          "--mock-text": "#e1e4e8",
          "--mock-muted": "#8b949e",
          borderColor: "var(--mock-border)",
          background: "var(--mock-bg)",
        } as React.CSSProperties
      }
    >
      <div className="flex items-center justify-between border-b px-2.5 py-1.5" style={{ background: "var(--mock-panel)", borderColor: "var(--mock-border)" }}>
        <div className="flex items-center gap-1.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logos/phoneit.svg" width={14} height={14} alt="" aria-hidden />
          <span className="font-display text-[10px] font-bold" style={{ color: "#58a6ff" }}>
            PhoneIT
          </span>
        </div>
        <div className="flex items-center gap-1 text-[7px] font-medium">
          {TABS.map((tab) => (
            <MockupTabButton
              key={tab.view}
              view={tab.view}
              label={tab.label}
              active={view === tab.view}
              onSelect={setView}
              className="rounded-[6px] px-1.5 py-0.5"
              activeStyle={{ background: accent, color: "#fff" }}
              idleStyle={{ color: "var(--mock-muted)" }}
            />
          ))}
        </div>
      </div>

      <MockupViewport view={view}>
        {view === "bulk-csv" ? <BulkCsvView accent={accent} /> : null}
        {view === "single-lookup" ? <SingleLookupView accent={accent} /> : null}
        {view === "history" ? <HistoryView /> : null}
      </MockupViewport>
    </div>
  );
}

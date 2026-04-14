"use client";

import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

const PRIMARY_COLOR = "#b91c1c";

const TABS = [
  { key: "performance", label: "Performance" },
  { key: "toby", label: "Toby Insights" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export function AnalyticsTabs({
  performanceTab,
  tobyTab,
}: {
  readonly performanceTab: ReactNode;
  readonly tobyTab: ReactNode;
}) {
  const [active, setActive] = useState<TabKey>("performance");

  return (
    <div className="space-y-4">
      {/* Tab bar */}
      <div className="flex gap-1 rounded-lg bg-white/[0.03] p-1 border border-white/5 w-fit">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActive(tab.key)}
            className={cn(
              "rounded-md px-4 py-2 text-sm font-medium transition-colors",
              active === tab.key
                ? "text-white shadow-sm"
                : "text-white/50 hover:text-white/80",
            )}
            style={active === tab.key ? { backgroundColor: PRIMARY_COLOR } : undefined}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {active === "performance" ? performanceTab : tobyTab}
    </div>
  );
}

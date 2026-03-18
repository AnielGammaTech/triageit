"use client";

import { useState, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils/cn";
import {
  ADMIN_SECTIONS,
  INTEGRATION_CATEGORIES,
  type IntegrationItem,
} from "@/components/admin/adminland-constants";
import { IntegrationConfig } from "@/components/admin/integration-config";

type ActiveView =
  | { type: "menu" }
  | { type: "section"; id: string }
  | { type: "integration"; item: IntegrationItem };

const SECTION_ICONS: Record<string, React.ReactNode> = {
  users: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
  branding: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="13.5" cy="6.5" r="2.5" /><circle cx="17.5" cy="10.5" r="2.5" /><circle cx="8.5" cy="7.5" r="2.5" />
      <circle cx="6.5" cy="12.5" r="2.5" /><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2Z" />
    </svg>
  ),
  "triage-rules": (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" /><path d="M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.854z" />
    </svg>
  ),
  "agent-config": (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 8V4H8" /><rect width="16" height="12" x="4" y="8" rx="2" />
      <path d="M2 14h2" /><path d="M20 14h2" /><path d="M15 13v2" /><path d="M9 13v2" />
    </svg>
  ),
};

const INTEGRATION_ICON = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22v-5" /><path d="M9 8V2" /><path d="M15 8V2" />
    <path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z" />
  </svg>
);

export default function AdminlandPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [activeView, setActiveView] = useState<ActiveView>({ type: "menu" });
  const [mappingCounts, setMappingCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    const section = searchParams.get("section");
    if (section) {
      // Check if it's an integration
      for (const cat of INTEGRATION_CATEGORIES) {
        const found = cat.items.find((i) => i.id === section);
        if (found) {
          setActiveView({ type: "integration", item: found });
          return;
        }
      }
      setActiveView({ type: "section", id: section });
    } else {
      setActiveView({ type: "menu" });
    }
  }, [searchParams]);

  useEffect(() => {
    loadMappingCounts();
  }, []);

  async function loadMappingCounts() {
    const supabase = createClient();
    const { data } = await supabase
      .from("integration_mappings")
      .select("service");

    if (data) {
      const counts: Record<string, number> = {};
      for (const row of data) {
        const svc = row.service as string;
        counts[svc] = (counts[svc] ?? 0) + 1;
      }
      setMappingCounts(counts);
    }
  }

  function navigateTo(view: ActiveView) {
    if (view.type === "menu") {
      router.push("/adminland");
    } else if (view.type === "section") {
      router.push(`/adminland?section=${view.id}`);
    } else if (view.type === "integration") {
      router.push(`/adminland?section=${view.item.id}`);
    }
    setActiveView(view);
  }

  // Drill-in view
  if (activeView.type === "integration") {
    return (
      <div
        className="min-h-[calc(100vh-7rem)] rounded-xl border border-white/10 p-6"
        style={{ backgroundColor: "#1a0f35" }}
      >
        <IntegrationConfig
          item={activeView.item}
          onBack={() => navigateTo({ type: "menu" })}
        />
      </div>
    );
  }

  if (activeView.type === "section") {
    return (
      <div
        className="min-h-[calc(100vh-7rem)] rounded-xl border border-white/10 p-6"
        style={{ backgroundColor: "#1a0f35" }}
      >
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigateTo({ type: "menu" })}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-white/50 transition-colors hover:bg-white/5 hover:text-white"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="m15 18-6-6 6-6" />
            </svg>
          </button>
          <h3 className="text-lg font-semibold text-white">
            {ADMIN_SECTIONS.flatMap((s) => s.items).find((i) => i.id === activeView.id)?.label ?? activeView.id}
          </h3>
        </div>
        <div className="mt-8 rounded-lg border border-white/10 bg-white/5 p-8 text-center">
          <p className="text-sm text-white/50">
            This section is coming soon in Phase 4.
          </p>
        </div>
      </div>
    );
  }

  // Main menu
  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-semibold text-white">Adminland</h2>
        <p className="mt-1 text-sm text-white/50">
          Manage integrations, settings, and system configuration.
        </p>
      </div>

      {/* Settings sections */}
      {ADMIN_SECTIONS.map((group) => (
        <div key={group.category}>
          <p className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-white/30">
            {group.category}
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {group.items.map((section) => (
              <button
                key={section.id}
                onClick={() => navigateTo({ type: "section", id: section.id })}
                className="group flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-4 text-left transition-all hover:border-white/20 hover:bg-white/[0.04]"
              >
                <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-lg", section.iconBg)}>
                  <span className={section.iconColor}>
                    {SECTION_ICONS[section.id]}
                  </span>
                </div>
                <div>
                  <p className="text-sm font-medium text-white group-hover:text-white">
                    {section.label}
                  </p>
                  <p className="mt-0.5 text-xs text-white/40">
                    {section.desc}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </div>
      ))}

      {/* Integrations */}
      {INTEGRATION_CATEGORIES.map((group) => (
        <div key={group.category}>
          <p className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-white/30">
            {group.category}
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {group.items.map((integration) => {
              const count = mappingCounts[integration.service] ?? 0;
              return (
                <button
                  key={integration.id}
                  onClick={() => navigateTo({ type: "integration", item: integration })}
                  className="group flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-4 text-left transition-all hover:border-white/20 hover:bg-white/[0.04]"
                >
                  <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-lg", integration.iconBg)}>
                    <span className={integration.iconColor}>
                      {INTEGRATION_ICON}
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-white">
                        {integration.label}
                      </p>
                      {count > 0 && (
                        <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">
                          {count} mapped
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-white/40">
                      {integration.desc}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

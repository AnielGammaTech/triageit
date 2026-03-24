"use client";

import { useState, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils/cn";
import {
  MENU_GROUPS,
  INTEGRATION_CATEGORIES,
  type IntegrationItem,
} from "@/components/admin/adminland-constants";
import { IntegrationConfig } from "@/components/admin/integration-config";
import { AgentConfigSection } from "@/components/admin/agent-config";
import { TriageRulesSection } from "@/components/admin/triage-rules-config";
import { UsersSecuritySection } from "@/components/admin/users-security";
import { CronJobsSection } from "@/components/admin/cron-jobs-config";
import { DiagnosticsSection } from "@/components/admin/diagnostics-section";
import { BrandingSettings } from "@/components/settings/branding-settings";

type ActiveView =
  | { type: "menu" }
  | { type: "section"; id: string }
  | { type: "integrations" }
  | { type: "integration"; item: IntegrationItem };

// ── Icons ─────────────────────────────────────────────────────────────

const ICONS: Record<string, React.ReactNode> = {
  users: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
  branding: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="13.5" cy="6.5" r="2.5" /><circle cx="17.5" cy="10.5" r="2.5" /><circle cx="8.5" cy="7.5" r="2.5" />
      <circle cx="6.5" cy="12.5" r="2.5" /><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2Z" />
    </svg>
  ),
  integrations: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22v-5" /><path d="M9 8V2" /><path d="M15 8V2" />
      <path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z" />
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
  "cron-jobs": (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" />
    </svg>
  ),
  diagnostics: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
    </svg>
  ),
};

const CHEVRON_RIGHT = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m9 18 6-6-6-6" />
  </svg>
);

const INTEGRATION_ICON = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22v-5" /><path d="M9 8V2" /><path d="M15 8V2" />
    <path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z" />
  </svg>
);

// ── Main Component ────────────────────────────────────────────────────

export default function AdminlandPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [activeView, setActiveView] = useState<ActiveView>({ type: "menu" });
  const [mappingCounts, setMappingCounts] = useState<Record<string, number>>({});
  const [connectedServices, setConnectedServices] = useState<Set<string>>(new Set());

  useEffect(() => {
    const section = searchParams.get("section");
    if (section === "integrations") {
      setActiveView({ type: "integrations" });
    } else if (section) {
      // Check if it's an integration drill-in
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
    loadIntegrationData();
  }, []);

  async function loadIntegrationData() {
    const supabase = createClient();

    // Load mapping counts
    const { data: mappingData } = await supabase
      .from("integration_mappings")
      .select("service");

    if (mappingData) {
      const counts: Record<string, number> = {};
      for (const row of mappingData) {
        const svc = row.service as string;
        counts[svc] = (counts[svc] ?? 0) + 1;
      }
      setMappingCounts(counts);
    }

    // Load connected integrations
    const { data: intData } = await supabase
      .from("integrations")
      .select("service, is_active");

    if (intData) {
      const connected = new Set<string>();
      for (const row of intData) {
        if (row.is_active) {
          connected.add(row.service as string);
        }
      }
      setConnectedServices(connected);
    }
  }

  function navigateTo(view: ActiveView) {
    if (view.type === "menu") {
      router.push("/adminland");
    } else if (view.type === "section") {
      router.push(`/adminland?section=${view.id}`);
    } else if (view.type === "integrations") {
      router.push("/adminland?section=integrations");
    } else if (view.type === "integration") {
      router.push(`/adminland?section=${view.item.id}`);
    }
    setActiveView(view);
  }

  // Services that don't need customer mapping — always show "Connected" not "X mapped"
  const NO_MAPPING_SERVICES = new Set(["halo", "teams", "ai-provider"]);

  function getIntegrationStatus(service: string): "connected" | "mapped" | "not_configured" {
    const isConnected = connectedServices.has(service);
    if (!isConnected) return "not_configured";
    if (NO_MAPPING_SERVICES.has(service)) return "connected";
    const mapCount = mappingCounts[service] ?? 0;
    if (mapCount > 0) return "mapped";
    return "connected";
  }

  // ── Integration drill-in view ──────────────────────────────────────

  if (activeView.type === "integration") {
    return (
      <div className="mx-auto max-w-3xl">
        <div className="mb-6 flex items-center gap-2 text-sm text-white/50">
          <button onClick={() => navigateTo({ type: "menu" })} className="hover:text-white transition-colors">
            Adminland
          </button>
          <span className="text-white/30">{CHEVRON_RIGHT}</span>
          <button onClick={() => navigateTo({ type: "integrations" })} className="hover:text-white transition-colors">
            Integrations
          </button>
          <span className="text-white/30">{CHEVRON_RIGHT}</span>
          <span className="text-white font-medium">{activeView.item.label}</span>
        </div>
        <div
          className="rounded-xl border border-white/10 p-6"
          style={{ backgroundColor: "#241010" }}
        >
          <IntegrationConfig
            item={activeView.item}
            onBack={() => navigateTo({ type: "integrations" })}
          />
        </div>
      </div>
    );
  }

  // ── Integrations list view ─────────────────────────────────────────

  if (activeView.type === "integrations") {
    return (
      <div className="mx-auto max-w-3xl">
        <div className="mb-6 flex items-center gap-2 text-sm text-white/50">
          <button onClick={() => navigateTo({ type: "menu" })} className="hover:text-white transition-colors">
            Adminland
          </button>
          <span className="text-white/30">{CHEVRON_RIGHT}</span>
          <span className="text-white font-medium">Integrations</span>
        </div>

        <div className="space-y-6">
          {INTEGRATION_CATEGORIES.map((group) => (
            <div key={group.category}>
              <p className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-white/30">
                {group.category}
              </p>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {group.items.map((integration) => {
                  const status = getIntegrationStatus(integration.service);
                  return (
                    <button
                      key={integration.id}
                      onClick={() => navigateTo({ type: "integration", item: integration })}
                      className="group flex w-full items-center gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-4 text-left transition-all hover:border-white/20 hover:bg-white/[0.04]"
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
                          {status === "mapped" && (
                            <span className="flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">
                              <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />
                              Connected · {mappingCounts[integration.service]} mapped
                            </span>
                          )}
                          {status === "connected" && (
                            <span className="flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">
                              <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />
                              Connected
                            </span>
                          )}
                          {status === "not_configured" && (
                            <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] font-medium text-white/30">
                              Not configured
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 text-xs text-white/40">
                          {integration.desc}
                        </p>
                      </div>
                      <span className="shrink-0 text-white/20 transition-colors group-hover:text-white/40">
                        {CHEVRON_RIGHT}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── Section drill-in view ──────────────────────────────────────────

  if (activeView.type === "section") {
    const sectionLabel = MENU_GROUPS
      .flatMap((g) => g.items)
      .find((i) => i.id === activeView.id)?.label ?? activeView.id;

    return (
      <div className="mx-auto max-w-3xl">
        <div className="mb-6 flex items-center gap-2 text-sm text-white/50">
          <button onClick={() => navigateTo({ type: "menu" })} className="hover:text-white transition-colors">
            Adminland
          </button>
          <span className="text-white/30">{CHEVRON_RIGHT}</span>
          <span className="text-white font-medium">{sectionLabel}</span>
        </div>
        {activeView.id === "users" ? (
          <UsersSecuritySection />
        ) : activeView.id === "agent-config" ? (
          <AgentConfigSection />
        ) : activeView.id === "triage-rules" ? (
          <TriageRulesSection />
        ) : activeView.id === "cron-jobs" ? (
          <CronJobsSection />
        ) : activeView.id === "diagnostics" ? (
          <DiagnosticsSection />
        ) : activeView.id === "branding" ? (
          <BrandingSettings />
        ) : (
          <div
            className="rounded-xl border border-white/10 p-8 text-center"
            style={{ backgroundColor: "#241010" }}
          >
            <p className="text-sm text-white/50">
              This section is coming soon.
            </p>
          </div>
        )}
      </div>
    );
  }

  // ── Main menu ──────────────────────────────────────────────────────

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#b91c1c] text-white">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" />
            </svg>
          </div>
          <div>
            <h2 className="text-xl font-semibold text-white">Adminland</h2>
            <p className="text-sm text-white/50">
              Manage integrations, settings, and system configuration.
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {MENU_GROUPS.map((group) => (
          <div
            key={group.title}
            className="overflow-hidden rounded-xl border border-white/10 bg-white/[0.02]"
          >
            <div className="border-b border-white/10 px-5 py-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-white/40">
                {group.title}
              </h3>
            </div>
            <div className="divide-y divide-white/5">
              {group.items.map((item) => (
                <button
                  key={item.id}
                  onClick={() =>
                    item.id === "integrations"
                      ? navigateTo({ type: "integrations" })
                      : navigateTo({ type: "section", id: item.id })
                  }
                  className="group flex w-full items-center gap-3.5 px-5 py-4 text-left transition-colors hover:bg-white/[0.04]"
                >
                  <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", item.iconBg)}>
                    <span className={item.iconColor}>
                      {ICONS[item.id] ?? ICONS.integrations}
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-white">{item.label}</p>
                    <p className="mt-0.5 text-xs text-white/40">{item.desc}</p>
                  </div>
                  <span className="shrink-0 text-white/20 transition-colors group-hover:text-white/40">
                    {CHEVRON_RIGHT}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

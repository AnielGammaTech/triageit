"use client";

import { useState, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import {
  Activity,
  AlertTriangle,
  Bot,
  CheckCircle2,
  ChevronRight,
  CircleOff,
  Clock3,
  Cloud,
  Cpu,
  Database,
  FileKey2,
  FileText,
  KeyRound,
  Link2,
  ListChecks,
  MessageSquare,
  Network,
  Palette,
  PhoneCall,
  PlugZap,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Stethoscope,
  UsersRound,
  WandSparkles,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils/cn";
import {
  MENU_GROUPS,
  INTEGRATION_CATEGORIES,
  type IntegrationItem,
} from "@/components/admin/adminland-constants";
import { IntegrationConfig } from "@/components/admin/integration-config";
import { AutoMapperConfig } from "@/components/admin/automapper-config";
import { AgentConfigSection } from "@/components/admin/agent-config";
import { HaloAgentsSection } from "@/components/admin/halo-agents-section";
import { HaloStatusesSection } from "@/components/admin/halo-statuses-section";
import { TriageRulesSection } from "@/components/admin/triage-rules-config";
import { UsersSecuritySection } from "@/components/admin/users-security";
import { CronJobsSection } from "@/components/admin/cron-jobs-config";
import { DiagnosticsSection } from "@/components/admin/diagnostics-section";
import { HealthSection } from "@/components/admin/health-section";
import { TvAccessSection } from "@/components/admin/tv-access-section";
import { BrandingSettings } from "@/components/settings/branding-settings";

type ActiveView =
  | { type: "menu" }
  | { type: "section"; id: string }
  | { type: "integrations" }
  | { type: "automapper" }
  | { type: "integration"; item: IntegrationItem };

interface IntegrationHealth {
  readonly healthStatus: string | null;
  readonly lastHealthCheck: string | null;
  readonly message: string | null;
  readonly consecutiveFailures: number;
}

type IntegrationFilter = "all" | "connected" | "attention" | "not_configured";
type IntegrationState = "healthy" | "attention" | "pending" | "not_configured";

const ADMIN_ICONS: Record<string, LucideIcon> = {
  users: UsersRound,
  branding: Palette,
  integrations: PlugZap,
  "tv-access": KeyRound,
  "triage-rules": ListChecks,
  "agent-config": Settings2,
  workers: Cpu,
  "halo-agents": UsersRound,
  "halo-statuses": SlidersHorizontal,
  "cron-jobs": Clock3,
  diagnostics: Stethoscope,
  health: Wrench,
};

const SERVICE_ICONS: Record<string, LucideIcon> = {
  halo: Database,
  hudu: FileText,
  datto: Activity,
  "datto-edr": ShieldCheck,
  rocketcyber: ShieldCheck,
  unifi: Network,
  vpentest: ShieldCheck,
  "saas-alerts": AlertTriangle,
  jumpcloud: FileKey2,
  unitrends: Cloud,
  cove: Cloud,
  pax8: Cloud,
  dmarc: ShieldCheck,
  threecx: PhoneCall,
  vultr: Cloud,
  cipp: Cloud,
  msgraph: Cloud,
  teams: MessageSquare,
  "ai-provider": Bot,
};

const INTEGRATION_STATE_META: Record<
  IntegrationState,
  { readonly label: string; readonly className: string; readonly icon: LucideIcon }
> = {
  healthy: {
    label: "Healthy",
    className: "border-emerald-500/25 bg-emerald-500/10 text-emerald-300",
    icon: CheckCircle2,
  },
  attention: {
    label: "Needs attention",
    className: "border-amber-500/25 bg-amber-500/10 text-amber-300",
    icon: AlertTriangle,
  },
  pending: {
    label: "Check pending",
    className: "border-sky-500/25 bg-sky-500/10 text-sky-300",
    icon: Activity,
  },
  not_configured: {
    label: "Not configured",
    className: "border-white/10 bg-white/[0.03] text-white/45",
    icon: CircleOff,
  },
};

// ── Main Component ────────────────────────────────────────────────────

export default function AdminlandPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [activeView, setActiveView] = useState<ActiveView>({ type: "menu" });
  const [mappingCounts, setMappingCounts] = useState<Record<string, number>>({});
  const [connectedServices, setConnectedServices] = useState<Set<string>>(new Set());
  const [integrationHealth, setIntegrationHealth] = useState<Record<string, IntegrationHealth>>({});
  const [heartbeatRunning, setHeartbeatRunning] = useState(false);
  const [integrationLoading, setIntegrationLoading] = useState(true);
  const [integrationError, setIntegrationError] = useState<string | null>(null);
  const [integrationQuery, setIntegrationQuery] = useState("");
  const [integrationFilter, setIntegrationFilter] = useState<IntegrationFilter>("all");
  const [adminQuery, setAdminQuery] = useState("");

  useEffect(() => {
    const section = searchParams.get("section");
    if (section === "integrations") {
      setActiveView({ type: "integrations" });
    } else if (section === "automapper") {
      setActiveView({ type: "automapper" });
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
    setIntegrationError(null);

    try {
      const { data: mappingData, error: mappingError } = await supabase
        .from("integration_mappings")
        .select("service");

      if (mappingError) throw mappingError;

      if (mappingData) {
        const counts: Record<string, number> = {};
        for (const row of mappingData) {
          const svc = row.service as string;
          counts[svc] = (counts[svc] ?? 0) + 1;
        }
        setMappingCounts(counts);
      }

      const { data: intData, error: integrationDataError } = await supabase
        .from("integrations")
        .select("service, is_active, health_status, last_health_check, config");

      if (integrationDataError) throw integrationDataError;

      if (intData) {
        const connected = new Set<string>();
        const health: Record<string, IntegrationHealth> = {};
        for (const row of intData) {
          if (row.is_active) {
            connected.add(row.service as string);
          }
          const heartbeat = (row.config as { __heartbeat?: { message?: string; consecutive_failures?: number } } | null)?.__heartbeat;
          health[row.service as string] = {
            healthStatus: (row.health_status as string | null) ?? null,
            lastHealthCheck: (row.last_health_check as string | null) ?? null,
            message: heartbeat?.message ?? null,
            consecutiveFailures: heartbeat?.consecutive_failures ?? 0,
          };
        }
        setConnectedServices(connected);
        setIntegrationHealth(health);
      }
    } catch (error) {
      console.error("Failed to load integration data", error);
      setIntegrationError("Integration data could not be loaded.");
    } finally {
      setIntegrationLoading(false);
    }
  }

  async function runHeartbeat() {
    setHeartbeatRunning(true);
    setIntegrationError(null);
    try {
      const response = await fetch("/api/integrations/heartbeat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!response.ok) {
        throw new Error("Health checks could not be completed.");
      }
      await loadIntegrationData();
    } catch (error) {
      setIntegrationError(error instanceof Error ? error.message : "Health checks could not be completed.");
    } finally {
      setHeartbeatRunning(false);
    }
  }

  function navigateTo(view: ActiveView) {
    if (view.type === "menu") {
      router.push("/adminland");
    } else if (view.type === "section") {
      // AI Workers lives on its own page (deep-linkable agent detail) —
      // the Adminland entry navigates there instead of an inline section.
      if (view.id === "workers") {
        router.push("/workers");
        return;
      }
      router.push(`/adminland?section=${view.id}`);
    } else if (view.type === "integrations") {
      router.push("/adminland?section=integrations");
    } else if (view.type === "automapper") {
      router.push("/adminland?section=automapper");
    } else if (view.type === "integration") {
      router.push(`/adminland?section=${view.item.id}`);
    }
    setActiveView(view);
  }

  // Services that don't need customer mapping — always show "Connected" not "X mapped"
  const NO_MAPPING_SERVICES = new Set(["halo", "teams", "ai-provider"]);

  function getIntegrationState(service: string): IntegrationState {
    if (!connectedServices.has(service)) return "not_configured";

    const health = integrationHealth[service];
    if (health?.consecutiveFailures && health.consecutiveFailures > 0) return "attention";

    const status = health?.healthStatus?.toLowerCase();
    if (status === "healthy" || status === "connected") return "healthy";
    if (status === "degraded" || status === "unknown" || status === "unhealthy" || status === "down" || status === "error") {
      return "attention";
    }
    return "pending";
  }

  function formatLastCheck(service: string): string | null {
    const iso = integrationHealth[service]?.lastHealthCheck;
    if (!iso) return null;
    return new Date(iso).toLocaleString("en-US", {
      timeZone: "America/New_York",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  // ── Integration drill-in view ──────────────────────────────────────

  if (activeView.type === "integration") {
    return (
      <div className="mx-auto w-full max-w-5xl">
        <div className="mb-5 flex items-center gap-1.5 text-sm text-white/45">
          <button onClick={() => navigateTo({ type: "menu" })} className="hover:text-white transition-colors">
            Adminland
          </button>
          <ChevronRight className="h-3.5 w-3.5 text-white/25" aria-hidden="true" />
          <button onClick={() => navigateTo({ type: "integrations" })} className="hover:text-white transition-colors">
            Integrations
          </button>
          <ChevronRight className="h-3.5 w-3.5 text-white/25" aria-hidden="true" />
          <span className="text-white font-medium">{activeView.item.label}</span>
        </div>
        <div className="rounded-lg border border-white/10 bg-white/[0.015] p-4 sm:p-6">
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
    const integrationRows = INTEGRATION_CATEGORIES.flatMap((group) =>
      group.items.map((item) => ({
        ...item,
        category: group.category,
        state: getIntegrationState(item.service),
      })),
    );
    const configuredCount = integrationRows.filter((row) => row.state !== "not_configured").length;
    const healthyCount = integrationRows.filter((row) => row.state === "healthy").length;
    const attentionCount = integrationRows.filter((row) => row.state === "attention").length;
    const notConfiguredCount = integrationRows.length - configuredCount;
    const mappingTotal = integrationRows.reduce((total, row) => total + (mappingCounts[row.service] ?? 0), 0);
    const normalizedQuery = integrationQuery.trim().toLowerCase();
    const filteredRows = integrationRows
      .filter((row) => {
        const matchesQuery = !normalizedQuery
          || row.label.toLowerCase().includes(normalizedQuery)
          || row.desc.toLowerCase().includes(normalizedQuery)
          || row.category.toLowerCase().includes(normalizedQuery);
        const matchesFilter = integrationFilter === "all"
          || (integrationFilter === "connected" && row.state !== "not_configured")
          || (integrationFilter === "attention" && row.state === "attention")
          || (integrationFilter === "not_configured" && row.state === "not_configured");
        return matchesQuery && matchesFilter;
      });
    const filteredGroups = INTEGRATION_CATEGORIES
      .map((group) => ({
        category: group.category,
        rows: filteredRows.filter((row) => row.category === group.category),
      }))
      .filter((group) => group.rows.length > 0);
    const filters: ReadonlyArray<{ key: IntegrationFilter; label: string; count: number }> = [
      { key: "all", label: "All", count: integrationRows.length },
      { key: "connected", label: "Connected", count: configuredCount },
      { key: "attention", label: "Needs attention", count: attentionCount },
      { key: "not_configured", label: "Not configured", count: notConfiguredCount },
    ];

    return (
      <div className="mx-auto w-full max-w-7xl">
        <div className="mb-4 flex items-center gap-1.5 text-sm text-white/45">
          <button onClick={() => navigateTo({ type: "menu" })} className="hover:text-white transition-colors">
            Adminland
          </button>
          <ChevronRight className="h-3.5 w-3.5 text-white/25" aria-hidden="true" />
          <span className="text-white font-medium">Integrations</span>
        </div>

        <div className="mb-5 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <h1 className="text-2xl font-semibold text-white">Integrations</h1>
            <p className="mt-1 text-sm text-white/45">Connection health, customer mapping, and configuration.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={runHeartbeat}
              disabled={heartbeatRunning || integrationLoading}
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-white/10 bg-white/[0.025] px-3 text-sm font-medium text-white/75 transition-colors hover:border-white/20 hover:bg-white/[0.06] hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RefreshCw className={cn("h-4 w-4", heartbeatRunning && "animate-spin")} aria-hidden="true" />
              {heartbeatRunning ? "Checking" : "Run health checks"}
            </button>
            <button
              onClick={() => navigateTo({ type: "automapper" })}
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-red-700 px-3 text-sm font-semibold text-white transition-colors hover:bg-red-600"
            >
              <WandSparkles className="h-4 w-4" aria-hidden="true" />
              Customer mapping
            </button>
          </div>
        </div>

        {integrationError && (
          <div className="mb-4 flex items-center gap-3 rounded-lg border border-amber-500/25 bg-amber-500/[0.07] px-4 py-3 text-sm text-amber-200" role="alert">
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="flex-1">{integrationError}</span>
            <button onClick={() => loadIntegrationData()} className="font-semibold text-amber-100 hover:text-white">
              Retry
            </button>
          </div>
        )}

        <div className="mb-5 grid grid-cols-2 overflow-hidden rounded-lg border border-white/10 bg-white/[0.02] lg:grid-cols-4">
          {[
            { label: "Configured", value: configuredCount, detail: `of ${integrationRows.length} integrations`, icon: Link2, color: "text-sky-300" },
            { label: "Healthy", value: healthyCount, detail: "passing health checks", icon: CheckCircle2, color: "text-emerald-300" },
            { label: "Needs attention", value: attentionCount, detail: attentionCount === 1 ? "integration" : "integrations", icon: AlertTriangle, color: attentionCount > 0 ? "text-amber-300" : "text-white/35" },
            { label: "Customer mappings", value: mappingTotal, detail: "active mappings", icon: WandSparkles, color: "text-violet-300" },
          ].map((metric, index) => {
            const MetricIcon = metric.icon;
            return (
              <div
                key={metric.label}
                className={cn(
                  "flex min-h-24 items-center gap-3 px-4 py-4",
                  index % 2 === 1 && "border-l border-white/10",
                  index >= 2 && "border-t border-white/10 lg:border-t-0",
                  index === 2 && "lg:border-l lg:border-white/10",
                )}
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/[0.04]">
                  <MetricIcon className={cn("h-4 w-4", metric.color)} aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-medium text-white/45">{metric.label}</p>
                  <div className="mt-0.5 flex items-baseline gap-2">
                    <span className="text-xl font-semibold text-white">{integrationLoading ? "..." : metric.value}</span>
                    <span className="hidden truncate text-xs text-white/30 sm:inline">{metric.detail}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <label className="relative block w-full lg:max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30" aria-hidden="true" />
            <input
              value={integrationQuery}
              onChange={(event) => setIntegrationQuery(event.target.value)}
              placeholder="Search integrations"
              aria-label="Search integrations"
              className="h-10 w-full rounded-lg border border-white/10 bg-white/[0.025] pl-9 pr-3 text-sm text-white outline-none transition-colors placeholder:text-white/25 focus:border-white/25 focus:bg-white/[0.04]"
            />
          </label>
          <div className="flex flex-wrap gap-1 rounded-lg border border-white/10 bg-white/[0.02] p-1" aria-label="Integration status filters">
            {filters.map((filter) => (
              <button
                key={filter.key}
                onClick={() => setIntegrationFilter(filter.key)}
                className={cn(
                  "h-8 rounded-md px-2.5 text-xs font-medium transition-colors",
                  integrationFilter === filter.key
                    ? "bg-white/10 text-white"
                    : "text-white/40 hover:bg-white/[0.04] hover:text-white/70",
                )}
              >
                {filter.label} <span className="ml-1 text-white/30">{integrationLoading ? "..." : filter.count}</span>
              </button>
            ))}
          </div>
        </div>

        {integrationLoading ? (
          <div className="flex min-h-52 items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.015] text-sm text-white/40">
            <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" />
            Loading integrations
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="flex min-h-52 flex-col items-center justify-center rounded-lg border border-white/10 bg-white/[0.015] px-6 text-center">
            <Search className="mb-3 h-5 w-5 text-white/25" aria-hidden="true" />
            <p className="text-sm font-medium text-white/70">No integrations found</p>
            <p className="mt-1 text-xs text-white/35">Adjust the search or status filter.</p>
          </div>
        ) : (
          <div>
            <div className="mb-2 hidden grid-cols-[minmax(280px,1.5fr)_minmax(155px,0.7fr)_120px_minmax(190px,0.85fr)_20px] items-center gap-4 px-4 text-[11px] font-semibold text-white/30 lg:grid">
              <span>Integration</span>
              <span>Status</span>
              <span>Customers</span>
              <span>Last check</span>
              <span />
            </div>
            <div className="space-y-3">
              {filteredGroups.map((group) => {
                const groupAttention = group.rows.filter((row) => row.state === "attention").length;
                const groupConfigured = group.rows.filter((row) => row.state !== "not_configured").length;

                return (
                  <section key={group.category} className="overflow-hidden rounded-lg border border-white/10 bg-white/[0.015]">
                    <div className="flex min-h-11 items-center justify-between gap-3 border-b border-white/[0.08] bg-white/[0.025] px-4 py-2">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <h2 className="truncate text-xs font-semibold text-white/70">{group.category}</h2>
                        <span className="text-[11px] text-white/30">{group.rows.length}</span>
                      </div>
                      {groupAttention > 0 ? (
                        <span className="inline-flex shrink-0 items-center gap-1.5 text-[11px] font-medium text-amber-300">
                          <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                          {groupAttention} needs attention
                        </span>
                      ) : groupConfigured > 0 ? (
                        <span className="inline-flex shrink-0 items-center gap-1.5 text-[11px] font-medium text-emerald-300/75">
                          <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                          {groupConfigured} connected
                        </span>
                      ) : (
                        <span className="text-[11px] text-white/30">Not configured</span>
                      )}
                    </div>

                    {group.rows.map((integration, index) => {
                      const ServiceIcon = SERVICE_ICONS[integration.service] ?? Link2;
                      const stateMeta = INTEGRATION_STATE_META[integration.state];
                      const StateIcon = stateMeta.icon;
                      const lastCheck = formatLastCheck(integration.service);
                      const healthMessage = integrationHealth[integration.service]?.message;
                      const mapCount = mappingCounts[integration.service] ?? 0;
                      const mappingLabel = NO_MAPPING_SERVICES.has(integration.service)
                        ? "Not required"
                        : integration.state === "not_configured"
                          ? "-"
                          : `${mapCount} mapped`;

                      return (
                        <button
                          key={integration.id}
                          onClick={() => navigateTo({ type: "integration", item: integration })}
                          className={cn(
                            "group grid min-h-18 w-full grid-cols-[minmax(0,1fr)_20px] items-center gap-4 px-4 py-3 text-left transition-colors hover:bg-white/[0.04] focus-visible:bg-white/[0.04] focus-visible:outline-none",
                            "lg:grid-cols-[minmax(280px,1.5fr)_minmax(155px,0.7fr)_120px_minmax(190px,0.85fr)_20px]",
                            index > 0 && "border-t border-white/[0.07]",
                          )}
                        >
                          <div className="flex min-w-0 items-center gap-3">
                            <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", integration.iconBg)}>
                              <ServiceIcon className={cn("h-4 w-4", integration.iconColor)} aria-hidden="true" />
                            </div>
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold text-white/90">{integration.label}</p>
                              <p className="mt-0.5 truncate text-xs text-white/40">{integration.desc}</p>
                              <div className="mt-2 flex flex-wrap items-center gap-2 lg:hidden">
                                <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold", stateMeta.className)}>
                                  <StateIcon className="h-3 w-3" aria-hidden="true" />
                                  {stateMeta.label}
                                </span>
                                {!NO_MAPPING_SERVICES.has(integration.service) && integration.state !== "not_configured" && (
                                  <span className="text-[11px] text-white/35">{mappingLabel}</span>
                                )}
                              </div>
                            </div>
                          </div>
                          <span className={cn("hidden w-fit items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] font-semibold lg:inline-flex", stateMeta.className)}>
                            <StateIcon className="h-3 w-3" aria-hidden="true" />
                            {stateMeta.label}
                          </span>
                          <span className="hidden text-xs text-white/50 lg:block">{mappingLabel}</span>
                          <div className="hidden min-w-0 lg:block">
                            <p className="truncate text-xs text-white/50">
                              {integration.state === "not_configured" ? "Never" : (lastCheck ?? "Pending")}
                            </p>
                            {integration.state === "attention" && healthMessage && (
                              <p className="mt-0.5 truncate text-[11px] text-amber-300/60" title={healthMessage}>{healthMessage}</p>
                            )}
                          </div>
                          <ChevronRight className="h-4 w-4 text-white/20 transition-colors group-hover:text-white/55" aria-hidden="true" />
                        </button>
                      );
                    })}
                  </section>
                );
              })}
            </div>
          </div>
        )}

        {!integrationLoading && filteredRows.length > 0 && (
          <p className="mt-3 text-xs text-white/30">
            Showing {filteredRows.length} of {integrationRows.length} integrations across {filteredGroups.length} categories.
          </p>
        )}
      </div>
    );
  }

  if (activeView.type === "automapper") {
    return (
      <div className="mx-auto w-full max-w-5xl">
        <div className="mb-5 flex items-center gap-1.5 text-sm text-white/45">
          <button onClick={() => navigateTo({ type: "menu" })} className="hover:text-white transition-colors">
            Adminland
          </button>
          <ChevronRight className="h-3.5 w-3.5 text-white/25" aria-hidden="true" />
          <button onClick={() => navigateTo({ type: "integrations" })} className="hover:text-white transition-colors">
            Integrations
          </button>
          <ChevronRight className="h-3.5 w-3.5 text-white/25" aria-hidden="true" />
          <span className="text-white font-medium">AutoMapper</span>
        </div>
        <div className="rounded-lg border border-white/10 bg-white/[0.015] p-4 sm:p-6">
          <AutoMapperConfig
            item={{
              id: "automapper",
              service: "automapper",
              label: "AutoMapper",
              desc: "Match customers across Halo and connected integrations.",
              iconBg: "bg-red-500/10",
              iconColor: "text-red-400",
            }}
            onBack={() => navigateTo({ type: "integrations" })}
          />
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
      <div className="mx-auto w-full max-w-5xl">
        <div className="mb-5 flex items-center gap-1.5 text-sm text-white/45">
          <button onClick={() => navigateTo({ type: "menu" })} className="hover:text-white transition-colors">
            Adminland
          </button>
          <ChevronRight className="h-3.5 w-3.5 text-white/25" aria-hidden="true" />
          <span className="text-white font-medium">{sectionLabel}</span>
        </div>
        {activeView.id === "users" ? (
          <UsersSecuritySection />
        ) : activeView.id === "agent-config" ? (
          <AgentConfigSection />
        ) : activeView.id === "halo-agents" ? (
          <HaloAgentsSection />
        ) : activeView.id === "halo-statuses" ? (
          <HaloStatusesSection />
        ) : activeView.id === "triage-rules" ? (
          <TriageRulesSection />
        ) : activeView.id === "cron-jobs" ? (
          <CronJobsSection />
        ) : activeView.id === "diagnostics" ? (
          <DiagnosticsSection />
        ) : activeView.id === "health" ? (
          <HealthSection />
        ) : activeView.id === "tv-access" ? (
          <TvAccessSection />
        ) : activeView.id === "branding" ? (
          <BrandingSettings />
        ) : (
          <div className="rounded-lg border border-white/10 bg-white/[0.015] p-8 text-center">
            <p className="text-sm text-white/50">
              This section is coming soon.
            </p>
          </div>
        )}
      </div>
    );
  }

  // ── Main menu ──────────────────────────────────────────────────────

  const adminItems = MENU_GROUPS.flatMap((group) => group.items);
  const normalizedAdminQuery = adminQuery.trim().toLowerCase();
  const filteredMenuGroups = MENU_GROUPS
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => (
        !normalizedAdminQuery
        || item.label.toLowerCase().includes(normalizedAdminQuery)
        || item.desc.toLowerCase().includes(normalizedAdminQuery)
        || group.title.toLowerCase().includes(normalizedAdminQuery)
      )),
    }))
    .filter((group) => group.items.length > 0);
  const integrationStates = INTEGRATION_CATEGORIES.flatMap((group) => group.items)
    .map((item) => getIntegrationState(item.service));
  const configuredIntegrations = integrationStates.filter((state) => state !== "not_configured").length;
  const healthyIntegrations = integrationStates.filter((state) => state === "healthy").length;
  const attentionIntegrations = integrationStates.filter((state) => state === "attention").length;

  return (
    <div className="mx-auto w-full max-w-7xl">
      <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-red-700 text-white shadow-[0_0_24px_rgba(185,28,28,0.2)]">
            <ShieldCheck className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold text-white">Adminland</h1>
            <p className="mt-0.5 text-sm text-white/45">System configuration, access, and operations.</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => navigateTo({ type: "integrations" })}
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-white/10 bg-white/[0.025] px-3 text-sm font-medium text-white/70 transition-colors hover:border-white/20 hover:bg-white/[0.06] hover:text-white"
          >
            <PlugZap className="h-4 w-4" aria-hidden="true" />
            Integrations
          </button>
          <button
            onClick={() => navigateTo({ type: "section", id: "diagnostics" })}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-red-700 px-3 text-sm font-semibold text-white transition-colors hover:bg-red-600"
          >
            <Stethoscope className="h-4 w-4" aria-hidden="true" />
            Run diagnostics
          </button>
        </div>
      </div>

      <div className="mb-6 grid grid-cols-2 overflow-hidden rounded-lg border border-white/10 bg-white/[0.02] lg:grid-cols-4">
        {[
          { label: "Configuration areas", value: adminItems.length, detail: "admin controls", icon: Settings2, color: "text-violet-300" },
          { label: "Connected", value: configuredIntegrations, detail: `of ${integrationStates.length} services`, icon: Link2, color: "text-sky-300" },
          { label: "Healthy", value: healthyIntegrations, detail: "integrations", icon: CheckCircle2, color: "text-emerald-300" },
          { label: "Needs attention", value: attentionIntegrations, detail: attentionIntegrations === 1 ? "integration" : "integrations", icon: AlertTriangle, color: attentionIntegrations > 0 ? "text-amber-300" : "text-white/35" },
        ].map((metric, index) => {
          const MetricIcon = metric.icon;
          return (
            <div
              key={metric.label}
              className={cn(
                "flex min-h-24 items-center gap-3 px-4 py-4",
                index % 2 === 1 && "border-l border-white/10",
                index >= 2 && "border-t border-white/10 lg:border-t-0",
                index === 2 && "lg:border-l lg:border-white/10",
              )}
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/[0.04]">
                <MetricIcon className={cn("h-4 w-4", metric.color)} aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium text-white/45">{metric.label}</p>
                <div className="mt-0.5 flex items-baseline gap-2">
                  <span className="text-xl font-semibold text-white">
                    {integrationLoading && index > 0 ? "..." : metric.value}
                  </span>
                  <span className="hidden truncate text-xs text-white/30 sm:inline">{metric.detail}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {integrationError && (
        <div className="mb-5 flex items-center gap-3 rounded-lg border border-amber-500/25 bg-amber-500/[0.07] px-4 py-3 text-sm text-amber-200" role="alert">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="flex-1">Integration health is temporarily unavailable.</span>
          <button onClick={() => loadIntegrationData()} className="font-semibold text-amber-100 hover:text-white">Retry</button>
        </div>
      )}

      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-white/90">Configuration</h2>
          <p className="mt-0.5 text-xs text-white/35">{adminItems.length} controls across {MENU_GROUPS.length} operational areas</p>
        </div>
        <label className="relative block w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30" aria-hidden="true" />
          <input
            value={adminQuery}
            onChange={(event) => setAdminQuery(event.target.value)}
            placeholder="Search settings"
            aria-label="Search Adminland settings"
            className="h-10 w-full rounded-lg border border-white/10 bg-white/[0.025] pl-9 pr-3 text-sm text-white outline-none transition-colors placeholder:text-white/25 focus:border-white/25 focus:bg-white/[0.04]"
          />
        </label>
      </div>

      {filteredMenuGroups.length === 0 ? (
        <div className="flex min-h-52 flex-col items-center justify-center rounded-lg border border-white/10 bg-white/[0.015] px-6 text-center">
          <Search className="mb-3 h-5 w-5 text-white/25" aria-hidden="true" />
          <p className="text-sm font-medium text-white/70">No settings found</p>
          <p className="mt-1 text-xs text-white/35">Try a different search.</p>
        </div>
      ) : (
        <div className="grid items-start gap-4 md:grid-cols-2 xl:grid-cols-4">
          {filteredMenuGroups.map((group) => (
            <section key={group.title} className="overflow-hidden rounded-lg border border-white/10 bg-white/[0.015]">
              <div className="flex min-h-11 items-center justify-between border-b border-white/[0.08] bg-white/[0.025] px-4 py-2">
                <h3 className="text-xs font-semibold text-white/65">{group.title}</h3>
                <span className="text-[11px] text-white/30">{group.items.length}</span>
              </div>
              <div className="divide-y divide-white/[0.07]">
                {group.items.map((item) => {
                  const AdminIcon = ADMIN_ICONS[item.id] ?? Settings2;
                  return (
                    <button
                      key={item.id}
                      onClick={() => (
                        item.id === "integrations"
                          ? navigateTo({ type: "integrations" })
                          : navigateTo({ type: "section", id: item.id })
                      )}
                      className="group flex min-h-18 w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-white/[0.04] focus-visible:bg-white/[0.04] focus-visible:outline-none"
                    >
                      <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", item.iconBg)}>
                        <AdminIcon className={cn("h-4 w-4", item.iconColor)} aria-hidden="true" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-white/85">{item.label}</p>
                        <p className="mt-0.5 line-clamp-2 text-xs leading-4 text-white/35">{item.desc}</p>
                      </div>
                      <ChevronRight className="h-4 w-4 shrink-0 text-white/20 transition-colors group-hover:text-white/55" aria-hidden="true" />
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

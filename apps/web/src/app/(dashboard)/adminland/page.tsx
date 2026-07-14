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
  Cloud,
  Database,
  FileKey2,
  FileText,
  Link2,
  MessageSquare,
  Network,
  PhoneCall,
  RefreshCw,
  Search,
  ShieldCheck,
  WandSparkles,
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
  workers: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 8V4H8" /><rect width="16" height="12" x="4" y="8" rx="2" />
      <path d="M2 14h2" /><path d="M20 14h2" /><path d="M15 13v2" /><path d="M9 13v2" />
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
  health: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </svg>
  ),
};

const CHEVRON_RIGHT = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m9 18 6-6-6-6" />
  </svg>
);

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
      })
      .sort((left, right) => {
        const priority: Record<IntegrationState, number> = {
          attention: 0,
          healthy: 1,
          pending: 2,
          not_configured: 3,
        };
        return priority[left.state] - priority[right.state] || left.label.localeCompare(right.label);
      });
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
                    <span className="truncate text-xs text-white/30">{metric.detail}</span>
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

        <div className="overflow-hidden rounded-lg border border-white/10 bg-white/[0.015]">
          <div className="hidden min-h-10 grid-cols-[minmax(260px,1.5fr)_minmax(145px,0.65fr)_minmax(150px,0.7fr)_110px_minmax(180px,0.9fr)_20px] items-center gap-4 border-b border-white/10 bg-white/[0.025] px-4 text-[11px] font-semibold text-white/35 lg:grid">
            <span>Integration</span>
            <span>Category</span>
            <span>Status</span>
            <span>Customers</span>
            <span>Last check</span>
            <span />
          </div>

          {integrationLoading ? (
            <div className="flex min-h-52 items-center justify-center gap-2 text-sm text-white/40">
              <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" />
              Loading integrations
            </div>
          ) : filteredRows.length === 0 ? (
            <div className="flex min-h-52 flex-col items-center justify-center px-6 text-center">
              <Search className="mb-3 h-5 w-5 text-white/25" aria-hidden="true" />
              <p className="text-sm font-medium text-white/70">No integrations found</p>
              <p className="mt-1 text-xs text-white/35">Adjust the search or status filter.</p>
            </div>
          ) : (
            filteredRows.map((integration, index) => {
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
                    "group grid min-h-20 w-full grid-cols-[minmax(0,1fr)_20px] items-center gap-4 px-4 py-3 text-left transition-colors hover:bg-white/[0.04] focus-visible:bg-white/[0.04] focus-visible:outline-none",
                    "lg:grid-cols-[minmax(260px,1.5fr)_minmax(145px,0.65fr)_minmax(150px,0.7fr)_110px_minmax(180px,0.9fr)_20px]",
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
                        <span className="text-[11px] text-white/35">{integration.category}</span>
                        {!NO_MAPPING_SERVICES.has(integration.service) && integration.state !== "not_configured" && (
                          <span className="text-[11px] text-white/35">{mappingLabel}</span>
                        )}
                      </div>
                    </div>
                  </div>

                  <span className="hidden truncate text-xs text-white/45 lg:block">{integration.category}</span>
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
            })
          )}
        </div>

        {!integrationLoading && filteredRows.length > 0 && (
          <p className="mt-3 text-xs text-white/30">
            Showing {filteredRows.length} of {integrationRows.length} integrations. Attention items appear first.
          </p>
        )}
      </div>
    );
  }

  if (activeView.type === "automapper") {
    return (
      <div className="mx-auto max-w-4xl">
        <div className="mb-6 flex items-center gap-2 text-sm text-white/50">
          <button onClick={() => navigateTo({ type: "menu" })} className="hover:text-white transition-colors">
            Adminland
          </button>
          <span className="text-white/30">{CHEVRON_RIGHT}</span>
          <button onClick={() => navigateTo({ type: "integrations" })} className="hover:text-white transition-colors">
            Integrations
          </button>
          <span className="text-white/30">{CHEVRON_RIGHT}</span>
          <span className="text-white font-medium">AutoMapper</span>
        </div>
        <div
          className="rounded-xl border border-white/10 p-6"
          style={{ backgroundColor: "#241010" }}
        >
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

"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { INTEGRATION_DEFINITIONS } from "@triageit/shared";
import type { IntegrationItem } from "./adminland-constants";
import { cn } from "@/lib/utils/cn";

interface IntegrationConfigProps {
  readonly item: IntegrationItem;
  readonly onBack: () => void;
}

interface MappingRow {
  readonly id: string;
  readonly external_id: string;
  readonly external_name: string;
  readonly customer_name: string | null;
  readonly customer_id: string | null;
}

type ConnectionStatus = "connected" | "configured" | "not_configured";

export function IntegrationConfig({ item, onBack }: IntegrationConfigProps) {
  const definition = INTEGRATION_DEFINITIONS.find(
    (d) => d.service === item.service,
  );
  const supabase = createClient();

  const [status, setStatus] = useState<ConnectionStatus>("not_configured");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [integrationId, setIntegrationId] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [mappings, setMappings] = useState<ReadonlyArray<MappingRow>>([]);
  const [activeTab, setActiveTab] = useState<"config" | "mappings">("config");

  useEffect(() => {
    loadIntegration();
  }, [item.service]);

  async function loadIntegration() {
    const { data } = await supabase
      .from("integrations")
      .select("*")
      .eq("service", item.service)
      .single();

    if (data) {
      setIntegrationId(data.id);
      const config = data.config as Record<string, string>;
      const initial: Record<string, string> = {};
      for (const field of definition?.fields ?? []) {
        initial[field.key] = config[field.key] ?? "";
      }
      setValues(initial);
      setStatus(data.is_active ? "connected" : "configured");
      loadMappings(data.id);
    } else {
      const initial: Record<string, string> = {};
      for (const field of definition?.fields ?? []) {
        initial[field.key] = "";
      }
      setValues(initial);
    }
  }

  async function loadMappings(intId: string) {
    const { data } = await supabase
      .from("integration_mappings")
      .select("*")
      .eq("integration_id", intId)
      .order("external_name", { ascending: true });

    setMappings(data ?? []);
  }

  function handleFieldChange(key: string, value: string) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    setSaving(true);
    setError(null);

    const missingRequired = (definition?.fields ?? []).filter(
      (f) => f.required && !values[f.key]?.trim(),
    );
    if (missingRequired.length > 0) {
      setError(`Missing: ${missingRequired.map((f) => f.label).join(", ")}`);
      setSaving(false);
      return;
    }

    const payload = {
      service: item.service,
      display_name: item.label,
      config: values,
      is_active: true,
      health_status: "unknown" as const,
      updated_at: new Date().toISOString(),
    };

    if (integrationId) {
      const { error: dbError } = await supabase
        .from("integrations")
        .update(payload)
        .eq("id", integrationId);
      if (dbError) setError(dbError.message);
      else setStatus("connected");
    } else {
      const { data, error: dbError } = await supabase
        .from("integrations")
        .insert(payload)
        .select("id")
        .single();
      if (dbError) setError(dbError.message);
      else if (data) {
        setIntegrationId(data.id);
        setStatus("connected");
      }
    }
    setSaving(false);
  }

  async function handleDeleteMapping(mappingId: string) {
    await supabase
      .from("integration_mappings")
      .delete()
      .eq("id", mappingId);
    if (integrationId) loadMappings(integrationId);
  }

  async function handleAddMapping(
    externalId: string,
    externalName: string,
    customerName?: string,
    customerId?: string,
  ) {
    if (!integrationId) return;
    await supabase.from("integration_mappings").insert({
      integration_id: integrationId,
      service: item.service,
      external_id: externalId,
      external_name: externalName,
      customer_name: customerName ?? null,
      customer_id: customerId ?? null,
    });
    loadMappings(integrationId);
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-white/50 transition-colors hover:bg-white/5 hover:text-white"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m15 18-6-6 6-6" />
          </svg>
        </button>
        <div className={cn("flex h-10 w-10 items-center justify-center rounded-lg", item.iconBg)}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className={item.iconColor}>
            <path d="M12 22v-5" /><path d="M9 8V2" /><path d="M15 8V2" />
            <path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z" />
          </svg>
        </div>
        <div>
          <h3 className="text-lg font-semibold text-white">{item.label}</h3>
          <p className="text-sm text-white/50">{item.desc}</p>
        </div>
      </div>

      {/* Status bar */}
      <div className={cn(
        "flex items-center gap-2 rounded-lg px-4 py-3 text-sm",
        status === "connected" ? "bg-emerald-500/10 text-emerald-400" :
        status === "configured" ? "bg-amber-500/10 text-amber-400" :
        "bg-white/5 text-white/50",
      )}>
        <span className={cn(
          "inline-block h-2 w-2 rounded-full",
          status === "connected" ? "bg-emerald-400" :
          status === "configured" ? "bg-amber-400" :
          "bg-white/30",
        )} />
        {status === "connected" ? "Connected" :
         status === "configured" ? "Configured — not tested" :
         "Not configured"}
      </div>

      {/* Tabs — hide mapping tab for services that don't need it.
          Halo is the source of truth so it doesn't need customer mapping. */}
      {!["teams", "ai-provider", "halo"].includes(item.service) && (
        <div className="flex gap-1 border-b border-white/10">
          <button
            onClick={() => setActiveTab("config")}
            className={cn(
              "px-4 py-2 text-sm font-medium transition-colors",
              activeTab === "config"
                ? "border-b-2 border-[#b91c1c] text-white"
                : "text-white/50 hover:text-white",
            )}
          >
            Configuration
          </button>
          <button
            onClick={() => setActiveTab("mappings")}
            className={cn(
              "px-4 py-2 text-sm font-medium transition-colors",
              activeTab === "mappings"
                ? "border-b-2 border-[#b91c1c] text-white"
                : "text-white/50 hover:text-white",
            )}
          >
            Customer Mapping
            {mappings.length > 0 && (
              <span className="ml-2 rounded-full bg-[#b91c1c]/20 px-2 py-0.5 text-xs text-[#b91c1c]">
                {mappings.length}
              </span>
            )}
          </button>
        </div>
      )}

      {/* Config tab */}
      {activeTab === "config" && (
        <div className="space-y-4">
          {(definition?.fields ?? []).map((field) => (
            <div key={field.key}>
              <label className="mb-1 block text-sm font-medium text-white/70">
                {field.label}
                {field.required && <span className="text-red-400"> *</span>}
              </label>
              {field.type === "select" && field.options ? (
                <div className="flex gap-2">
                  {field.options.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => handleFieldChange(field.key, opt.value)}
                      className={cn(
                        "flex-1 rounded-lg border px-4 py-2.5 text-sm font-medium transition-all",
                        values[field.key] === opt.value
                          ? "border-[#b91c1c] bg-[#b91c1c]/10 text-white"
                          : "border-white/10 bg-white/5 text-white/50 hover:border-white/20 hover:text-white",
                      )}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              ) : (
                <input
                  type={field.type === "password" ? "password" : "text"}
                  value={values[field.key] ?? ""}
                  onChange={(e) => handleFieldChange(field.key, e.target.value)}
                  placeholder={field.placeholder}
                  className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white outline-none placeholder:text-white/30 focus:border-[#b91c1c] focus:ring-1 focus:ring-[#b91c1c]"
                />
              )}
            </div>
          ))}

          {error && (
            <p className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-400">
              {error}
            </p>
          )}

          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded-lg bg-[#b91c1c] px-4 py-2.5 text-sm font-semibold text-white transition-all hover:bg-[#a31919] disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save Configuration"}
          </button>
        </div>
      )}

      {/* Mappings tab */}
      {activeTab === "mappings" && (
        <CustomerMappingTab
          service={item.service}
          integrationId={integrationId}
          mappings={mappings}
          onAddMapping={handleAddMapping}
          onDeleteMapping={handleDeleteMapping}
        />
      )}
    </div>
  );
}

// ── Customer Mapping Tab ──────────────────────────────────────────────

interface ExternalCustomer {
  readonly id: number | string;
  readonly name: string;
  readonly is_active: boolean;
}

interface CustomerMappingTabProps {
  readonly service: string;
  readonly integrationId: string | null;
  readonly mappings: ReadonlyArray<MappingRow>;
  readonly onAddMapping: (
    externalId: string,
    externalName: string,
    customerName?: string,
    customerId?: string,
  ) => void;
  readonly onDeleteMapping: (mappingId: string) => void;
}

interface AutoMapSuggestion {
  readonly externalId: string;
  readonly externalName: string;
  readonly haloId: string;
  readonly haloName: string;
  readonly confidence: number;
  readonly matchType: "exact" | "normalized" | "fuzzy";
}

function normalize(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b(inc|llc|ltd|corp|co|the|company|group|services|solutions)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0) as number[]);
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function findBestHaloMatch(
  extName: string,
  haloCusts: ReadonlyArray<ExternalCustomer>,
): AutoMapSuggestion | null {
  const extLower = extName.toLowerCase().trim();
  const extNorm = normalize(extName);

  for (const hc of haloCusts) {
    if (hc.name.toLowerCase().trim() === extLower) {
      return { externalId: "", externalName: extName, haloId: String(hc.id), haloName: hc.name, confidence: 100, matchType: "exact" };
    }
  }
  for (const hc of haloCusts) {
    if (normalize(hc.name) === extNorm && extNorm.length > 2) {
      return { externalId: "", externalName: extName, haloId: String(hc.id), haloName: hc.name, confidence: 95, matchType: "normalized" };
    }
  }

  let bestScore = 0;
  let bestCustomer: ExternalCustomer | null = null;
  for (const hc of haloCusts) {
    const hcNorm = normalize(hc.name);
    if (!hcNorm || !extNorm) continue;
    if (hcNorm.includes(extNorm) || extNorm.includes(hcNorm)) {
      const lenRatio = Math.min(hcNorm.length, extNorm.length) / Math.max(hcNorm.length, extNorm.length);
      const score = 70 + lenRatio * 20;
      if (score > bestScore) { bestScore = score; bestCustomer = hc; }
      continue;
    }
    const maxLen = Math.max(hcNorm.length, extNorm.length);
    if (maxLen === 0) continue;
    const dist = levenshtein(hcNorm, extNorm);
    const similarity = ((maxLen - dist) / maxLen) * 100;
    if (similarity > bestScore) { bestScore = similarity; bestCustomer = hc; }
  }
  if (bestCustomer && bestScore >= 70) {
    return { externalId: "", externalName: extName, haloId: String(bestCustomer.id), haloName: bestCustomer.name, confidence: Math.round(bestScore), matchType: "fuzzy" };
  }
  return null;
}

function CustomerMappingTab({
  service,
  integrationId,
  mappings,
  onAddMapping,
  onDeleteMapping,
}: CustomerMappingTabProps) {
  const [externalCustomers, setExternalCustomers] = useState<ReadonlyArray<ExternalCustomer>>([]);
  const [haloCustomers, setHaloCustomers] = useState<ReadonlyArray<ExternalCustomer>>([]);
  const [loading, setLoading] = useState(false);
  const [loadingHalo, setLoadingHalo] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [searchExternal, setSearchExternal] = useState("");
  const [mappingTarget, setMappingTarget] = useState<{
    externalId: string;
    externalName: string;
  } | null>(null);
  const [haloSearch, setHaloSearch] = useState("");
  const [autoMapSuggestions, setAutoMapSuggestions] = useState<ReadonlyArray<AutoMapSuggestion>>([]);
  const [autoMapSelected, setAutoMapSelected] = useState<Set<string>>(new Set());
  const [showAutoMap, setShowAutoMap] = useState(false);

  const isHaloService = service === "halo";
  const serviceLabel = service.charAt(0).toUpperCase() + service.slice(1);

  async function loadExternalCustomers() {
    setLoading(true);
    setFetchError(null);
    try {
      const response = await fetch(
        `/api/integrations/customers?service=${encodeURIComponent(service)}`,
      );
      if (!response.ok) {
        const data = await response.json();
        setFetchError(data.error ?? "Failed to fetch customers");
        setLoading(false);
        return;
      }
      const data = await response.json();
      setExternalCustomers(data.customers ?? []);
    } catch (err) {
      setFetchError((err as Error).message);
    }
    setLoading(false);
  }

  async function loadHaloCustomers() {
    setLoadingHalo(true);
    try {
      const response = await fetch("/api/halo/customers");
      if (response.ok) {
        const data = await response.json();
        setHaloCustomers(data.customers ?? []);
      }
    } catch {
      // Halo customers are optional for non-Halo integrations
    }
    setLoadingHalo(false);
  }

  useEffect(() => {
    if (integrationId) {
      loadExternalCustomers();
      if (!isHaloService) {
        loadHaloCustomers();
      }
    }
  }, [integrationId, service]);

  if (!integrationId) {
    return (
      <p className="text-sm text-white/50">
        Configure the integration first before setting up customer mappings.
      </p>
    );
  }

  const mappedExternalIds = new Set(mappings.map((m) => m.external_id));
  const unmappedCustomers = externalCustomers.filter(
    (c) => !mappedExternalIds.has(String(c.id)),
  );

  const filteredUnmapped = searchExternal.trim()
    ? unmappedCustomers.filter((c) =>
        c.name.toLowerCase().includes(searchExternal.toLowerCase()),
      )
    : unmappedCustomers;

  const filteredHaloCustomers = haloSearch.trim()
    ? haloCustomers.filter((c) =>
        c.name.toLowerCase().includes(haloSearch.toLowerCase()),
      )
    : haloCustomers;

  function handleMapClick(externalId: string, externalName: string) {
    if (isHaloService) {
      onAddMapping(externalId, externalName, externalName, externalId);
    } else {
      setMappingTarget({ externalId, externalName });
      setHaloSearch("");
    }
  }

  function handleSelectHaloCustomer(haloCustomer: ExternalCustomer) {
    if (!mappingTarget) return;
    onAddMapping(
      mappingTarget.externalId,
      mappingTarget.externalName,
      haloCustomer.name,
      String(haloCustomer.id),
    );
    setMappingTarget(null);
    setHaloSearch("");
  }

  return (
    <div className="space-y-5">
      {/* Mapping picker modal */}
      {mappingTarget && (
        <div className="rounded-xl border border-[#b91c1c]/30 bg-[#b91c1c]/5 p-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <p className="text-xs text-white/50">
                Mapping {serviceLabel} customer
              </p>
              <p className="text-sm font-medium text-white">
                {mappingTarget.externalName}
              </p>
            </div>
            <button
              onClick={() => setMappingTarget(null)}
              className="rounded-lg px-2 py-1 text-xs text-white/50 transition-colors hover:bg-white/10 hover:text-white"
            >
              Cancel
            </button>
          </div>
          <p className="mb-2 text-xs text-white/40">
            Select the Halo PSA customer this maps to:
          </p>
          <input
            value={haloSearch}
            onChange={(e) => setHaloSearch(e.target.value)}
            placeholder="Search Halo customers..."
            autoFocus
            className="mb-2 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none placeholder:text-white/30 focus:border-[#b91c1c]"
          />
          {loadingHalo ? (
            <div className="flex items-center justify-center py-4">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/20 border-t-white/60" />
            </div>
          ) : (
            <div className="max-h-48 space-y-0.5 overflow-y-auto rounded-lg border border-white/10 bg-white/[0.02] p-1.5">
              {filteredHaloCustomers.map((hc) => (
                <button
                  key={hc.id}
                  onClick={() => handleSelectHaloCustomer(hc)}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-white transition-colors hover:bg-[#b91c1c]/10"
                >
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-blue-500/10 text-[10px] font-bold text-blue-400">
                    {hc.name.charAt(0).toUpperCase()}
                  </span>
                  <span className="min-w-0 truncate">{hc.name}</span>
                  <span className="ml-auto shrink-0 text-xs text-white/20">
                    #{hc.id}
                  </span>
                </button>
              ))}
              {filteredHaloCustomers.length === 0 && (
                <p className="px-3 py-3 text-center text-xs text-white/30">
                  {haloCustomers.length === 0
                    ? "No Halo customers loaded. Is Halo PSA configured?"
                    : "No match found"}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Mapped customers */}
      {mappings.length > 0 && (
        <div>
          <h4 className="mb-2 text-sm font-medium text-white/70">
            Mapped ({mappings.length})
          </h4>
          <div className="overflow-hidden rounded-lg border border-white/10">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 bg-white/5">
                  <th className="px-4 py-2.5 text-left font-medium text-white/50">
                    {serviceLabel} Customer
                  </th>
                  {!isHaloService && (
                    <th className="px-4 py-2.5 text-center font-medium text-white/50">
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        className="mx-auto"
                      >
                        <path d="M8 12h8" />
                        <path d="m12 8 4 4-4 4" />
                      </svg>
                    </th>
                  )}
                  {!isHaloService && (
                    <th className="px-4 py-2.5 text-left font-medium text-white/50">
                      Halo Customer
                    </th>
                  )}
                  <th className="px-4 py-2.5 text-right font-medium text-white/50" />
                </tr>
              </thead>
              <tbody>
                {mappings.map((m) => (
                  <tr
                    key={m.id}
                    className="border-b border-white/5 transition-colors hover:bg-white/5"
                  >
                    <td className="px-4 py-2.5">
                      <div>
                        <p className="text-white">{m.external_name}</p>
                        <p className="text-xs text-white/30">
                          ID: {m.external_id}
                        </p>
                      </div>
                    </td>
                    {!isHaloService && (
                      <td className="px-4 py-2.5 text-center">
                        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/10 text-[10px] text-emerald-400">
                          ✓
                        </span>
                      </td>
                    )}
                    {!isHaloService && (
                      <td className="px-4 py-2.5">
                        <p className="text-white/70">
                          {m.customer_name || "—"}
                        </p>
                        {m.customer_id && (
                          <p className="text-xs text-white/30">
                            ID: {m.customer_id}
                          </p>
                        )}
                      </td>
                    )}
                    <td className="px-4 py-2.5 text-right">
                      <button
                        onClick={() => onDeleteMapping(m.id)}
                        className="rounded px-2 py-1 text-xs text-red-400 transition-colors hover:bg-red-500/10"
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Unmapped customers from integration */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h4 className="text-sm font-medium text-white/70">
            {serviceLabel} Customers
            {!loading && (
              <span className="ml-2 text-xs text-white/30">
                {unmappedCustomers.length} unmapped
              </span>
            )}
          </h4>
          <div className="flex gap-2">
            {!isHaloService && unmappedCustomers.length > 0 && haloCustomers.length > 0 && (
              <button
                onClick={() => {
                  const suggestions: AutoMapSuggestion[] = [];
                  for (const ext of unmappedCustomers) {
                    const match = findBestHaloMatch(ext.name, haloCustomers);
                    if (match) {
                      suggestions.push({ ...match, externalId: String(ext.id) });
                    }
                  }
                  setAutoMapSuggestions(suggestions);
                  const autoSelect = new Set<string>();
                  for (const s of suggestions) {
                    if (s.matchType === "exact" || s.matchType === "normalized") {
                      autoSelect.add(s.externalId);
                    }
                  }
                  setAutoMapSelected(autoSelect);
                  setShowAutoMap(true);
                }}
                className="rounded-lg border border-fuchsia-500/30 bg-fuchsia-500/10 px-3 py-1.5 text-xs font-medium text-fuchsia-400 transition-colors hover:bg-fuchsia-500/20"
              >
                Auto-Map
              </button>
            )}
            <button
              onClick={() => {
                loadExternalCustomers();
                if (!isHaloService) loadHaloCustomers();
              }}
              disabled={loading}
              className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-white/50 transition-colors hover:bg-white/5 hover:text-white disabled:opacity-50"
            >
              {loading ? "Loading..." : "Refresh"}
            </button>
          </div>
        </div>

        {/* AutoMapper suggestions panel */}
        {showAutoMap && autoMapSuggestions.length > 0 && (
          <div className="mb-4 rounded-xl border border-fuchsia-500/20 bg-fuchsia-500/5 p-4">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-white">
                  AutoMapper — {autoMapSuggestions.length} matches found
                </p>
                <p className="text-xs text-white/40">
                  {autoMapSelected.size} selected · exact and normalized matches are pre-selected
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setAutoMapSelected(new Set(autoMapSuggestions.map((s) => s.externalId)));
                  }}
                  className="rounded-lg border border-white/10 px-2 py-1 text-xs text-white/50 hover:bg-white/5"
                >
                  All
                </button>
                <button
                  onClick={() => setAutoMapSelected(new Set())}
                  className="rounded-lg border border-white/10 px-2 py-1 text-xs text-white/50 hover:bg-white/5"
                >
                  None
                </button>
                <button
                  onClick={() => {
                    for (const s of autoMapSuggestions) {
                      if (autoMapSelected.has(s.externalId)) {
                        onAddMapping(s.externalId, s.externalName, s.haloName, s.haloId);
                      }
                    }
                    setShowAutoMap(false);
                    setAutoMapSuggestions([]);
                    setAutoMapSelected(new Set());
                  }}
                  disabled={autoMapSelected.size === 0}
                  className="rounded-lg bg-fuchsia-500/20 px-3 py-1 text-xs font-medium text-fuchsia-400 transition-colors hover:bg-fuchsia-500/30 disabled:opacity-50"
                >
                  Approve {autoMapSelected.size}
                </button>
                <button
                  onClick={() => {
                    setShowAutoMap(false);
                    setAutoMapSuggestions([]);
                    setAutoMapSelected(new Set());
                  }}
                  className="rounded-lg border border-white/10 px-2 py-1 text-xs text-white/50 hover:bg-white/5"
                >
                  Cancel
                </button>
              </div>
            </div>
            <div className="max-h-64 space-y-1 overflow-y-auto rounded-lg border border-white/10 bg-white/[0.02] p-1.5">
              {autoMapSuggestions.map((s) => {
                const isSelected = autoMapSelected.has(s.externalId);
                const matchColor = s.matchType === "exact" ? "bg-emerald-500/20 text-emerald-400"
                  : s.matchType === "normalized" ? "bg-blue-500/20 text-blue-400"
                  : "bg-amber-500/20 text-amber-400";
                return (
                  <div
                    key={s.externalId}
                    onClick={() => {
                      setAutoMapSelected((prev) => {
                        const next = new Set(prev);
                        if (next.has(s.externalId)) next.delete(s.externalId);
                        else next.add(s.externalId);
                        return next;
                      });
                    }}
                    className={cn(
                      "flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 transition-colors",
                      isSelected ? "bg-fuchsia-500/10" : "hover:bg-white/5",
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => {}}
                      className="h-3.5 w-3.5 shrink-0 rounded border-white/30"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-white">{s.externalName}</p>
                    </div>
                    <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium", matchColor)}>
                      {s.confidence}% {s.matchType}
                    </span>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 text-white/20">
                      <path d="M8 12h8" /><path d="m12 8 4 4-4 4" />
                    </svg>
                    <div className="min-w-0 flex-1 text-right">
                      <p className="text-sm text-white/70">{s.haloName}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {showAutoMap && autoMapSuggestions.length === 0 && (
          <div className="mb-4 rounded-xl border border-fuchsia-500/20 bg-fuchsia-500/5 p-4 text-center">
            <p className="text-sm text-white/50">No auto-matches found. Map customers manually below.</p>
            <button
              onClick={() => setShowAutoMap(false)}
              className="mt-2 text-xs text-white/40 hover:text-white"
            >
              Dismiss
            </button>
          </div>
        )}

        {fetchError && (
          <p className="mb-3 rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-400">
            {fetchError}
          </p>
        )}

        {loading && (
          <div className="flex items-center justify-center py-8">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/20 border-t-white/60" />
          </div>
        )}

        {!loading && unmappedCustomers.length > 0 && (
          <>
            <input
              value={searchExternal}
              onChange={(e) => setSearchExternal(e.target.value)}
              placeholder={`Search ${serviceLabel} customers...`}
              className="mb-3 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none placeholder:text-white/30 focus:border-[#b91c1c]"
            />
            <div className="max-h-80 space-y-1 overflow-y-auto rounded-lg border border-white/10 bg-white/[0.02] p-2">
              {filteredUnmapped.map((customer) => (
                <div
                  key={customer.id}
                  className="flex items-center justify-between rounded-lg px-3 py-2 transition-colors hover:bg-white/5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-white">{customer.name}</p>
                    <p className="text-xs text-white/30">
                      ID: {customer.id}
                    </p>
                  </div>
                  <button
                    onClick={() =>
                      handleMapClick(String(customer.id), customer.name)
                    }
                    className="shrink-0 rounded-lg bg-[#b91c1c]/10 px-3 py-1.5 text-xs font-medium text-[#b91c1c] transition-colors hover:bg-[#b91c1c]/20"
                  >
                    Map
                  </button>
                </div>
              ))}
              {filteredUnmapped.length === 0 && searchExternal.trim() && (
                <p className="px-3 py-4 text-center text-xs text-white/30">
                  No customers match &quot;{searchExternal}&quot;
                </p>
              )}
            </div>
          </>
        )}

        {!loading && unmappedCustomers.length === 0 && !fetchError && (
          <div className="rounded-lg border border-white/10 bg-white/[0.02] p-6 text-center">
            <p className="text-sm text-white/50">
              {externalCustomers.length === 0
                ? "No customers found in this integration."
                : "All customers are mapped!"}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

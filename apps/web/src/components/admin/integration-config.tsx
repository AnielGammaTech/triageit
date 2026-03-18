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

  async function handleAddMapping(externalId: string, externalName: string) {
    if (!integrationId) return;
    await supabase.from("integration_mappings").insert({
      integration_id: integrationId,
      service: item.service,
      external_id: externalId,
      external_name: externalName,
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

      {/* Tabs */}
      <div className="flex gap-1 border-b border-white/10">
        <button
          onClick={() => setActiveTab("config")}
          className={cn(
            "px-4 py-2 text-sm font-medium transition-colors",
            activeTab === "config"
              ? "border-b-2 border-[#6366f1] text-white"
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
              ? "border-b-2 border-[#6366f1] text-white"
              : "text-white/50 hover:text-white",
          )}
        >
          Customer Mapping
          {mappings.length > 0 && (
            <span className="ml-2 rounded-full bg-[#6366f1]/20 px-2 py-0.5 text-xs text-[#6366f1]">
              {mappings.length}
            </span>
          )}
        </button>
      </div>

      {/* Config tab */}
      {activeTab === "config" && (
        <div className="space-y-4">
          {(definition?.fields ?? []).map((field) => (
            <div key={field.key}>
              <label className="mb-1 block text-sm font-medium text-white/70">
                {field.label}
                {field.required && <span className="text-red-400"> *</span>}
              </label>
              <input
                type={field.type === "password" ? "password" : "text"}
                value={values[field.key] ?? ""}
                onChange={(e) => handleFieldChange(field.key, e.target.value)}
                placeholder={field.placeholder}
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white outline-none placeholder:text-white/30 focus:border-[#6366f1] focus:ring-1 focus:ring-[#6366f1]"
              />
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
            className="rounded-lg bg-[#6366f1] px-4 py-2.5 text-sm font-semibold text-white transition-all hover:bg-[#5558e6] disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save Configuration"}
          </button>
        </div>
      )}

      {/* Mappings tab */}
      {activeTab === "mappings" && (
        <div className="space-y-4">
          {!integrationId && (
            <p className="text-sm text-white/50">
              Configure the integration first before setting up customer mappings.
            </p>
          )}

          {integrationId && mappings.length === 0 && (
            <div className="rounded-lg border border-white/10 bg-white/5 p-8 text-center">
              <p className="text-sm text-white/50">
                No customer mappings yet. Add mappings to link external
                customers/sites to your internal records.
              </p>
              <AddMappingForm onAdd={handleAddMapping} />
            </div>
          )}

          {integrationId && mappings.length > 0 && (
            <>
              <AddMappingForm onAdd={handleAddMapping} />
              <div className="overflow-hidden rounded-lg border border-white/10">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/10 bg-white/5">
                      <th className="px-4 py-3 text-left font-medium text-white/50">
                        External ID
                      </th>
                      <th className="px-4 py-3 text-left font-medium text-white/50">
                        External Name
                      </th>
                      <th className="px-4 py-3 text-left font-medium text-white/50">
                        Customer
                      </th>
                      <th className="px-4 py-3 text-right font-medium text-white/50">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {mappings.map((m) => (
                      <tr
                        key={m.id}
                        className="border-b border-white/5 transition-colors hover:bg-white/5"
                      >
                        <td className="px-4 py-3 font-mono text-xs text-white/70">
                          {m.external_id}
                        </td>
                        <td className="px-4 py-3 text-white">
                          {m.external_name}
                        </td>
                        <td className="px-4 py-3 text-white/70">
                          {m.customer_name || "—"}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() => handleDeleteMapping(m.id)}
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
            </>
          )}
        </div>
      )}
    </div>
  );
}

function AddMappingForm({
  onAdd,
}: {
  readonly onAdd: (externalId: string, externalName: string) => void;
}) {
  const [externalId, setExternalId] = useState("");
  const [externalName, setExternalName] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!externalId.trim() || !externalName.trim()) return;
    onAdd(externalId.trim(), externalName.trim());
    setExternalId("");
    setExternalName("");
  }

  return (
    <form onSubmit={handleSubmit} className="flex gap-2">
      <input
        value={externalId}
        onChange={(e) => setExternalId(e.target.value)}
        placeholder="External ID"
        className="flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none placeholder:text-white/30 focus:border-[#6366f1]"
      />
      <input
        value={externalName}
        onChange={(e) => setExternalName(e.target.value)}
        placeholder="External Name"
        className="flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none placeholder:text-white/30 focus:border-[#6366f1]"
      />
      <button
        type="submit"
        className="rounded-lg bg-[#6366f1] px-4 py-2 text-sm font-medium text-white hover:bg-[#5558e6]"
      >
        Add
      </button>
    </form>
  );
}

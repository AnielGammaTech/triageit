"use client";

import { useState } from "react";
import type {
  IntegrationDefinition,
  Integration,
  HealthStatus,
} from "@triageit/shared";
import { IntegrationForm } from "./integration-form";
import { cn } from "@/lib/utils/cn";

interface IntegrationGridProps {
  readonly definitions: ReadonlyArray<IntegrationDefinition>;
  readonly integrations: ReadonlyArray<Integration>;
}

const HEALTH_STYLES: Record<HealthStatus, string> = {
  healthy: "bg-green-500",
  degraded: "bg-yellow-500",
  down: "bg-red-500",
  unknown: "bg-gray-500",
};

export function IntegrationGrid({
  definitions,
  integrations,
}: IntegrationGridProps) {
  const [editingService, setEditingService] = useState<string | null>(null);

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {definitions.map((def) => {
        const existing = integrations.find((i) => i.service === def.service);
        const isEditing = editingService === def.service;

        return (
          <div
            key={def.service}
            className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4"
          >
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-medium">{def.display_name}</h3>
                <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                  {def.description}
                </p>
              </div>
              {existing && (
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      "inline-block h-2 w-2 rounded-full",
                      HEALTH_STYLES[existing.health_status],
                    )}
                  />
                  <span className="text-xs text-[var(--muted-foreground)]">
                    {existing.is_active ? "Active" : "Inactive"}
                  </span>
                </div>
              )}
            </div>

            {isEditing ? (
              <IntegrationForm
                definition={def}
                existing={existing ?? null}
                onClose={() => setEditingService(null)}
              />
            ) : (
              <button
                onClick={() => setEditingService(def.service)}
                className="mt-4 w-full rounded-md border border-[var(--border)] px-3 py-1.5 text-xs hover:bg-[var(--accent)]"
              >
                {existing ? "Edit Configuration" : "Configure"}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

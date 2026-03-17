"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { IntegrationDefinition, Integration } from "@triageit/shared";
import { createClient } from "@/lib/supabase/client";

interface IntegrationFormProps {
  readonly definition: IntegrationDefinition;
  readonly existing: Integration | null;
  readonly onClose: () => void;
}

export function IntegrationForm({
  definition,
  existing,
  onClose,
}: IntegrationFormProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const field of definition.fields) {
      const existingConfig = existing?.config as Record<string, string> | undefined;
      initial[field.key] = existingConfig?.[field.key] ?? "";
    }
    return initial;
  });

  function handleFieldChange(key: string, value: string) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const missingRequired = definition.fields.filter(
      (f) => f.required && !values[f.key]?.trim(),
    );
    if (missingRequired.length > 0) {
      setError(
        `Missing required fields: ${missingRequired.map((f) => f.label).join(", ")}`,
      );
      setLoading(false);
      return;
    }

    const supabase = createClient();

    const payload = {
      service: definition.service,
      display_name: definition.display_name,
      config: values,
      is_active: true,
      updated_at: new Date().toISOString(),
    };

    const { error: dbError } = existing
      ? await supabase.from("integrations").update(payload).eq("id", existing.id)
      : await supabase.from("integrations").insert(payload);

    if (dbError) {
      setError(dbError.message);
      setLoading(false);
      return;
    }

    router.refresh();
    onClose();
  }

  return (
    <form onSubmit={handleSubmit} className="mt-4 space-y-3">
      {definition.fields.map((field) => (
        <div key={field.key}>
          <label
            htmlFor={`${definition.service}-${field.key}`}
            className="mb-1 block text-xs text-[var(--muted-foreground)]"
          >
            {field.label}
            {field.required && <span className="text-[var(--destructive)]"> *</span>}
          </label>
          <input
            id={`${definition.service}-${field.key}`}
            type={field.type === "password" ? "password" : "text"}
            value={values[field.key]}
            onChange={(e) => handleFieldChange(field.key, e.target.value)}
            placeholder={field.placeholder}
            className="w-full rounded-md border border-[var(--border)] bg-[var(--input)] px-2 py-1.5 text-xs outline-none focus:ring-1 focus:ring-[var(--ring)]"
          />
        </div>
      ))}

      {error && <p className="text-xs text-[var(--destructive)]">{error}</p>}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={loading}
          className="flex-1 rounded-md bg-[var(--primary)] px-3 py-1.5 text-xs font-medium text-[var(--primary-foreground)] hover:opacity-90 disabled:opacity-50"
        >
          {loading ? "Saving..." : "Save"}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-[var(--border)] px-3 py-1.5 text-xs hover:bg-[var(--accent)]"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

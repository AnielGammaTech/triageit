"use client";

import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils/cn";

interface BrandingConfig {
  readonly logo_url: string | null;
  readonly name: string;
}

export function BrandingSettings() {
  const [config, setConfig] = useState<BrandingConfig>({ logo_url: null, name: "TriageIT" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [logoUrl, setLogoUrl] = useState("");
  const [brandName, setBrandName] = useState("TriageIT");

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/branding");
        if (res.ok) {
          const data = (await res.json()) as { branding: BrandingConfig };
          setConfig(data.branding);
          setLogoUrl(data.branding.logo_url ?? "");
          setBrandName(data.branding.name);
        }
      } catch (err) {
        console.error("Failed to load branding:", err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaved(false);

    try {
      const res = await fetch("/api/branding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          logo_url: logoUrl.trim() || null,
          name: brandName.trim() || "TriageIT",
        }),
      });

      if (res.ok) {
        const data = (await res.json()) as { branding: BrandingConfig };
        setConfig(data.branding);
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      }
    } catch (err) {
      console.error("Failed to save branding:", err);
    } finally {
      setSaving(false);
    }
  }, [logoUrl, brandName]);

  const hasChanges = logoUrl !== (config.logo_url ?? "") || brandName !== config.name;

  if (loading) {
    return (
      <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-6">
        <div className="h-4 w-32 animate-pulse rounded bg-white/10" />
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-6">
      <h3 className="text-lg font-semibold mb-1">Branding</h3>
      <p className="text-sm text-[var(--muted-foreground)] mb-5">
        Customize how TriageIT notes appear in Halo. Add your company logo and name to the header of all AI-generated notes.
      </p>

      <div className="space-y-4">
        {/* Brand Name */}
        <div>
          <label htmlFor="brand-name" className="block text-sm font-medium text-[var(--foreground)] mb-1.5">
            Display Name
          </label>
          <input
            id="brand-name"
            type="text"
            value={brandName}
            onChange={(e) => setBrandName(e.target.value)}
            placeholder="TriageIT"
            className="w-full max-w-sm rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:border-[#b91c1c] focus:outline-none focus:ring-1 focus:ring-[#b91c1c]"
          />
          <p className="mt-1 text-xs text-[var(--muted-foreground)]">
            Appears in the header of all Halo notes (e.g. &quot;AI Triage — YourName&quot;)
          </p>
        </div>

        {/* Logo URL */}
        <div>
          <label htmlFor="logo-url" className="block text-sm font-medium text-[var(--foreground)] mb-1.5">
            Logo URL
          </label>
          <input
            id="logo-url"
            type="url"
            value={logoUrl}
            onChange={(e) => setLogoUrl(e.target.value)}
            placeholder="https://example.com/logo.png"
            className="w-full max-w-lg rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:border-[#b91c1c] focus:outline-none focus:ring-1 focus:ring-[#b91c1c]"
          />
          <p className="mt-1 text-xs text-[var(--muted-foreground)]">
            Direct URL to your logo image (PNG/SVG recommended, ~22px tall). Leave empty for the default emoji icon.
          </p>
        </div>

        {/* Preview */}
        {(logoUrl.trim() || brandName.trim()) && (
          <div>
            <p className="text-xs font-medium text-[var(--muted-foreground)] mb-2">Preview</p>
            <div
              className="inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-white text-sm font-bold"
              style={{ background: "linear-gradient(135deg, #b91c1c, #8b5cf6)" }}
            >
              {logoUrl.trim() ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={logoUrl.trim()}
                  alt={brandName}
                  className="h-[22px] w-auto rounded-[3px]"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                />
              ) : (
                <span>🤖</span>
              )}
              <span>AI Triage — {brandName.trim() || "TriageIT"}</span>
            </div>
          </div>
        )}

        {/* Save */}
        <div className="flex items-center gap-3 pt-2">
          <button
            onClick={handleSave}
            disabled={saving || !hasChanges}
            className={cn(
              "rounded-lg px-4 py-2 text-sm font-medium transition-colors",
              saving || !hasChanges
                ? "cursor-not-allowed bg-white/5 text-white/20"
                : "bg-[#b91c1c] text-white hover:bg-[#a31919]",
            )}
          >
            {saving ? "Saving..." : "Save Branding"}
          </button>
          {saved && (
            <span className="text-sm text-emerald-400">Saved!</span>
          )}
        </div>
      </div>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils/cn";

interface BrandingConfig {
  readonly logo_url: string | null;
  readonly name: string;
  readonly agent_avatar_url: string | null;
}

export function BrandingSettings() {
  const [config, setConfig] = useState<BrandingConfig>({ logo_url: null, name: "TriageIT", agent_avatar_url: null });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [logoUrl, setLogoUrl] = useState("");
  const [brandName, setBrandName] = useState("TriageIT");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/branding");
        if (res.ok) {
          const data = (await res.json()) as { branding: BrandingConfig };
          setConfig(data.branding);
          setLogoUrl(data.branding.logo_url ?? "");
          setBrandName(data.branding.name);
          setAvatarUrl(data.branding.agent_avatar_url ?? null);
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
          agent_avatar_url: avatarUrl,
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
  }, [logoUrl, brandName, avatarUrl]);

  const hasChanges = logoUrl !== (config.logo_url ?? "") || brandName !== config.name || avatarUrl !== (config.agent_avatar_url ?? null);

  function handleAvatarUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) return;
    if (file.size > 500_000) return; // 500KB max

    setUploadingAvatar(true);
    const reader = new FileReader();
    reader.onload = () => {
      setAvatarUrl(reader.result as string);
      setUploadingAvatar(false);
    };
    reader.onerror = () => setUploadingAvatar(false);
    reader.readAsDataURL(file);
  }

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

        {/* Agent Avatar */}
        <div>
          <label className="block text-sm font-medium text-[var(--foreground)] mb-1.5">
            Prison Mike Avatar
          </label>
          <div className="flex items-center gap-4">
            <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-full border-2 border-white/10 bg-white/5">
              {avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={avatarUrl} alt="Agent avatar" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-white/20 text-xl">?</div>
              )}
            </div>
            <div className="space-y-2">
              <label
                className={cn(
                  "inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-xs font-medium text-white/60 transition-all hover:border-[#b91c1c]/50 hover:text-white hover:bg-[#b91c1c]/10",
                  uploadingAvatar && "opacity-50 cursor-not-allowed",
                )}
              >
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={handleAvatarUpload}
                  disabled={uploadingAvatar}
                  className="hidden"
                />
                {uploadingAvatar ? "Uploading..." : "Upload Image"}
              </label>
              {avatarUrl && (
                <button
                  type="button"
                  onClick={() => setAvatarUrl(null)}
                  className="block text-[10px] text-red-400/60 hover:text-red-400 transition-colors"
                >
                  Remove avatar
                </button>
              )}
              <p className="text-[10px] text-[var(--muted-foreground)]">
                PNG/JPG, max 500KB. Used as the chat avatar.
              </p>
            </div>
          </div>
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

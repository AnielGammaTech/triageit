const TOOLS = [
  { name: "AutoDoc", category: "Documentation", desc: "AI network docs into Hudu" },
  { name: "File Migration", category: "SharePoint", desc: "Hash-verified data moves" },
  { name: "Phone Prompts", category: "3CX Audio", desc: "Text-to-speech IVR prompts" },
  { name: "Credential Vault", category: "Security", desc: "Encrypted shared secrets" },
] as const;

/** "Tools" nav view — the full toolkit grid. */
export function ToolsView() {
  return (
    <div className="flex flex-col gap-2 p-2.5 text-[color:var(--mock-text)]">
      <span className="text-[10px] font-semibold">Tools</span>
      <div className="grid grid-cols-2 gap-1.5">
        {TOOLS.map((t) => (
          <div key={t.name} className="rounded-xl border bg-[color:var(--mock-panel)] p-1.5 shadow-sm" style={{ borderColor: "var(--mock-border)" }}>
            <span className="mb-1 block size-2.5 rounded-sm bg-sky-500/70" />
            <span className="block truncate text-[7.5px] font-medium">{t.name}</span>
            <span className="block truncate text-[6.5px] text-[color:var(--mock-muted)]">{t.category}</span>
            <span className="mt-0.5 block truncate text-[6px] text-[color:var(--mock-muted)]">{t.desc}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

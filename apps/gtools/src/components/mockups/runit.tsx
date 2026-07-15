const NAV = ["Dashboard", "Tools", "TextIT", "Runs", "Settings"] as const;

const STATS = [
  { label: "Runs today", value: "142", tone: "#0284c7" },
  { label: "Failed today", value: "3", tone: "#dc2626" },
  { label: "Tools available", value: "9", tone: "#059669" },
  { label: "Last MFA code", value: "482 913", tone: "#7c3aed" },
] as const;

const TOOLS = [
  { name: "AutoDoc", category: "Documentation" },
  { name: "File Migration", category: "SharePoint" },
] as const;

const RUNS = [
  { tool: "autodoc", user: "jim · 2m ago", ok: true, duration: "4.2s" },
  { tool: "file-migration", user: "pam · 18m ago", ok: true, duration: "1m 02s" },
] as const;

export function RunitMockup() {
  return (
    <div
      className="mock-root overflow-hidden rounded-md border"
      style={
        {
          "--mock-bg": "#f8fafc",
          "--mock-panel": "#ffffff",
          "--mock-panel-2": "#f1f5f9",
          "--mock-border": "#e2e8f0",
          "--mock-text": "#0f172a",
          "--mock-muted": "#64748b",
          borderColor: "var(--mock-border)",
          background: "var(--mock-bg)",
        } as React.CSSProperties
      }
    >
      <div
        className="flex items-center justify-center gap-3 px-2.5 py-1.5"
        style={{ background: "linear-gradient(90deg,#0f2f44,#133f5c)" }}
      >
        <span className="font-display text-[10px] font-bold">
          <span className="text-white">Run</span>
          <span style={{ color: "#f87171" }}>IT</span>
        </span>
        <div className="flex items-center gap-2 text-[7px] font-medium">
          {NAV.map((item, i) => (
            <span
              key={item}
              className="rounded-full px-1.5 py-0.5"
              style={i === 0 ? { background: "rgba(255,255,255,0.1)", color: "#b4e1ff" } : { color: "rgba(255,255,255,0.55)" }}
            >
              {item}
            </span>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2 p-2.5 text-[color:var(--mock-text)]">
        <div>
          <span className="block text-[10px] font-semibold">Dashboard</span>
          <span className="block text-[7px] text-[color:var(--mock-muted)]">What the toolkit has been up to</span>
        </div>

        <div className="grid grid-cols-4 gap-1.5">
          {STATS.map((s) => (
            <div key={s.label} className="rounded-xl border bg-[color:var(--mock-panel)] p-1.5 shadow-sm" style={{ borderColor: "var(--mock-border)" }}>
              <span className="block text-[6.5px] font-medium text-[color:var(--mock-muted)]">{s.label}</span>
              <span className="block text-[9px] font-semibold" style={{ color: s.tone }}>{s.value}</span>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-1.5">
          <div className="rounded-xl border bg-[color:var(--mock-panel)] p-1.5 shadow-sm" style={{ borderColor: "var(--mock-border)" }}>
            <span className="mb-1 block text-[7px] font-medium uppercase tracking-wider text-[color:var(--mock-muted)]">Quick run</span>
            {TOOLS.map((t) => (
              <div key={t.name} className="flex items-center gap-1.5 border-t py-1 first:border-t-0" style={{ borderColor: "var(--mock-panel-2)" }}>
                <span className="size-2.5 rounded-sm bg-sky-500/70" />
                <div className="min-w-0 flex-1">
                  <span className="block truncate text-[8px] font-medium">{t.name}</span>
                  <span className="block truncate text-[6.5px] text-[color:var(--mock-muted)]">{t.category}</span>
                </div>
              </div>
            ))}
          </div>
          <div className="rounded-xl border bg-[color:var(--mock-panel)] p-1.5 shadow-sm" style={{ borderColor: "var(--mock-border)" }}>
            <span className="mb-1 block text-[7px] font-medium uppercase tracking-wider text-[color:var(--mock-muted)]">Recent runs</span>
            {RUNS.map((r) => (
              <div key={r.tool} className="flex items-center gap-1.5 border-t py-1 first:border-t-0" style={{ borderColor: "var(--mock-panel-2)" }}>
                <span className="size-1.5 rounded-full" style={{ background: r.ok ? "#10b981" : "#dc2626" }} />
                <div className="min-w-0 flex-1">
                  <span className="block truncate text-[8px] font-medium">{r.tool}</span>
                  <span className="block truncate text-[6.5px] text-[color:var(--mock-muted)]">{r.user}</span>
                </div>
                <span className="shrink-0 rounded-full px-1 py-0.5 text-[6.5px] font-medium" style={{ background: "var(--mock-panel-2)", color: "var(--mock-muted)" }}>
                  {r.duration}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

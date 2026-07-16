const TENANTS = [
  { name: "Dunder Mifflin", users: 42, incidents: 1, health: "Healthy", tone: "#059669" },
  { name: "Vance Refrigeration", users: 18, incidents: 0, health: "Healthy", tone: "#059669" },
  { name: "Schrute Farms", users: 9, incidents: 2, health: "At Risk", tone: "#dc2626" },
  { name: "Michael Scott Paper Co.", users: 6, incidents: 0, health: "Healthy", tone: "#059669" },
] as const;

/** "Tenants" nav view — multi-tenant roster. */
export function TenantsView() {
  return (
    <div className="flex flex-col gap-2 p-2.5 text-[color:var(--mock-text)]">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold">Tenants</span>
        <span
          className="rounded-none border px-1.5 py-0.5 text-[7px] font-medium"
          style={{ borderColor: "#0b0f14", color: "#0b0f14" }}
        >
          + Add Tenant
        </span>
      </div>
      <div className="border" style={{ borderColor: "var(--mock-border)", background: "var(--mock-panel)" }}>
        {TENANTS.map((t, i) => (
          <div
            key={t.name}
            className={`flex items-center gap-2 px-2 py-1.5 text-[8px] ${i > 0 ? "border-t" : ""}`}
            style={{ borderColor: "var(--mock-border)" }}
          >
            <span className="min-w-0 flex-1 truncate font-medium">{t.name}</span>
            <span className="shrink-0 text-[color:var(--mock-muted)]">{t.users} users</span>
            <span className="shrink-0 text-[color:var(--mock-muted)]">{t.incidents} open</span>
            <span
              className="shrink-0 rounded-none border px-1 py-0.5 text-[7px] font-medium"
              style={{ borderColor: t.tone, color: t.tone }}
            >
              {t.health}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

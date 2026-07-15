// Client-facing view (task 17 re-skin) — PortalIT's audience is the
// customer, not Gamma Tech staff: services, invoices, and support they see
// after logging in. Same slate-900/violet-700 chrome as the staff build
// (.superpowers/sdd/ui-specs/portalit.md), reskinned content, Office demo
// client (Dunder Mifflin) per the task-16 convention.
interface Service {
  readonly name: string;
  readonly detail: string;
}

interface Invoice {
  readonly id: string;
  readonly date: string;
  readonly amount: string;
  readonly status: string;
  readonly tone: string;
}

const SERVICES: readonly Service[] = [
  { name: "Datto RMM", detail: "42 endpoints monitored" },
  { name: "Microsoft 365", detail: "38 licenses synced" },
  { name: "Cove Backup", detail: "Daily · verified 2h ago" },
  { name: "3CX Phone", detail: "12 extensions" },
];

const INVOICES: readonly Invoice[] = [
  { id: "INV-2291", date: "Jul 1", amount: "$2,140.00", status: "Paid", tone: "#059669" },
  { id: "INV-2247", date: "Jun 1", amount: "$2,140.00", status: "Paid", tone: "#059669" },
  { id: "INV-2198", date: "May 1", amount: "$1,985.00", status: "Reconciled", tone: "#2563eb" },
];

const CARD = "rounded-xl border p-1.5";
const CARD_STYLE = { borderColor: "var(--mock-border)", background: "var(--mock-panel)" };
const LABEL = "mb-1 block text-[7px] font-medium uppercase tracking-wider";
const MUTED = { color: "var(--mock-muted)" };

export function PortalitMockup() {
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
      <div className="flex items-center justify-between gap-3 px-2.5 py-1.5" style={{ background: "#0f172a" }}>
        <div className="flex items-center gap-3">
          <span className="font-display text-[10px] font-bold">
            <span className="text-white">Portal</span>
            <span style={{ color: "#a78bfa" }}>IT</span>
          </span>
          <div className="hidden items-center gap-2.5 text-[7px] font-medium sm:flex">
            <span className="border-b-2 pb-0.5 text-white" style={{ borderColor: "#a78bfa" }}>Dashboard</span>
            <span style={{ color: "rgba(255,255,255,0.55)" }}>Invoices</span>
            <span style={{ color: "rgba(255,255,255,0.55)" }}>Support</span>
          </div>
        </div>
        <span className="flex size-3.5 shrink-0 items-center justify-center rounded-full text-[6px] font-semibold text-white" style={{ background: "#5b21b6" }}>
          DM
        </span>
      </div>

      <div className="flex flex-col gap-2 p-2.5 text-[color:var(--mock-text)]">
        <div>
          <span className="block text-[9px] font-semibold">Welcome back, Dunder Mifflin</span>
          <span className="block text-[7px]" style={MUTED}>Everything Gamma Tech manages for you, in one place.</span>
        </div>

        <div className={CARD} style={CARD_STYLE}>
          <span className={LABEL} style={MUTED}>Your services</span>
          <div className="grid grid-cols-2 gap-1">
            {SERVICES.map((s) => (
              <div key={s.name} className="flex items-center justify-between gap-1 rounded-lg px-1.5 py-1" style={{ background: "var(--mock-panel-2)" }}>
                <div className="min-w-0">
                  <span className="block truncate text-[7px] font-medium">{s.name}</span>
                  <span className="block truncate text-[6px]" style={MUTED}>{s.detail}</span>
                </div>
                <span className="shrink-0 rounded-full px-1 py-0.5 text-[6px] font-medium" style={{ color: "#059669", background: "#ecfdf5" }}>
                  Active
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-[1.3fr_0.7fr] gap-1.5">
          <div className={CARD} style={CARD_STYLE}>
            <span className={LABEL} style={MUTED}>Recent invoices</span>
            <div className="flex flex-col gap-1">
              {INVOICES.map((inv) => (
                <div key={inv.id} className="flex items-center justify-between text-[7px]">
                  <span>
                    {inv.id} <span style={MUTED}>· {inv.date}</span>
                  </span>
                  <span className="flex items-center gap-1">
                    <b>{inv.amount}</b>
                    <span className="rounded-full border px-1 py-0.5 text-[6px]" style={{ borderColor: inv.tone, color: inv.tone }}>
                      {inv.status}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className={CARD} style={CARD_STYLE}>
            <span className={LABEL} style={MUTED}>Support</span>
            <span className="block text-[8px]">2 open tickets</span>
            <span className="mt-1 block rounded-full px-1.5 py-1 text-center text-[6px] font-medium text-white" style={{ background: "#5b21b6" }}>
              + New ticket
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

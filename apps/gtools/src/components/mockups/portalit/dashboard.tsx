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

/** Signature screen: client Dashboard (default view, unchanged). */
export function DashboardView() {
  return (
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
  );
}

import { accentVar } from "@/components/browser-frame";

const LINE_ITEMS = [
  { name: "Firewall appliance — 60F", qty: "1", price: "$1,850" },
  { name: "Managed switch, 24-port PoE", qty: "2", price: "$2,100" },
  { name: "Onboarding & migration", qty: "1", price: "$4,500" },
] as const;

/** Signature screen: Quote Builder (default view, unchanged). */
export function BuilderView() {
  const accent = accentVar("quoteit");
  return (
    <div className="flex flex-col gap-2 p-2.5 text-[color:var(--mock-text)]">
      <div className="flex flex-wrap items-center justify-between gap-1.5">
        <div className="flex items-center gap-1.5">
          <span className="text-[9px] font-semibold">WUPHF.com — Network Refresh</span>
          <span className="rounded border px-1 py-0.5 font-mono text-[7px]" style={{ borderColor: "var(--mock-border)", color: "var(--mock-muted)" }}>
            Q-2047
          </span>
        </div>
        <span className="rounded-full px-1.5 py-0.5 text-[7px] font-medium ring-1" style={{ background: "#eff6ff", color: "#1d4ed8", boxShadow: "inset 0 0 0 1px #bfdbfe" }}>
          Sent
        </span>
      </div>

      <div className="grid grid-cols-[1.4fr_0.6fr] gap-1.5">
        <div className="rounded-lg border p-1.5" style={{ borderColor: "var(--mock-border)", background: "var(--mock-panel)" }}>
          <span className="mb-1 block text-[7px] font-medium uppercase tracking-wider text-[color:var(--mock-muted)]">
            Sections
          </span>
          {LINE_ITEMS.map((item) => (
            <div key={item.name} className="flex items-center gap-1.5 border-t py-1 text-[8px] first:border-t-0" style={{ borderColor: "var(--mock-panel-2)" }}>
              <span className="min-w-0 flex-1 truncate">{item.name}</span>
              <span className="w-3 shrink-0 text-right text-[color:var(--mock-muted)]">{item.qty}</span>
              <span className="w-10 shrink-0 text-right font-medium">{item.price}</span>
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="rounded-lg border p-1.5" style={{ borderColor: "var(--mock-border)", background: "var(--mock-panel)" }}>
            <span className="block text-[7px] font-medium uppercase tracking-wider text-[color:var(--mock-muted)]">Customer</span>
            <span className="block text-[8px] font-medium">WUPHF.com</span>
          </div>
          <div className="rounded-lg border p-1.5" style={{ borderColor: "var(--mock-border)", background: "var(--mock-panel)" }}>
            <span className="block text-[7px] font-medium uppercase tracking-wider text-[color:var(--mock-muted)]">Total</span>
            <span className="block text-[10px] font-bold" style={{ color: accent }}>$8,450</span>
            <span className="mb-1 block text-[7px] text-[color:var(--mock-muted)]">+ $1,275/mo</span>
            <span className="block h-1 w-full overflow-hidden rounded-full bg-[color:var(--mock-panel-2)]">
              <span className="block h-full w-3/5 rounded-full bg-emerald-500" />
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

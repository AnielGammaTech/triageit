import { accentVar } from "@/components/browser-frame";
import { MockPanel, MockPill, MockRow, MockStat } from "@/components/mock-ui";

export function QuoteitMockup() {
  const accent = accentVar("quoteit");
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-display text-xs font-semibold text-snow">
          Q-2047 <span className="text-fog">·</span> Coastal Law
        </span>
        <MockPill tone="warn">Awaiting signature</MockPill>
      </div>

      <div className="rounded-lg border border-line bg-panel-2 p-2.5">
        <MockRow cells={["Item", "Qty", "Price"]} />
        <MockRow cells={["Firewall appliance — 60F", "1", "$1,850"]} emphasis={0} />
        <MockRow cells={["Managed switch, 24-port PoE", "2", "$2,100"]} emphasis={0} />
        <MockRow cells={["Onboarding & migration", "1", "$4,500"]} emphasis={0} />
      </div>

      <MockPanel title="Totals" accent={accent}>
        <div className="flex gap-6">
          <MockStat label="One-time" value="$8,450" accent={accent} />
          <MockStat label="Monthly" value="$1,275" accent={accent} />
        </div>
      </MockPanel>
    </div>
  );
}

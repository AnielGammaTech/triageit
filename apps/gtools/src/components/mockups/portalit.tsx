import { accentVar } from "@/components/browser-frame";
import { MockStat } from "@/components/mock-ui";

interface ReconRow {
  readonly client: string;
  readonly invoiced: string;
  readonly actual: string;
  readonly delta: string;
  readonly bad?: boolean;
}

const ROWS: readonly ReconRow[] = [
  { client: "Acme Dental", invoiced: "$1,240", actual: "$1,240", delta: "$0" },
  { client: "Coastal Law", invoiced: "$860", actual: "$610", delta: "-$250", bad: true },
  { client: "Naples Realty", invoiced: "$2,150", actual: "$2,150", delta: "$0" },
];

export function PortalitMockup() {
  const accent = accentVar("portalit");
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-5">
        <MockStat label="MRR" value="$48.2k" />
        <MockStat label="Discrepancies" value="7" accent={accent} />
        <MockStat label="Recovered" value="$1,940/mo" accent={accent} />
      </div>

      <div className="rounded-lg border border-line bg-panel-2 p-2.5">
        <div className="flex items-center gap-3 pb-1.5 text-[10px] font-medium uppercase tracking-wider text-fog">
          <span className="flex-1">Client</span>
          <span className="flex-1">Invoiced</span>
          <span className="flex-1">Actual</span>
          <span className="flex-1">Delta</span>
        </div>
        {ROWS.map((row) => (
          <div
            key={row.client}
            className="flex items-center gap-3 border-t border-line/60 py-1.5 text-[10px]"
          >
            <span className="flex-1 truncate text-snow">{row.client}</span>
            <span className="flex-1 truncate text-fog">{row.invoiced}</span>
            <span className="flex-1 truncate text-fog">{row.actual}</span>
            <span className={`flex-1 truncate font-medium ${row.bad ? "text-rose-400" : "text-emerald-400"}`}>
              {row.delta}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

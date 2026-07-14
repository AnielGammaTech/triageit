import { accentVar } from "@/components/browser-frame";
import { MockBar, MockRow } from "@/components/mock-ui";

const RESULTS = [
  ["(239) 555-0148", "Acme Dental Front Desk", "Verizon", "Landline"],
  ["(239) 555-0173", "Coastal Law LLP", "T-Mobile", "Mobile"],
  ["(239) 555-0199", "Naples Realty Group", "AT&T", "VoIP"],
] as const;

export function PhoneitMockup() {
  const accent = accentVar("phoneit");
  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-lg border border-line bg-panel-2 p-2.5">
        <div className="flex items-center justify-between text-[10px]">
          <span className="text-fog">500 numbers</span>
          <span className="font-medium text-snow">494 OK</span>
          <span className="font-medium text-rose-400">6 failed</span>
        </div>
        <div className="mt-2">
          <MockBar pct={98} accent={accent} />
        </div>
      </div>

      <div className="rounded-lg border border-line bg-panel-2 p-2.5">
        <MockRow cells={["Number", "Caller name", "Carrier", "Line type"]} />
        {RESULTS.map((row) => (
          <MockRow key={row[0]} cells={row} emphasis={1} />
        ))}
      </div>
    </div>
  );
}

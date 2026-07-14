import { accentVar } from "@/components/browser-frame";
import { MockPill, MockRowShell, MockStat } from "@/components/mock-ui";
import type { MockTone } from "@/components/mock-ui";

interface SyncRun {
  readonly connector: string;
  readonly status: string;
  readonly tone: MockTone;
  readonly duration: string;
}

const RUNS: readonly SyncRun[] = [
  { connector: "HaloPSA", status: "Success", tone: "ok", duration: "2m 14s" },
  { connector: "Twilio Lookup", status: "Success", tone: "ok", duration: "41s" },
  { connector: "Datto RMM", status: "Queued", tone: "neutral", duration: "—" },
];

export function ConnectitMockup() {
  const accent = accentVar("connectit");
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-5">
        <MockStat label="Connectors live" value="2" accent={accent} />
        <MockStat label="Records" value="128k" />
        <MockStat label="Customers" value="214" />
      </div>

      <div className="rounded-lg border border-line bg-panel-2 p-2.5">
        <span className="mb-2 block text-[10px] font-medium uppercase tracking-wider text-fog">
          Recent runs
        </span>
        {RUNS.map((run) => (
          <MockRowShell key={run.connector} className="first:border-t-0">
            <span className="flex-1 truncate text-snow">{run.connector}</span>
            <MockPill tone={run.tone}>{run.status}</MockPill>
            <span className="w-12 shrink-0 text-right text-fog">{run.duration}</span>
          </MockRowShell>
        ))}
      </div>
    </div>
  );
}

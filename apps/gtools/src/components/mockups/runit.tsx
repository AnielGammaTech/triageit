import { accentVar } from "@/components/browser-frame";
import { MockPanel, MockPill } from "@/components/mock-ui";
import type { MockTone } from "@/components/mock-ui";

interface Tile {
  readonly name: string;
  readonly status: string;
  readonly tone: MockTone;
}

const TILES: readonly Tile[] = [
  { name: "AutoDoc", status: "Idle", tone: "neutral" },
  { name: "File Migration", status: "Running", tone: "warn" },
  { name: "Lazybird TTS", status: "Idle", tone: "neutral" },
  { name: "TextIT", status: "Live", tone: "ok" },
];

const RECENT_RUNS = [
  "AutoDoc — Coastal Law WiFi doc",
  "File Migration — Naples Realty SharePoint",
] as const;

export function RunitMockup() {
  const accent = accentVar("runit");
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2">
        {TILES.map((tile) => (
          <div
            key={tile.name}
            className="flex flex-col gap-1.5 rounded-lg border border-line bg-panel-2 p-2"
          >
            <span className="truncate text-[10px] font-medium text-snow">{tile.name}</span>
            <MockPill tone={tile.tone}>{tile.status}</MockPill>
          </div>
        ))}
      </div>

      <MockPanel title="Recent runs" accent={accent}>
        {RECENT_RUNS.map((run) => (
          <div key={run} className="flex items-center justify-between gap-3 text-[10px]">
            <span className="truncate text-fog">{run}</span>
            <MockPill tone="ok">Success</MockPill>
          </div>
        ))}
      </MockPanel>
    </div>
  );
}

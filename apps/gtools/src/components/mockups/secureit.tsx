import { accentVar } from "@/components/browser-frame";
import { MockPanel, MockPill, MockRow } from "@/components/mock-ui";

const REMEDIATIONS = ["Revoke sessions", "Disable account", "Block IP"] as const;

export function SecureitMockup() {
  const accent = accentVar("secureit");
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <span className="font-display text-xs font-semibold leading-snug text-snow">
          Impossible travel — token replay suspected
        </span>
        <MockPill tone="bad">Confidence: High</MockPill>
      </div>

      <MockPanel title="Attack chain" accent={accent}>
        <MockRow cells={["1", "Sign-in from Lagos, NG (impossible travel)"]} emphasis={1} />
        <MockRow cells={["2", "Refresh token reused within 90 seconds"]} emphasis={1} />
        <MockRow cells={["3", "New inbox rule created — auto-forward external"]} emphasis={1} />
      </MockPanel>

      <div className="flex flex-col gap-1.5">
        <span className="text-[10px] font-medium uppercase tracking-wider text-fog">
          Remediation
        </span>
        <div className="flex flex-wrap gap-1.5">
          {REMEDIATIONS.map((action) => (
            <span
              key={action}
              className="rounded-md border px-2 py-1 text-[10px] font-medium"
              style={{ borderColor: accent, color: accent }}
            >
              {action}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

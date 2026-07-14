import { accentVar } from "@/components/browser-frame";
import { MockPanel, MockPill, MockRow } from "@/components/mock-ui";

export function TriageitMockup() {
  const accent = accentVar("triageit");
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-display text-xs font-semibold text-snow">
          Ticket #4821 <span className="text-fog">·</span> Acme Dental
        </span>
        <div className="flex gap-1.5">
          <MockPill>Email / M365</MockPill>
          <MockPill tone="warn">Urgency 4</MockPill>
          <MockPill tone="ok">Security: clear</MockPill>
        </div>
      </div>

      <MockPanel title="Findings" accent={accent}>
        <MockRow
          cells={["Email", "Mailbox rule forwarding externally — flagged"]}
          emphasis={1}
        />
        <MockRow
          cells={["Identity", "New sign-in from unrecognized ISP (Ohio)"]}
          emphasis={1}
        />
        <MockRow
          cells={["Endpoint", "Datto agent last seen 6h ago — FRONT-DESK-02"]}
          emphasis={1}
        />
      </MockPanel>

      <div className="flex items-center justify-between rounded-lg border border-line bg-panel-2 px-2.5 py-2 text-[10px]">
        <span className="text-fog">
          Recommended:{" "}
          <span className="font-medium text-snow">escalate to tech</span>
        </span>
        <span className="font-medium" style={{ color: accent }}>
          respond &lt; 1 hr
        </span>
      </div>
    </div>
  );
}

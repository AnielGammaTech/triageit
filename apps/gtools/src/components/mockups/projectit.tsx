import { accentVar } from "@/components/browser-frame";
import { MockBar } from "@/components/mock-ui";

interface BoardCard {
  readonly title: string;
  readonly initials: string;
  readonly pct: number;
}

interface BoardColumn {
  readonly title: string;
  readonly cards: readonly BoardCard[];
}

const COLUMNS: readonly BoardColumn[] = [
  {
    title: "To do",
    cards: [
      { title: "Firewall rule audit", initials: "MK", pct: 0 },
      { title: "Onboard Naples Realty", initials: "TB", pct: 5 },
    ],
  },
  {
    title: "In progress",
    cards: [
      { title: "Patch Tuesday rollout", initials: "SR", pct: 40 },
      { title: "Migrate mail flow", initials: "MK", pct: 60 },
    ],
  },
  {
    title: "Done",
    cards: [
      { title: "Backup restore test", initials: "TB", pct: 100 },
      { title: "AP firmware update", initials: "SR", pct: 100 },
    ],
  },
];

export function ProjectitMockup() {
  const accent = accentVar("projectit");
  return (
    <div className="grid grid-cols-3 gap-2">
      {COLUMNS.map((column) => (
        <div key={column.title} className="flex flex-col gap-2 rounded-lg border border-line bg-panel-2 p-2">
          <span className="text-[10px] font-medium uppercase tracking-wider text-fog">
            {column.title}
          </span>
          {column.cards.map((card) => (
            <div key={card.title} className="flex flex-col gap-1.5 rounded-md border border-line bg-panel p-1.5">
              <span className="truncate text-[10px] text-snow">{card.title}</span>
              <div className="flex items-center gap-1.5">
                <span className="flex size-4 shrink-0 items-center justify-center rounded-full border border-line bg-panel-2 text-[8px] font-medium text-fog">
                  {card.initials}
                </span>
                <MockBar pct={card.pct} accent={accent} />
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

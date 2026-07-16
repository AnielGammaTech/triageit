interface TaskRow {
  readonly title: string;
  readonly status: string;
  readonly statusColor: string;
  readonly due: string;
  readonly dueColor: string;
  readonly avatar: string;
  readonly avatarColor: string;
  readonly flag?: boolean;
}

interface Group {
  readonly name: string;
  readonly border: string;
  readonly done: string;
  readonly tasks: readonly TaskRow[];
}

const GROUPS: readonly Group[] = [
  {
    name: "In Progress",
    border: "#0069af",
    done: "2/4",
    tasks: [
      { title: "Patch Tuesday rollout — Dunder Mifflin", status: "In Progress", statusColor: "#0069af", due: "Today", dueColor: "#c2410c", avatar: "JH", avatarColor: "#0ea5e9" },
      { title: "Migrate mail flow — Vance Refrigeration", status: "Review", statusColor: "#b45309", due: "Tomorrow", dueColor: "#b45309", avatar: "PB", avatarColor: "#8b5cf6", flag: true },
    ],
  },
  {
    name: "This Week",
    border: "#f59e0b",
    done: "1/3",
    tasks: [
      { title: "Onboard Schrute Farms", status: "To Do", statusColor: "#64748b", due: "Fri", dueColor: "#2563eb", avatar: "KM", avatarColor: "#ec4899" },
      { title: "Firewall rule audit", status: "Completed", statusColor: "#10b981", due: "—", dueColor: "#94a3b8", avatar: "SR", avatarColor: "#0ea5e9" },
    ],
  },
];

/** Signature screen: "Activity" board — Monday.com-style grouped task rows
 * (default view, unchanged). */
export function ActivityTasksView() {
  return (
    <div className="flex flex-col gap-2 p-2.5 text-[color:var(--mock-text)]">
      <div className="flex items-center gap-1.5 text-[7px] font-medium text-[color:var(--mock-muted)]">
        <span className="rounded px-1.5 py-0.5" style={{ background: "var(--mock-panel-2)" }}>List</span>
        <span className="rounded px-1.5 py-0.5" style={{ color: "#0069af", background: "#e6f0f8" }}>Cards</span>
        <span className="ml-1">All · Mine · Overdue</span>
      </div>

      {GROUPS.map((group) => (
        <div
          key={group.name}
          className="rounded-lg border-l-4 bg-[color:var(--mock-panel)] p-1.5 shadow-sm"
          style={{ borderLeftColor: group.border, borderTop: "1px solid var(--mock-border)", borderRight: "1px solid var(--mock-border)", borderBottom: "1px solid var(--mock-border)" }}
        >
          <div className="mb-1 flex items-center gap-1.5">
            <span className="text-[8px] font-semibold">{group.name}</span>
            <span className="rounded-full px-1 py-0.5 text-[7px]" style={{ background: "var(--mock-panel-2)", color: "var(--mock-muted)" }}>
              {group.done}
            </span>
          </div>
          <div className="flex flex-col gap-1">
            {group.tasks.map((task) => (
              <div key={task.title} className="flex items-center gap-1.5">
                <span className="size-2.5 shrink-0 rounded-full border" style={{ borderColor: "var(--mock-border)" }} />
                {task.flag ? <span className="text-[7px] text-red-500">⚑</span> : null}
                <span className="min-w-0 flex-1 truncate text-[8px]">{task.title}</span>
                <span className="shrink-0 rounded-full px-1 py-0.5 text-[6px] font-medium text-white" style={{ background: task.statusColor }}>
                  {task.status}
                </span>
                <span className="shrink-0 rounded px-1 py-0.5 text-[6px] font-medium" style={{ color: task.dueColor }}>
                  {task.due}
                </span>
                <span className="flex size-3.5 shrink-0 items-center justify-center rounded-full text-[6px] font-semibold text-white" style={{ background: task.avatarColor }}>
                  {task.avatar}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

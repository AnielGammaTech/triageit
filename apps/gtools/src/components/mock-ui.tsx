export type MockTone = "ok" | "warn" | "bad" | "neutral";

const TONE_STYLES: Record<MockTone, string> = {
  ok: "border-emerald-500/25 bg-emerald-500/10 text-emerald-400",
  warn: "border-amber-500/25 bg-amber-500/10 text-amber-400",
  bad: "border-rose-500/25 bg-rose-500/10 text-rose-400",
  neutral: "border-line bg-panel-2 text-fog",
};

export function MockStat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-medium uppercase tracking-wider text-fog">
        {label}
      </span>
      <span
        className="font-display text-xs font-semibold tracking-tight text-snow"
        style={accent ? { color: accent } : undefined}
      >
        {value}
      </span>
    </div>
  );
}

export function MockPill({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: MockTone;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium leading-none ${TONE_STYLES[tone]}`}
    >
      {children}
    </span>
  );
}

export function MockRow({
  cells,
  emphasis,
}: {
  cells: readonly string[];
  emphasis?: number;
}) {
  return (
    <div className="flex items-center gap-3 border-b border-line/60 py-1.5 text-[10px] last:border-b-0">
      {cells.map((cell, index) => (
        <span
          key={index}
          className={`min-w-0 flex-1 truncate ${
            index === emphasis ? "font-medium text-snow" : "text-fog"
          }`}
        >
          {cell}
        </span>
      ))}
    </div>
  );
}

export function MockRowShell({
  children,
  bordered = true,
  className = "",
}: {
  children: React.ReactNode;
  bordered?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`flex items-center gap-3 py-1.5 text-[10px] ${
        bordered ? "border-t border-line/60" : ""
      } ${className}`
        .replace(/\s+/g, " ")
        .trim()}
    >
      {children}
    </div>
  );
}

export function MockBar({ pct, accent }: { pct: number; accent: string }) {
  const clamped = Math.min(100, Math.max(0, pct));
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-panel-2">
      <div
        className="h-full rounded-full"
        style={{ width: `${clamped}%`, background: accent }}
      />
    </div>
  );
}

export function MockPanel({
  title,
  children,
  accent,
}: {
  title: string;
  children: React.ReactNode;
  accent?: string;
}) {
  return (
    <div className="rounded-lg border border-line bg-panel-2 p-2.5">
      <div className="mb-2 flex items-center gap-1.5">
        {accent ? (
          <span
            className="size-1.5 rounded-full"
            style={{ background: accent }}
          />
        ) : null}
        <span className="text-[10px] font-medium uppercase tracking-wider text-fog">
          {title}
        </span>
      </div>
      <div className="flex flex-col gap-2">{children}</div>
    </div>
  );
}

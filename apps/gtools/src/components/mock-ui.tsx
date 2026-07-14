export type MockTone = "ok" | "warn" | "bad" | "neutral";

const TONE_STYLES: Record<MockTone, string> = {
  ok: "border-emerald-500/25 bg-emerald-500/10 text-emerald-400",
  warn: "border-amber-500/25 bg-amber-500/10 text-amber-400",
  bad: "border-rose-500/25 bg-rose-500/10 text-rose-400",
  neutral:
    "border-[color:var(--mock-border)] bg-[color:var(--mock-panel-2)] text-[color:var(--mock-muted)]",
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
      <span className="text-[10px] font-medium uppercase tracking-wider text-[color:var(--mock-muted)]">
        {label}
      </span>
      <span
        className="font-display text-xs font-semibold tracking-tight text-[color:var(--mock-text)]"
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
  style,
  className = "",
}: {
  children: React.ReactNode;
  tone?: MockTone;
  style?: React.CSSProperties;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium leading-none ${TONE_STYLES[tone]} ${className}`.trim()}
      style={style}
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
    <div
      className="flex items-center gap-3 border-b py-1.5 text-[10px] last:border-b-0"
      style={{ borderColor: "color-mix(in srgb, var(--mock-border) 60%, transparent)" }}
    >
      {cells.map((cell, index) => (
        <span
          key={index}
          className={`min-w-0 flex-1 truncate ${
            index === emphasis
              ? "font-medium text-[color:var(--mock-text)]"
              : "text-[color:var(--mock-muted)]"
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
      className={`flex items-center gap-3 py-1.5 text-[10px] ${bordered ? "border-t" : ""} ${className}`
        .replace(/\s+/g, " ")
        .trim()}
      style={
        bordered
          ? { borderColor: "color-mix(in srgb, var(--mock-border) 60%, transparent)" }
          : undefined
      }
    >
      {children}
    </div>
  );
}

export function MockBar({ pct, accent }: { pct: number; accent: string }) {
  const clamped = Math.min(100, Math.max(0, pct));
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-[color:var(--mock-panel-2)]">
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
    <div className="rounded-lg border border-[color:var(--mock-border)] bg-[color:var(--mock-panel-2)] p-2.5">
      <div className="mb-2 flex items-center gap-1.5">
        {accent ? (
          <span
            className="size-1.5 rounded-full"
            style={{ background: accent }}
          />
        ) : null}
        <span className="text-[10px] font-medium uppercase tracking-wider text-[color:var(--mock-muted)]">
          {title}
        </span>
      </div>
      <div className="flex flex-col gap-2">{children}</div>
    </div>
  );
}

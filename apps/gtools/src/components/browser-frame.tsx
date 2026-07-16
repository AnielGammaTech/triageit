export function accentVar(slug: string): string {
  return `var(--color-${slug})`;
}

// Brightened sibling of accentVar's locked hex, for text rendered directly
// on the dark page ground (ToolWordmark's "IT" suffix) — see globals.css's
// `--color-<slug>-tint` tokens and docs/brand/gtools-logo-standard.md's
// "Wordmark rule". Surfaces/tiles/glows keep using accentVar's locked hex;
// only small on-dark text needs the lifted variant.
export function tintVar(slug: string): string {
  return `var(--color-${slug}-tint)`;
}

export function BrowserFrame({
  accent,
  url,
  screenshotSrc,
  children,
}: {
  accent: string;
  url: string;
  screenshotSrc?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fx-frame-float relative isolate"
      data-native-cursor
    >
      {/* outer accent glow — breathes continuously */}
      <div
        aria-hidden
        className="fx-glow-pulse pointer-events-none absolute -inset-16 -z-10 opacity-50 blur-3xl"
        style={{
          background: `radial-gradient(ellipse at 50% 0%, ${accent}, transparent 65%)`,
        }}
      />

      <div className="fx-frame-tilt relative overflow-hidden rounded-xl border border-line bg-panel shadow-2xl shadow-black/50">
        {/* inner glass highlight */}
        <div className="pointer-events-none absolute inset-0 rounded-xl ring-1 ring-white/[0.04]" />

        {/* periodic scan-line sweep */}
        <div aria-hidden className="fx-scan-sweep z-10 rounded-xl" />

        {/* cursor-tracked glare highlight — position driven by fx/tilt.tsx
            via --glare-x/--glare-y on the ancestor .fx-tilt wrapper */}
        <div aria-hidden className="fx-glare z-10 rounded-xl" />

        {/* toolbar */}
        <div className="flex items-center gap-2 border-b border-line bg-panel-2 px-3 py-2">
          <div className="flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-red-500/40" />
            <span className="size-1.5 rounded-full bg-yellow-500/40" />
            <span className="size-1.5 rounded-full bg-green-500/40" />
          </div>
          <div className="ml-1.5 flex min-w-0 flex-1 items-center rounded-md border border-line bg-ink/50 px-2.5 py-1">
            <span className="truncate text-[10px] text-fog">{url}</span>
          </div>
        </div>

        {/* content */}
        <div className="bg-panel p-3">
          {screenshotSrc ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={screenshotSrc}
              alt=""
              className="block h-auto w-full rounded-md"
            />
          ) : (
            children
          )}
        </div>
      </div>
    </div>
  );
}

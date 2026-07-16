import { TOOLS } from "@/content/tools";
import { Reveal } from "@/components/fx/reveal";

// Numbers are derived from TOOLS at build time — never hand-typed — so this
// strip can never drift from the actual data as tools are added/removed.
const TOOLS_COUNT = TOOLS.length;
const INTEGRATIONS_COUNT = new Set(TOOLS.flatMap((tool) => tool.integrations)).size;

const STATS = [
  { label: "products", value: TOOLS_COUNT, suffix: "" },
  { label: "integrations", value: INTEGRATIONS_COUNT, suffix: "" },
  { label: "stack", value: 1, suffix: "" },
] as const;

// Server component: real final numbers are in the markup from the first
// byte (progressive enhancement, same contract as Reveal) — fx/scroll-fx.tsx
// only re-animates a stat's `data-fx="stat"` span from 0 up to that same
// value once it scrolls into view, gated behind the usual fine-pointer +
// no-reduced-motion + JS-mounted check. Under any fallback path this strip
// simply reads as static text, exactly like the rest of the page.
export function StatsStrip() {
  return (
    <section
      data-fx="stats-strip"
      className="border-y border-line/60 bg-panel/40"
    >
      <Reveal variant="up">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-center gap-x-10 gap-y-4 px-6 py-8 text-center">
          {STATS.map((stat) => (
            <p
              key={stat.label}
              className="flex items-baseline gap-2 font-display text-2xl font-semibold tracking-tight text-snow md:text-3xl"
            >
              <span
                data-fx="stat"
                data-fx-value={stat.value}
                className="fx-stat-value"
              >
                {stat.value}
                {stat.suffix}
              </span>
              <span className="text-xs font-medium uppercase tracking-[0.25em] text-fog">
                {stat.label}
              </span>
            </p>
          ))}
        </div>
      </Reveal>
    </section>
  );
}

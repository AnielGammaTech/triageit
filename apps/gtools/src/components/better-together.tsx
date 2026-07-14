import type { ReactNode } from "react";
import { TOOLS } from "@/content/tools";
import { accentVar } from "@/components/browser-frame";
import { Reveal } from "@/components/fx/reveal";

const PLATFORMS = ["Halo PSA", "Microsoft 365", "Datto", "JumpCloud"] as const;
const BUILT_ON_SLUGS = ["quoteit", "portalit", "projectit"] as const;

const BUILT_ON_TOOLS = BUILT_ON_SLUGS.map((slug) => {
  const tool = TOOLS.find((t) => t.slug === slug);
  if (!tool) throw new Error(`better-together: unknown tool slug "${slug}"`);
  return tool;
});

// Shared grid template so the chip rows and their connector fans line up
// on the same column boundaries. Kept as full literal class strings so
// Tailwind's scanner can pick them up.
const GRID_3 = "md:grid-cols-3";
const GRID_4 = "md:grid-cols-4";
const GAP = "md:gap-x-4";

export function BetterTogether() {
  return (
    <section className="mx-auto max-w-7xl px-6 pt-8 pb-24 md:pt-10">
      <Reveal variant="up">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="font-display text-3xl font-semibold tracking-tight text-snow md:text-4xl">
            Better together.
          </h2>
          <p className="mt-4 text-lg text-fog">
            ConnectIT normalizes data from the platforms we already run — Halo
            PSA, Microsoft 365, Datto, JumpCloud — into one source of truth.
            QuoteIT, PortalIT, and ProjectIT build on it, so a customer looks
            the same in every tool.
          </p>
        </div>
      </Reveal>

      <Reveal variant="scale" delayMs={150}>
        <div className="relative mx-auto mt-16 max-w-2xl" aria-hidden="true">
          {/* blueprint dot-grid backdrop */}
          <div
            className="pointer-events-none absolute inset-0 -z-10 opacity-[0.12]"
            style={{
              backgroundImage:
                "radial-gradient(circle, var(--color-line) 1px, transparent 1px)",
              backgroundSize: "18px 18px",
            }}
          />

          <p className="text-center text-[11px] font-medium uppercase tracking-[0.25em] text-fog/70">
            Suite
          </p>

          <TierRow cols={3}>
            {BUILT_ON_TOOLS.map((tool) => (
              <ProductChip
                key={tool.slug}
                name={tool.name}
                accent={tool.accent}
              />
            ))}
          </TierRow>

          <ConnectorFan cols={3} stemsAtTop />
          <Junction />

          <div className="flex justify-center">
            <ConnectItNode />
          </div>

          <Junction />
          <ConnectorFan cols={4} stemsAtTop={false} />

          <TierRow cols={4}>
            {PLATFORMS.map((name) => (
              <PlatformChip key={name} name={name} />
            ))}
          </TierRow>

          <p className="mt-3 text-center text-[11px] font-medium uppercase tracking-[0.25em] text-fog/70">
            Platforms
          </p>
        </div>
      </Reveal>
    </section>
  );
}

function TierRow({ cols, children }: { cols: 3 | 4; children: ReactNode }) {
  const gridCols = cols === 3 ? GRID_3 : GRID_4;
  return (
    <div
      className={`flex flex-wrap items-center justify-center gap-x-3 gap-y-3 md:grid md:items-center md:justify-items-center ${gridCols} ${GAP}`}
    >
      {children}
    </div>
  );
}

function ConnectorFan({
  cols,
  stemsAtTop,
}: {
  cols: 3 | 4;
  stemsAtTop: boolean;
}) {
  const gridCols = cols === 3 ? GRID_3 : GRID_4;
  const count = cols === 3 ? 3 : 4;
  const accent = accentVar("connectit");

  return (
    <div className="relative hidden h-8 md:block">
      {/* single continuous bus, sits at the edge farthest from the chips */}
      <div
        className={`absolute inset-x-0 h-px bg-line ${stemsAtTop ? "bottom-0" : "top-0"}`}
      />
      {/* one stem per column, sharing the chip row's grid template — each
          carries a traveling glow dot on a staggered delay so both tiers
          feel like one continuous data flow into ConnectIT. */}
      <div className={`grid h-full ${gridCols} ${GAP}`}>
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} className="flex justify-center">
            <div className="relative h-full w-px bg-line">
              <span
                aria-hidden
                className="fx-line-dot-track fx-line-dot-y"
                style={{ animationDelay: `${i * 0.4}s` }}
              >
                <span
                  className="fx-line-dot"
                  style={{ background: accent, boxShadow: `0 0 6px ${accent}` }}
                />
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Junction() {
  const accent = accentVar("connectit");
  return (
    <div className="hidden justify-center md:flex">
      <span
        className="fx-junction-pulse size-1.5 rounded-full"
        style={{ background: accent, boxShadow: `0 0 8px ${accent}` }}
      />
    </div>
  );
}

function ConnectItNode() {
  const accent = accentVar("connectit");
  return (
    <div className="relative isolate">
      <div
        className="pointer-events-none absolute -inset-10 -z-10 rounded-full opacity-60 blur-2xl"
        style={{
          background: `radial-gradient(circle, ${accent}, transparent 70%)`,
        }}
      />

      {/* radar ping — a few staggered expanding rings read as a sonar pulse */}
      <span
        aria-hidden
        className="fx-radar-ring"
        style={{ color: accent }}
      />
      <span
        aria-hidden
        className="fx-radar-ring"
        style={{ color: accent, animationDelay: "1s" }}
      />
      <span
        aria-hidden
        className="fx-radar-ring"
        style={{ color: accent, animationDelay: "2s" }}
      />

      <div
        className="relative flex flex-col items-center gap-1 rounded-2xl border bg-panel px-9 py-5 shadow-2xl shadow-black/50"
        style={{
          borderColor: accent,
          boxShadow: `0 0 0 1px color-mix(in srgb, ${accent} 35%, transparent), 0 0 40px -10px ${accent}`,
        }}
      >
        <CornerBracket accent={accent} className="-top-1.5 -left-1.5 border-t border-l" />
        <CornerBracket accent={accent} className="-top-1.5 -right-1.5 border-t border-r" />
        <CornerBracket accent={accent} className="-bottom-1.5 -left-1.5 border-b border-l" />
        <CornerBracket accent={accent} className="-bottom-1.5 -right-1.5 border-b border-r" />

        <span className="font-display text-xl font-semibold tracking-tight text-snow">
          ConnectIT
        </span>
        <span className="text-[10px] font-medium uppercase tracking-[0.2em] text-fog">
          Integration hub
        </span>
      </div>
    </div>
  );
}

function CornerBracket({
  accent,
  className,
}: {
  accent: string;
  className: string;
}) {
  return (
    <span
      className={`absolute size-3 ${className}`}
      style={{ borderColor: accent }}
    />
  );
}

function ProductChip({ name, accent }: { name: string; accent: string }) {
  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-line bg-panel-2/80 px-4 py-2 text-sm font-medium text-snow">
      <span
        className="size-2 rounded-full"
        style={{
          background: accentVar(accent),
          boxShadow: `0 0 8px ${accentVar(accent)}`,
        }}
      />
      {name}
    </div>
  );
}

function PlatformChip({ name }: { name: string }) {
  return (
    <div className="inline-flex items-center rounded-full border border-line bg-panel px-4 py-2 text-sm text-fog">
      {name}
    </div>
  );
}

"use client";

import type { Tool } from "@/content/types";
import { TOOLS } from "@/content/tools";
import { accentVar } from "@/components/browser-frame";
import { ToolLogo } from "@/components/tool-logo";
import { Reveal } from "@/components/fx/reveal";
import { useMagnetic } from "@/components/fx/magnetic";

// One card per tool, each its own component instance so `useMagnetic` (a
// hook — can't be called inside the surrounding `.map()` directly) gets a
// fresh, independent ref and proximity calculation per card. The ref is
// threaded into Reveal's `innerRef` so both the scroll-reveal and the
// magnetic pull land on the exact same anchor element.
function SuiteCard({
  tool,
  delayMs,
  index,
}: {
  tool: Tool;
  delayMs: number;
  index: number;
}) {
  const magnetRef = useMagnetic<HTMLAnchorElement>();

  return (
    <Reveal variant="up" delayMs={delayMs} innerRef={magnetRef}>
      <a
        href={`#${tool.slug}`}
        data-fx="grid-card"
        data-fx-index={index}
        className="group relative flex flex-col gap-3 rounded-2xl border border-line bg-panel p-6 transition-transform duration-300 ease-out hover:-translate-y-1"
      >
        {/* accent border on hover */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-2xl border opacity-0 transition-opacity duration-300 group-hover:opacity-100"
          style={{ borderColor: accentVar(tool.accent) }}
        />

        {/* THE LOGO JOURNEY, phase 2 — GSAP (scroll-fx-grid.ts) pops this in
            with a per-card stagger scrubbed against the grid's own scroll
            progress, reading as the grid "dealing" each card its logo;
            reversible and inert until the fine-pointer/no-reduced-motion
            gate passes, at which point this span's normal static layout is
            simply the pre-scroll rest state GSAP animates from. */}
        <span data-fx="grid-card-logo" className="inline-flex">
          <ToolLogo slug={tool.slug} size={26} />
        </span>

        <h3 className="font-display text-lg font-semibold text-snow">
          {tool.name}
        </h3>
        <p className="text-sm text-fog">{tool.oneLiner}</p>

        <span
          aria-hidden
          className="mt-auto pt-2 text-sm text-fog opacity-0 transition-all duration-300 group-hover:translate-x-0.5 group-hover:opacity-100"
        >
          →
        </span>
      </a>
    </Reveal>
  );
}

export function SuiteGrid() {
  return (
    <section data-fx="suite-grid" className="mx-auto max-w-7xl px-6 pt-16 pb-24 md:pt-20">
      <Reveal variant="up">
        <h2 className="font-display text-3xl font-semibold tracking-tight text-snow md:text-4xl">
          Eleven tools. One stack.
        </h2>
      </Reveal>

      <div className="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {TOOLS.map((tool, i) => (
          <SuiteCard key={tool.slug} tool={tool} delayMs={i * 70} index={i} />
        ))}
      </div>
    </section>
  );
}

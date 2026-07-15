import { TOOLS } from "@/content/tools";
import { Reveal } from "@/components/fx/reveal";

const BOOT_LINE = `gtools os — ${TOOLS.length} systems online`;

// Header logo-drop redesign (task 18) — the hero no longer carries any tool
// logo presence of its own. All 11 logos now live in the nav (nav.tsx) and
// travel from there down into their own section via
// scroll-fx-header-drop.ts; keeping the hero clean (headline, subhead, boot
// line only) is what makes that first "drop" read clearly instead of
// competing with a duplicate logo display up here.
//
// Task 19 rebalance — the marquee band that used to sit directly under this
// section (duplicating the header's own logo row) is gone. `min-h-[80vh]`
// dropped to `72vh` so the hero doesn't hold open more empty air than its
// own content needs, and the hairline `border-b` below replaces the visual
// "close" the marquee's own `border-y` used to provide — a full-bleed seam
// at zero extra height, so hero -> suite-grid reads as one clean handoff
// instead of a hard cut or a dead gap.
export function Hero() {
  return (
    <section
      data-fx="hero-section"
      className="relative flex min-h-[72vh] flex-col items-center justify-center overflow-hidden border-b border-line/40 px-6 py-16 text-center"
    >
      {/* brand glow — breathes continuously once on screen */}
      <div
        aria-hidden
        className="fx-glow-breathe pointer-events-none absolute inset-x-0 top-0 -z-10 h-[70vh] opacity-40 blur-3xl"
        style={{
          background:
            "radial-gradient(ellipse 55% 45% at 50% 0%, var(--color-brand), transparent 70%)",
        }}
      />

      <h1
        data-fx="hero-headline"
        className="max-w-3xl text-balance font-display text-4xl font-semibold tracking-tight text-snow md:max-w-4xl md:text-6xl"
      >
        <Reveal variant="up">
          <span className="block">The software we built</span>
        </Reveal>
        <Reveal variant="up" delayMs={140}>
          <span className="fx-shimmer-text block">
            to run our MSP.
            <span aria-hidden className="fx-shimmer-sweep pointer-events-none" />
          </span>
        </Reveal>
      </h1>

      <Reveal variant="up" delayMs={260}>
        <p className="mt-6 max-w-2xl text-lg text-fog">
          Gamma Tech Services didn{"'"}t settle for off-the-shelf. GTools is
          the suite of eleven products we engineered to triage tickets, stop
          attacks, reconcile billing, and keep clients informed — and it runs
          our helpdesk every day.
        </p>
      </Reveal>

      {/* terminal boot line — real text server-rendered (progressive
          enhancement); scroll-fx.tsx only clears + retypes it once the gate
          passes, so no-JS/reduced-motion/touch visitors just read the full
          line immediately, exactly like the spec requires. */}
      <p aria-hidden="true" className="fx-boot-line mt-4">
        <span data-fx="boot-line">{BOOT_LINE}</span>
        <span data-fx="boot-cursor" className="fx-boot-cursor" />
      </p>
    </section>
  );
}

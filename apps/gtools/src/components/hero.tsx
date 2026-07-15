import { TOOLS } from "@/content/tools";
import { ToolLogo } from "@/components/tool-logo";
import { Reveal } from "@/components/fx/reveal";

const BOOT_LINE = `gtools os — ${TOOLS.length} systems online`;
const ORBIT_STEP_DEG = 360 / TOOLS.length;

export function Hero() {
  return (
    <section
      data-fx="hero-section"
      className="relative flex min-h-[80vh] flex-col items-center justify-center overflow-hidden px-6 py-16 text-center"
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

      {/* THE LOGO JOURNEY, phase 0 — the 11 tool logos are the hero's only
          tool presence now (the old static chip row was a straight
          duplicate of this ring and is gone). Always rendered at full
          opacity from first paint (no JS/scroll-gated fade-in, so there's
          no CLS risk and no repeat of the task-16 hero-invisible bug); only
          the *motion* (3D orbit spin + idle bob) is gated behind
          `html[data-fx-scroll="active"]` (itself fine-pointer +
          no-reduced-motion only — see fx-scroll.tsx), so touch/reduced-
          motion/no-JS visitors get this exact ring, frozen in place, which
          is the spec's required mobile fallback. Each logo is a real
          same-page anchor (keyboard-reachable, `aria-label`led) so the
          in-hero jump-to-section affordance the old chips provided isn't
          lost — it doubles as a name label on hover/focus. */}
      <div
        data-fx="hero-orbit"
        className="fx-orbit-stage pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-[42%]"
      >
        <div className="fx-orbit-ring">
          {TOOLS.map((tool, i) => (
            <span
              key={tool.slug}
              data-fx="orbit-logo"
              data-fx-index={i}
              className="fx-orbit-logo"
              style={
                {
                  "--orbit-angle": `${i * ORBIT_STEP_DEG}deg`,
                  "--orbit-index": i,
                } as React.CSSProperties
              }
            >
              <span className="fx-orbit-float">
                <a
                  href={`#${tool.slug}`}
                  data-fx="orbit-logo-inner"
                  className="fx-orbit-logo-inner"
                  aria-label={tool.name}
                >
                  <ToolLogo slug={tool.slug} size={24} />
                </a>
                <span aria-hidden className="fx-orbit-label">
                  {tool.name}
                </span>
              </span>
            </span>
          ))}
        </div>
      </div>

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

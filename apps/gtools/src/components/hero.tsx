import { TOOLS } from "@/content/tools";
import { accentVar } from "@/components/browser-frame";
import { Reveal } from "@/components/fx/reveal";

export function Hero() {
  return (
    <section className="relative flex min-h-[80vh] flex-col items-center justify-center overflow-hidden px-6 py-16 text-center">
      {/* brand glow — breathes continuously once on screen */}
      <div
        aria-hidden
        className="fx-glow-breathe pointer-events-none absolute inset-x-0 top-0 -z-10 h-[70vh] opacity-40 blur-3xl"
        style={{
          background:
            "radial-gradient(ellipse 55% 45% at 50% 0%, var(--color-brand), transparent 70%)",
        }}
      />

      <h1 className="max-w-4xl text-balance font-display text-5xl font-semibold tracking-tight text-snow md:text-7xl">
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

      <div className="mt-10 flex flex-wrap items-center justify-center gap-2.5">
        {TOOLS.map((tool, i) => (
          <Reveal key={tool.slug} variant="up" delayMs={380 + i * 60}>
            <a
              href={`#${tool.slug}`}
              className="inline-flex items-center gap-2 rounded-full border border-line bg-panel-2/80 px-3.5 py-1.5 text-xs font-medium text-fog transition-colors hover:border-white/20 hover:text-snow"
            >
              <span
                aria-hidden
                className="size-1.5 rounded-full"
                style={{
                  background: accentVar(tool.accent),
                  boxShadow: `0 0 6px ${accentVar(tool.accent)}`,
                }}
              />
              {tool.name}
            </a>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

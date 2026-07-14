import { TOOLS } from "@/content/tools";
import { accentVar } from "@/components/browser-frame";

export function Hero() {
  return (
    <section className="relative flex min-h-[80vh] flex-col items-center justify-center overflow-hidden px-6 py-16 text-center">
      {/* brand glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[70vh] opacity-40 blur-3xl"
        style={{
          background:
            "radial-gradient(ellipse 55% 45% at 50% 0%, var(--color-brand), transparent 70%)",
        }}
      />

      <h1 className="max-w-4xl text-balance font-display text-5xl font-semibold tracking-tight text-snow md:text-7xl">
        The software we built to run our MSP.
      </h1>

      <p className="mt-6 max-w-2xl text-lg text-fog">
        Gamma Tech Services didn{"'"}t settle for off-the-shelf. GTools is
        the suite of eight products we engineered to triage tickets, stop
        attacks, reconcile billing, and keep clients informed — and it runs
        our helpdesk every day.
      </p>

      <div className="mt-10 flex flex-wrap items-center justify-center gap-2.5">
        {TOOLS.map((tool) => (
          <a
            key={tool.slug}
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
        ))}
      </div>
    </section>
  );
}

import { BrowserFrame, accentVar } from "@/components/browser-frame";
import { MOCKUPS } from "@/components/mockups";
import { Reveal } from "@/components/fx/reveal";
import type { Tool } from "@/content/types";

export function ToolSection({ tool, flip }: { tool: Tool; flip: boolean }) {
  const accent = accentVar(tool.accent);
  const Mockup = MOCKUPS[tool.mockup];

  return (
    <section
      id={tool.slug}
      className="relative scroll-mt-24 overflow-x-clip border-t border-line/60"
    >
      {/* directional accent wash, flips sides with the layout */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 opacity-[0.06]"
        style={{
          background: `radial-gradient(ellipse 60% 55% at ${
            flip ? "85% 10%" : "15% 10%"
          }, ${accent}, transparent 70%)`,
        }}
      />

      <div className="mx-auto max-w-7xl px-6 py-20 md:py-28">
        <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-2 lg:gap-16">
          <Reveal variant="up">
            <div className={flip ? "lg:order-2" : undefined}>
              <p
                className="text-xs font-semibold uppercase tracking-[0.25em]"
                style={{ color: accent }}
              >
                {tool.name}
              </p>

              <h2 className="mt-3 font-display text-3xl font-semibold tracking-tight text-snow md:text-4xl">
                {tool.tagline}
              </h2>

              <p className="mt-4 text-base leading-relaxed text-fog md:text-lg">
                {tool.description}
              </p>

              <ul className="mt-8 space-y-4">
                {tool.features.map((feature, i) => (
                  <Reveal key={feature.title} variant="up" delayMs={120 + i * 90}>
                    <li className="flex items-start gap-3">
                      <span
                        aria-hidden
                        className="mt-2 size-1.5 shrink-0 rounded-full"
                        style={{
                          background: accent,
                          boxShadow: `0 0 6px ${accent}`,
                        }}
                      />
                      <div>
                        <p className="font-medium text-snow">{feature.title}</p>
                        <p className="mt-1 text-sm text-fog">{feature.blurb}</p>
                      </div>
                    </li>
                  </Reveal>
                ))}
              </ul>

              <div className="mt-8 flex flex-wrap gap-2">
                {tool.integrations.map((integration) => (
                  <span
                    key={integration}
                    className="rounded-full border border-line bg-panel-2/80 px-3 py-1 text-xs text-fog"
                  >
                    {integration}
                  </span>
                ))}
              </div>
            </div>
          </Reveal>

          <Reveal variant={flip ? "left" : "right"}>
            <div className={flip ? "lg:order-1" : undefined}>
              <BrowserFrame
                accent={accent}
                url={`${tool.slug}.gtools.io`}
                screenshotSrc={tool.screenshotSrc}
              >
                <Mockup />
              </BrowserFrame>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

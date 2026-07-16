import { BrowserFrame, accentVar } from "@/components/browser-frame";
import { MOCKUPS } from "@/components/mockups";
import { ToolLogo } from "@/components/tool-logo";
import { ToolWordmark } from "@/components/tool-wordmark";
import { Reveal } from "@/components/fx/reveal";
import { Tilt } from "@/components/fx/tilt";
import type { Tool } from "@/content/types";

// How far each section's accent wash overshoots its own top/bottom edge
// (viewport-height units, so it scales with the visitor's screen rather
// than any one section's actual content height) — the amount that bleeds
// into the neighboring section above/below, turning the seam between them
// into a continuous gradient instead of a hard cut.
const WASH_BLEED_VH = 18;

export function ToolSection({
  tool,
  flip,
  index,
}: {
  tool: Tool;
  flip: boolean;
  index: number;
}) {
  const accent = accentVar(tool.accent);
  const Mockup = MOCKUPS[tool.mockup];
  const numeral = String(index + 1).padStart(2, "0");

  return (
    <section
      id={tool.slug}
      data-fx="tool-section"
      data-fx-slug={tool.slug}
      className="relative scroll-mt-24 overflow-x-clip"
    >
      {/* directional accent wash, flips sides with the layout. No hard
          `border-t` between sections anymore and no `inset-0` clipping to
          this section's own box either — the wash overshoots top/bottom by
          `WASH_BLEED_VH` so its long, soft tail actually paints into the
          neighboring sections above/below (nothing here has an opaque
          background, so low-opacity layers from adjacent sections combine
          naturally), and the 3-stop gradient trades the old sharp
          "color, transparent 70%" falloff for a much longer, gentler one —
          together that's what turns section boundaries from a hard seam
          into a continuous color bleed when scrolling past them. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -z-10 opacity-[0.09]"
        style={{
          top: `-${WASH_BLEED_VH}vh`,
          bottom: `-${WASH_BLEED_VH}vh`,
          background: `radial-gradient(ellipse 78% 62% at ${
            flip ? "85% 26%" : "15% 26%"
          }, ${accent} 0%, color-mix(in srgb, ${accent} 45%, transparent) 42%, transparent 82%)`,
        }}
      />

      {/* ghost section numeral — big translucent outline, parallax-shifted
          against scroll depth once fx/scroll-fx.tsx is active; static and
          harmless (translateY(0)) otherwise. */}
      <div
        aria-hidden
        data-fx="ghost-numeral"
        data-fx-index={index}
        className="fx-ghost-numeral-wrap"
        style={flip ? { right: "2%" } : { left: "2%" }}
      >
        <span className="fx-ghost-numeral">{numeral}</span>
      </div>

      <div className="mx-auto max-w-7xl px-6 py-20 md:py-28">
        <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-2 lg:gap-16">
          <Reveal variant="up">
            <div
              data-fx="parallax-copy"
              className={flip ? "lg:order-2" : undefined}
            >
              <div className="flex items-center gap-2.5">
                {/* Header logo-drop choreography (task 18) — this is the
                    docking destination for this tool's nav chip
                    (nav.tsx). scroll-fx-header-drop.ts scrubs the logo in
                    from the live header-chip position down into this exact
                    slot as the section approaches (arc + rotation + scale
                    up), with an accent trail line (logo-trail) flaring just
                    before it lands. Both inert/static until the gate
                    passes — this span's normal flow position (full
                    opacity, no transform) is the resting/no-JS/reduced-
                    motion state, so the logo is always visible here even
                    when the drop never runs. */}
                <span data-fx="section-logo" className="fx-section-logo">
                  <span
                    aria-hidden
                    data-fx="logo-trail"
                    className="fx-logo-trail"
                    style={{ background: `linear-gradient(to bottom, transparent, ${accent})` }}
                  />
                  <ToolLogo slug={tool.slug} size={30} />
                </span>
                <p className="text-xs font-semibold uppercase tracking-[0.25em] text-snow">
                  {/*
                    `data-fx="decrypt-kicker"` moves down to the base-name
                    span (not this <p>) so scroll-fx-decrypt.ts's scramble
                    only rewrites the base name's textContent — otherwise it
                    would flatten the two-tone wordmark's accent-colored
                    "IT" span into plain text the first time this section
                    scrolls into view. scroll-fx-header-drop.ts's
                    `section.querySelector('[data-fx="decrypt-kicker"]')`
                    still resolves to this same inner span for its live
                    getBoundingClientRect() position math, which is exactly
                    where the kicker text sits either way.
                  */}
                  <ToolWordmark
                    name={tool.name}
                    slug={tool.slug}
                    nameProps={{ "data-fx": "decrypt-kicker" }}
                  />
                </p>
              </div>

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
            <div
              data-fx="parallax-mockup"
              className={flip ? "lg:order-1" : undefined}
            >
              <Tilt>
                <BrowserFrame
                  accent={accent}
                  url={`${tool.slug}.gtools.io`}
                  screenshotSrc={tool.screenshotSrc}
                >
                  <Mockup />
                </BrowserFrame>
              </Tilt>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

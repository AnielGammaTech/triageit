import { TOOLS } from "@/content/tools";
import { accentVar } from "@/components/browser-frame";
import { ToolLogo } from "@/components/tool-logo";

// Server component: CSS-only infinite marquee of the 8 tool wordmarks in
// their real accent colors. The track is duplicated once so translateX(-50%)
// loops seamlessly; hovering pauses it (see .fx-marquee-track in
// globals.css). Purely decorative, so the whole band is aria-hidden.
export function Marquee() {
  return (
    <div
      aria-hidden
      data-fx="marquee"
      className="fx-marquee relative overflow-hidden border-y border-line/60 py-5"
    >
      <div className="fx-marquee-fade fx-marquee-fade-left pointer-events-none absolute inset-y-0 left-0 z-10 w-16 md:w-32" />
      <div className="fx-marquee-fade fx-marquee-fade-right pointer-events-none absolute inset-y-0 right-0 z-10 w-16 md:w-32" />

      {/* boost wrapper: fx/scroll-fx.tsx nudges this element (never the
          track itself) a few extra forward px when scroll velocity spikes,
          so the CSS loop below never has its own transform overridden or
          interrupted — it just keeps looping underneath the nudge. */}
      <div data-fx="marquee-boost" className="fx-marquee-boost">
        <div className="fx-marquee-track flex w-max items-center gap-10">
          {[0, 1].map((rep) => (
            <div key={rep} className="flex items-center gap-10">
              {TOOLS.map((tool) => (
                <span
                  key={`${rep}-${tool.slug}`}
                  className="fx-marquee-item flex shrink-0 items-center gap-2.5 whitespace-nowrap"
                >
                  <ToolLogo slug={tool.slug} size={22} />
                  <span
                    className="font-display text-xl font-semibold tracking-tight md:text-2xl"
                    style={{
                      color: accentVar(tool.accent),
                      textShadow: `0 0 20px ${accentVar(tool.accent)}`,
                    }}
                  >
                    {tool.name}
                  </span>
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

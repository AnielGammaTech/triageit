// Server component: the fixed, full-viewport "living backdrop" behind every
// section — perspective grid floor, drifting brand-color orbs, and a faint
// noise layer. Purely decorative (aria-hidden) and purely CSS: every loop is
// a transform/opacity keyframe defined in globals.css and gated behind
// `prefers-reduced-motion: no-preference`, so under reduced motion this
// renders as a static, motionless scene. The twinkling star-speck field
// (task 19) was removed — it read as visual noise rather than atmosphere;
// the grid floor, orbs, and noise layer below carry the depth on their own.

const ORBS = [
  { top: "6%", left: "10%", size: "42vmax", color: "var(--color-brand)", duration: "34s", delay: "-4s" },
  { top: "58%", left: "82%", size: "36vmax", color: "var(--color-connectit)", duration: "40s", delay: "-19s" },
  { top: "86%", left: "18%", size: "32vmax", color: "var(--color-quoteit)", duration: "37s", delay: "-11s" },
] as const;

export function Backdrop() {
  return (
    <div
      aria-hidden
      className="fx-backdrop pointer-events-none fixed inset-0 -z-50 overflow-hidden"
    >
      {/* two independent transform layers per depth group: the outer
          `scroll-parallax-bg` wrapper is scroll-position driven (translateY
          at a depth ratio), the inner `cursor-depth` wrapper is pointer
          driven (a few px toward the cursor) — separate elements so
          fx/scroll-fx.tsx never has two effects fighting over one
          element's `transform`, and the drift/breathe keyframes keep
          running untouched on the innermost children. */}
      <div data-fx="scroll-parallax-bg" data-fx-depth="0.12">
        <div data-fx="cursor-depth" data-fx-depth="0.4">
          <div className="fx-grid-floor" />
        </div>
      </div>

      <div data-fx="scroll-parallax-bg" data-fx-depth="0.22">
        <div data-fx="cursor-depth" data-fx-depth="0.7">
          {ORBS.map((orb, i) => (
            <span
              key={i}
              className="fx-orb"
              style={{
                top: orb.top,
                left: orb.left,
                width: orb.size,
                height: orb.size,
                background: `radial-gradient(circle, ${orb.color}, transparent 70%)`,
                animationDuration: orb.duration,
                animationDelay: orb.delay,
              }}
            />
          ))}
        </div>
      </div>

      <div className="fx-noise" />
    </div>
  );
}

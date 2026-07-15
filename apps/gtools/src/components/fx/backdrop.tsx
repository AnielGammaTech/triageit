// Server component: the fixed, full-viewport "living backdrop" behind every
// section — perspective grid floor, drifting brand-color orbs, twinkling
// specks, and a faint noise layer. Purely decorative (aria-hidden) and
// purely CSS: every loop is a transform/opacity keyframe defined in
// globals.css and gated behind `prefers-reduced-motion: no-preference`, so
// under reduced motion this renders as a static, motionless scene.

const ORBS = [
  { top: "6%", left: "10%", size: "42vmax", color: "var(--color-brand)", duration: "34s", delay: "-4s" },
  { top: "58%", left: "82%", size: "36vmax", color: "var(--color-connectit)", duration: "40s", delay: "-19s" },
  { top: "86%", left: "18%", size: "32vmax", color: "var(--color-quoteit)", duration: "37s", delay: "-11s" },
] as const;

// Fixed, deterministic-looking speck field (percent positions) instead of
// Math.random() — keeps server output stable across renders/builds.
const SPECKS = [
  [4, 9], [12, 24], [19, 5], [26, 37], [33, 14], [39, 49], [46, 7], [53, 31],
  [61, 17], [68, 43], [75, 11], [81, 35], [88, 19], [95, 46], [9, 60], [17, 73],
  [29, 66], [36, 84], [43, 61], [50, 90], [58, 70], [65, 94], [72, 57], [83, 80],
  [90, 64], [97, 87], [7, 96], [16, 91], [24, 99], [96, 3],
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

      {SPECKS.map(([x, y], i) => (
        <span
          key={i}
          className="fx-speck"
          style={{
            left: `${x}%`,
            top: `${y}%`,
            animationDelay: `${(i % 7) * 0.6}s`,
            animationDuration: `${4 + (i % 5)}s`,
          }}
        />
      ))}

      <div className="fx-noise" />
    </div>
  );
}

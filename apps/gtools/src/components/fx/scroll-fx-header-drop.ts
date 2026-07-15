import type { ScrollTrigger } from "gsap/ScrollTrigger";
import type { ScrollFxContext, ScrollFxCleanup } from "./scroll-fx-context";

const TRIGGER_START = "top 92%";
const TRIGGER_END = "top 38%";
const SCALE_START = 0.5;
const ROTATE_START_DEG = -16;
const ARC_BOW_PX = 26;
const GHOST_OPACITY = 0.16;
const GHOST_RAMP = 0.4; // chip reaches full ghost opacity by this much progress
const GHOST_THRESHOLD = 0.05; // progress past which the chip is considered "dropped"
const LAND_WINDOW_START = 0.7; // trail flourish only fires in the final 30% (the landing)

// Header logo-drop choreography (task 18, supersedes THE LOGO JOURNEY's
// phase 1/3 from task 17 — the hero convergence and the short
// above-the-kicker glide). Owner's brief: "the logos drop one by one from
// the header ... and as i scroll down they drop down and then scroll up
// and they animate back". Every tool's logo now permanently lives in the
// nav (nav.tsx, `data-fx="nav-chip"`) and this registrar is the only thing
// that ever moves it: as that tool's section approaches, the chip's own
// spot in the header dims to a "ghost" and the section's own logo (already
// docked in its resting position, `data-fx="section-logo"` —
// tool-section.tsx) is scrubbed in from a live-measured offset that makes
// it look like it fell out of the header chip, arcing/rotating/scaling up
// as it drops, and settling exactly into its normal document position —
// never touching that position value directly, so "docked" is always
// simply `transform: none`.
//
// Live `getBoundingClientRect()` reads every tick (not a one-time measured
// delta) are required here, unlike the old phase-1 hero→marquee tween:
// the header chip is `position: sticky`, so its viewport position is
// scroll-invariant, while the section's kicker is a normal in-flow element
// whose viewport position is scroll-*variant* — the distance between them
// only reflects the real header-to-section relationship if it's
// remeasured live against the current scroll, not memoized once at
// mount/refresh. Multiplying that live delta by `(1 - progress)` on every
// tick — rather than tweening toward a precomputed end value — also means
// the logo always resolves to its real layout position at progress 1
// regardless of how (in)accurately the delta was measured along the way.
export function registerHeaderDrop({ gsap, ScrollTrigger }: ScrollFxContext): ScrollFxCleanup {
  const triggers: ScrollTrigger[] = [];
  const restoreFns: Array<() => void> = [];

  const chips = new Map<string, HTMLElement>();
  document.querySelectorAll<HTMLElement>('[data-fx="nav-chip"]').forEach((chip) => {
    const slug = chip.dataset.fxTarget;
    if (slug) chips.set(slug, chip);
  });

  document.querySelectorAll<HTMLElement>('[data-fx="tool-section"]').forEach((section) => {
    const slug = section.dataset.fxSlug;
    const chip = slug ? chips.get(slug) : undefined;
    const logo = section.querySelector<HTMLElement>('[data-fx="section-logo"]');
    const trail = section.querySelector<HTMLElement>('[data-fx="logo-trail"]');
    const kicker = section.querySelector<HTMLElement>('[data-fx="decrypt-kicker"]');
    if (!chip || !logo || !kicker) return;

    const setX = gsap.quickSetter(logo, "x", "px");
    const setY = gsap.quickSetter(logo, "y", "px");
    const setRotate = gsap.quickSetter(logo, "rotate", "deg");
    const setScale = gsap.quickSetter(logo, "scale");
    const setLogoOpacity = gsap.quickSetter(logo, "opacity");
    const setChipOpacity = gsap.quickSetter(chip, "opacity");
    const setTrailOpacity = trail ? gsap.quickSetter(trail, "opacity") : null;
    const setTrailScale = trail ? gsap.quickSetter(trail, "scaleY") : null;

    let ghosted = false;

    function update(self: { progress: number }) {
      const p = self.progress;
      const remaining = 1 - p;
      const chipRect = chip!.getBoundingClientRect();
      const kickerRect = kicker!.getBoundingClientRect();

      const dx = chipRect.left + chipRect.width / 2 - kickerRect.left;
      const dy = chipRect.top + chipRect.height / 2 - (kickerRect.top + kickerRect.height / 2);
      const arc = Math.sin(p * Math.PI) * ARC_BOW_PX;

      setX(dx * remaining + arc);
      setY(dy * remaining);
      setRotate(ROTATE_START_DEG * remaining);
      setScale(SCALE_START + (1 - SCALE_START) * p);
      setLogoOpacity(p);

      setChipOpacity(1 - Math.min(1, p / GHOST_RAMP) * (1 - GHOST_OPACITY));

      if (setTrailOpacity && setTrailScale) {
        const land = Math.min(1, Math.max(0, (p - LAND_WINDOW_START) / (1 - LAND_WINDOW_START)));
        const flare = land < 0.5 ? land * 2 : (1 - land) * 2;
        setTrailOpacity(flare * 0.9);
        setTrailScale(1 - land);
      }

      const nowGhosted = p > GHOST_THRESHOLD;
      if (nowGhosted !== ghosted) {
        ghosted = nowGhosted;
        if (nowGhosted) chip!.setAttribute("data-dropped", "true");
        else chip!.removeAttribute("data-dropped");
      }
    }

    const trigger = ScrollTrigger.create({
      trigger: kicker,
      start: TRIGGER_START,
      end: TRIGGER_END,
      onUpdate: update,
    });
    update(trigger);

    triggers.push(trigger);
    restoreFns.push(() => {
      gsap.set(logo, { clearProps: "transform,opacity" });
      gsap.set(chip, { clearProps: "opacity" });
      chip.removeAttribute("data-dropped");
      if (trail) gsap.set(trail, { clearProps: "opacity,transform" });
    });
  });

  return () => {
    triggers.forEach((trigger) => trigger?.kill());
    restoreFns.forEach((restore) => restore());
  };
}

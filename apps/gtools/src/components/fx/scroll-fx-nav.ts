import type { ScrollFxContext, ScrollFxCleanup } from "./scroll-fx-context";

// Effect 6 — scroll progress beam only (fixed right-edge hairline, filled
// via scaleY against whole-document scroll). The task-17 dropdown's
// active-section nav underline was dropped in task 18's header logo-drop
// redesign: every header chip's own ghost/full-opacity state (driven by
// scroll-fx-header-drop.ts) already communicates "has this tool's section
// been reached" at a glance, so a second, separately-driven active-link
// indicator on the same chips would just be redundant motion competing for
// the same real estate.
export function registerProgressAndNav({ gsap }: ScrollFxContext): ScrollFxCleanup {
  const beam = document.querySelector<HTMLElement>('[data-fx="progress-beam"]');
  if (!beam) return () => {};

  const tween = gsap.to(beam, {
    scaleY: 1,
    ease: "none",
    scrollTrigger: {
      trigger: document.body,
      start: "top top",
      end: "bottom bottom",
      scrub: true,
    },
  });

  return () => {
    tween.scrollTrigger?.kill();
    tween.kill();
  };
}

import type { ScrollTrigger } from "gsap/ScrollTrigger";
import type { ScrollFxContext, ScrollFxCleanup } from "./scroll-fx-context";

const BACKDROP_RANGE_PX = 150;
const GHOST_BASE_RANGE_PX = 46;
const GHOST_STEP_PX = 22;
const COPY_RANGE_PX = 14;
const MOCKUP_RANGE_PX = 30;

// Effect 3 (parts 1 + 2) — backdrop depth drift tied to whole-document
// scroll, and a per-section ghost-numeral / mockup-vs-copy differential tied
// to that section's own scroll progress.
export function registerParallax({ gsap }: ScrollFxContext): ScrollFxCleanup {
  const triggers: ScrollTrigger[] = [];

  document.querySelectorAll<HTMLElement>('[data-fx="scroll-parallax-bg"]').forEach((el) => {
    const depth = Number(el.dataset.fxDepth ?? "0.15");
    const tween = gsap.to(el, {
      y: -BACKDROP_RANGE_PX * depth,
      ease: "none",
      scrollTrigger: {
        trigger: document.body,
        start: "top top",
        end: "bottom bottom",
        scrub: true,
      },
    });
    if (tween.scrollTrigger) triggers.push(tween.scrollTrigger);
  });

  document.querySelectorAll<HTMLElement>('[data-fx="ghost-numeral"]').forEach((el) => {
    const index = Number(el.dataset.fxIndex ?? "0");
    const section = el.closest<HTMLElement>('[data-fx="tool-section"]');
    if (!section) return;
    const range = GHOST_BASE_RANGE_PX + (index % 3) * GHOST_STEP_PX;
    const tween = gsap.fromTo(
      el,
      { y: -range },
      {
        y: range,
        ease: "none",
        scrollTrigger: {
          trigger: section,
          start: "top bottom",
          end: "bottom top",
          scrub: true,
        },
      },
    );
    if (tween.scrollTrigger) triggers.push(tween.scrollTrigger);
  });

  document.querySelectorAll<HTMLElement>('[data-fx="tool-section"]').forEach((section) => {
    const copy = section.querySelector<HTMLElement>('[data-fx="parallax-copy"]');
    const mockup = section.querySelector<HTMLElement>('[data-fx="parallax-mockup"]');
    if (!copy || !mockup) return;

    const tl = gsap.timeline({
      scrollTrigger: {
        trigger: section,
        start: "top bottom",
        end: "bottom top",
        scrub: true,
      },
    });
    tl.fromTo(copy, { y: -COPY_RANGE_PX }, { y: COPY_RANGE_PX, ease: "none" }, 0);
    tl.fromTo(mockup, { y: MOCKUP_RANGE_PX }, { y: -MOCKUP_RANGE_PX, ease: "none" }, 0);
    if (tl.scrollTrigger) triggers.push(tl.scrollTrigger);
  });

  return () => {
    triggers.forEach((trigger) => trigger?.kill());
  };
}

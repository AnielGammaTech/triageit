import type { ScrollFxContext, ScrollFxCleanup } from "./scroll-fx-context";

const CARD_STAGGER_S = 0.05;

// THE LOGO JOURNEY, phase 2 (task 17) — between the marquee and the suite
// grid, each card's logo pops in with a staggered scrub as the grid section
// scrolls into view, reading as the carousel "dealing" each card its logo.
// One timeline driven by the grid section's own scroll progress (not
// per-card triggers) so the stagger reads as a single continuous deal
// rather than 11 independent reveals; scrub-based, so scrolling back up
// un-deals them exactly.
export function registerGridLogoDeal({ gsap, ScrollTrigger }: ScrollFxContext): ScrollFxCleanup {
  const gridSection = document.querySelector<HTMLElement>('[data-fx="suite-grid"]');
  const logos = Array.from(document.querySelectorAll<HTMLElement>('[data-fx="grid-card-logo"]'));

  if (!gridSection || logos.length === 0) return () => {};

  const tl = gsap.timeline({
    scrollTrigger: {
      trigger: gridSection,
      start: "top 85%",
      end: "top 30%",
      scrub: 0.6,
    },
  });

  logos.forEach((logo, i) => {
    tl.fromTo(
      logo,
      { scale: 0.2, opacity: 0, rotate: -8 },
      { scale: 1, opacity: 1, rotate: 0, ease: "none" },
      i * CARD_STAGGER_S,
    );
  });

  return () => {
    tl.scrollTrigger?.kill();
    tl.kill();
    gsap.set(logos, { clearProps: "transform,opacity" });
    ScrollTrigger.refresh();
  };
}

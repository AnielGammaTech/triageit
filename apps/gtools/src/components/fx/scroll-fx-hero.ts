import type { ScrollFxContext, ScrollFxCleanup } from "./scroll-fx-context";

const CONVERGE_SCALE = 0.42;

// Effects 2 + 7 — idle 3D orbit ring (pure CSS, see fx-scroll.css) plus the
// scrub-driven convergence: as the hero scrolls out, each orbiting logo
// flies to the *actual* on-screen position of its matching suite-grid card
// (same TOOLS order both sides) and fades, handing off to the grid's own
// Reveal cards as they fade in. Deltas are measured as document-relative
// offsets (rect + scroll position) so they're correct regardless of scroll
// position at measurement time, and re-measured via `invalidateOnRefresh` on
// every resize.
export function registerHeroAssembly({ gsap, ScrollTrigger }: ScrollFxContext): ScrollFxCleanup {
  const heroSection = document.querySelector<HTMLElement>('[data-fx="hero-section"]');
  const headline = document.querySelector<HTMLElement>('[data-fx="hero-headline"]');
  const gridSection = document.querySelector<HTMLElement>('[data-fx="suite-grid"]');
  const orbitLogos = Array.from(
    document.querySelectorAll<HTMLElement>('[data-fx="orbit-logo-inner"]'),
  );
  const gridCards = Array.from(document.querySelectorAll<HTMLElement>('[data-fx="grid-card"]'));

  if (!heroSection || !headline || !gridSection || orbitLogos.length === 0) {
    return () => {};
  }

  function measureDelta(i: number) {
    const card = gridCards[i];
    const logo = orbitLogos[i];
    if (!card || !logo) return { dx: 0, dy: 0 };
    const cardRect = card.getBoundingClientRect();
    const logoRect = logo.getBoundingClientRect();
    return {
      dx:
        cardRect.left + cardRect.width / 2 - (logoRect.left + logoRect.width / 2),
      dy:
        cardRect.top + cardRect.height / 2 - (logoRect.top + logoRect.height / 2),
    };
  }

  const tl = gsap.timeline({
    scrollTrigger: {
      trigger: heroSection,
      start: "top top",
      endTrigger: gridSection,
      end: "top 35%",
      scrub: 0.6,
      invalidateOnRefresh: true,
    },
  });

  tl.to(headline, { scale: 0.92, opacity: 0.7, ease: "none" }, 0);

  orbitLogos.forEach((logo, i) => {
    tl.to(
      logo,
      {
        x: () => measureDelta(i).dx,
        y: () => measureDelta(i).dy,
        scale: CONVERGE_SCALE,
        opacity: 0,
        ease: "none",
      },
      i * 0.015,
    );
  });

  return () => {
    tl.scrollTrigger?.kill();
    tl.kill();
    gsap.set(orbitLogos, { clearProps: "transform,opacity" });
    gsap.set(headline, { clearProps: "transform,opacity" });
    ScrollTrigger.refresh();
  };
}

import type { ScrollFxContext, ScrollFxCleanup } from "./scroll-fx-context";

const CONVERGE_SCALE = 0.5;
const LOGO_STAGGER_S = 0.03;

// THE LOGO JOURNEY, phase 1 (task 17) — idle 3D orbit ring (pure CSS, see
// fx-journey.css) plus the scrub-driven convergence: as the hero scrolls
// out, each orbiting logo drops straight down (x untouched) to the marquee
// band's vertical center and fades, staggered per logo so they read as
// "landing" in the circling banner one after another rather than all at
// once. The marquee loops infinitely (no fixed x target makes sense — it's
// always full-width), so only the vertical descent + fade + stagger sell
// the "joining the carousel" handoff; the marquee's own base loop is never
// touched here (see scroll-fx-marquee.ts for its separate velocity boost).
// Deltas are measured as document-relative offsets (rect + scroll position)
// so they're correct regardless of scroll position at measurement time, and
// re-measured via `invalidateOnRefresh` on every resize.
export function registerHeroAssembly({ gsap, ScrollTrigger }: ScrollFxContext): ScrollFxCleanup {
  const heroSection = document.querySelector<HTMLElement>('[data-fx="hero-section"]');
  const headline = document.querySelector<HTMLElement>('[data-fx="hero-headline"]');
  const marquee = document.querySelector<HTMLElement>('[data-fx="marquee"]');
  const orbitLogos = Array.from(
    document.querySelectorAll<HTMLElement>('[data-fx="orbit-logo-inner"]'),
  );

  if (!heroSection || !headline || !marquee || orbitLogos.length === 0) {
    return () => {};
  }

  function measureDrop(logo: HTMLElement) {
    const marqueeRect = marquee!.getBoundingClientRect();
    const logoRect = logo.getBoundingClientRect();
    return marqueeRect.top + marqueeRect.height / 2 - (logoRect.top + logoRect.height / 2);
  }

  const tl = gsap.timeline({
    scrollTrigger: {
      trigger: heroSection,
      start: "top top",
      endTrigger: marquee,
      end: "center center",
      scrub: 0.6,
      invalidateOnRefresh: true,
    },
  });

  tl.to(headline, { scale: 0.92, opacity: 0.7, ease: "none" }, 0);

  orbitLogos.forEach((logo, i) => {
    tl.to(
      logo,
      {
        y: () => measureDrop(logo),
        scale: CONVERGE_SCALE,
        opacity: 0,
        ease: "none",
      },
      i * LOGO_STAGGER_S,
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

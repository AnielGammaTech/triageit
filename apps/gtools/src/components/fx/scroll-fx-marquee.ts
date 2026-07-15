import type { ScrollFxContext, ScrollFxCleanup } from "./scroll-fx-context";

const MAX_BOOST_PX = 46;
const VELOCITY_TO_PX = 0.9;

// Effect 3 (part 3) — marquee velocity boost. The base CSS loop (fx.css)
// keeps running unconditionally forever; this only ever adds a small extra
// *forward* (same-direction) nudge on the wrapper GSAP owns
// (`[data-fx="marquee-boost"]`, a distinct element from the animated
// track — see marquee.tsx), sized from |lenis.velocity| and clamped, so the
// loop itself can never stutter or visibly reverse regardless of scroll
// direction or speed.
export function registerMarqueeBoost({ gsap, lenis }: ScrollFxContext): ScrollFxCleanup {
  const boosts = Array.from(document.querySelectorAll<HTMLElement>('[data-fx="marquee-boost"]'));
  if (boosts.length === 0) return () => {};

  const setters = boosts.map((el) => gsap.quickTo(el, "x", { duration: 0.5, ease: "power2.out" }));

  const handleScroll = (instance: { velocity: number }) => {
    const boost = -Math.min(Math.abs(instance.velocity) * VELOCITY_TO_PX, MAX_BOOST_PX);
    setters.forEach((setX) => setX(boost));
  };

  const unsubscribe = lenis.on("scroll", handleScroll);

  return () => {
    unsubscribe();
    gsap.set(boosts, { clearProps: "transform" });
  };
}

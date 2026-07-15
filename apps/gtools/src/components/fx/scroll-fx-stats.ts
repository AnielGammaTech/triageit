import type { ScrollFxContext, ScrollFxCleanup } from "./scroll-fx-context";

const COUNT_DURATION_S = 1.1;

// Effect 10 — count-up stats strip. The server-rendered number
// (stats-strip.tsx) is already the real, final value; this only replays it
// counting up from 0 once the strip enters view, so no-JS/reduced-motion
// visitors simply read the correct static number from the first paint.
export function registerStatsCountUp({ gsap, ScrollTrigger }: ScrollFxContext): ScrollFxCleanup {
  const triggers: Array<ReturnType<typeof ScrollTrigger.create>> = [];

  document.querySelectorAll<HTMLElement>('[data-fx="stat"]').forEach((el) => {
    const target = Number(el.dataset.fxValue ?? "0");
    if (!Number.isFinite(target)) return;

    triggers.push(
      ScrollTrigger.create({
        trigger: el,
        start: "top 92%",
        once: true,
        onEnter: () => {
          const state = { value: 0 };
          el.textContent = "0";
          gsap.to(state, {
            value: target,
            duration: COUNT_DURATION_S,
            ease: "power2.out",
            snap: { value: 1 },
            onUpdate: () => {
              el.textContent = String(Math.round(state.value));
            },
          });
        },
      }),
    );
  });

  return () => {
    triggers.forEach((trigger) => trigger?.kill());
  };
}

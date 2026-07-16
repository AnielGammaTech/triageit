import type { ScrollFxContext, ScrollFxCleanup } from "./scroll-fx-context";

const TYPE_DURATION_S = 1.3;
const START_DELAY_S = 0.4;

// Effect 11 — terminal boot line. Types the already-server-rendered text out
// once on mount (not scroll-triggered — it plays immediately once the
// feature gate passes, same as the v1 hero-entrance mount animations).
export function registerBootLine({ gsap }: ScrollFxContext): ScrollFxCleanup {
  const el = document.querySelector<HTMLElement>('[data-fx="boot-line"]');
  if (!el) return () => {};

  const finalText = el.textContent ?? "";
  if (!finalText) return () => {};

  el.textContent = "";
  const state = { progress: 0 };
  const tween = gsap.to(state, {
    progress: 1,
    duration: TYPE_DURATION_S,
    delay: START_DELAY_S,
    ease: "none",
    onUpdate: () => {
      const count = Math.round(state.progress * finalText.length);
      el.textContent = finalText.slice(0, count);
    },
  });

  return () => {
    tween.kill();
    el.textContent = finalText;
  };
}

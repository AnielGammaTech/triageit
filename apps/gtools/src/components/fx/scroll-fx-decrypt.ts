import type { ScrollFxContext, ScrollFxCleanup } from "./scroll-fx-context";

const GLYPHS = "!<>-_\\/[]{}—=+*^?#$%";
const SCRAMBLE_DURATION_S = 0.9;

function scramble(el: HTMLElement, finalText: string, gsap: ScrollFxContext["gsap"]) {
  el.setAttribute("data-fx-scrambling", "true");
  const state = { progress: 0 };
  gsap.to(state, {
    progress: 1,
    duration: SCRAMBLE_DURATION_S,
    ease: "power1.out",
    onUpdate() {
      const revealCount = Math.floor(state.progress * finalText.length);
      let out = "";
      for (let i = 0; i < finalText.length; i += 1) {
        const char = finalText[i];
        out += char === " " || i < revealCount ? char : GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
      }
      el.textContent = out;
    },
    onComplete() {
      el.textContent = finalText;
      el.removeAttribute("data-fx-scrambling");
    },
  });
}

// Effect 9 — decrypt kickers. Server HTML already carries the real tool
// name (tool-section.tsx); this reads that as the source of truth, then
// resolves it from scrambled glyphs to real text once as the section enters
// (`once: true`, so scrolling back up/down again never re-triggers it).
export function registerDecryptKickers({ gsap, ScrollTrigger }: ScrollFxContext): ScrollFxCleanup {
  const triggers: Array<ReturnType<typeof ScrollTrigger.create>> = [];

  document.querySelectorAll<HTMLElement>('[data-fx="decrypt-kicker"]').forEach((el) => {
    const finalText = el.textContent ?? "";
    if (!finalText) return;

    triggers.push(
      ScrollTrigger.create({
        trigger: el,
        start: "top 90%",
        once: true,
        onEnter: () => scramble(el, finalText, gsap),
      }),
    );
  });

  return () => {
    triggers.forEach((trigger) => trigger?.kill());
  };
}

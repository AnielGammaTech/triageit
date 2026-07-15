import { subscribePointer } from "./pointer";
import type { ScrollFxContext, ScrollFxCleanup } from "./scroll-fx-context";

const MAX_SHIFT_PX = 26;

// Effect 5 — background layers (backdrop grid + orbs, see backdrop.tsx's
// `[data-fx="cursor-depth"]` wrappers) shift a few px toward the cursor,
// composing alongside the existing spotlight glow (fx/spotlight.tsx) which
// already reads the same shared pointer store. Each layer's own
// `data-fx-depth` scales how far it travels, so the grid (farther/subtler)
// and the orbs (nearer/stronger) read as genuinely different depths rather
// than moving in lockstep.
export function registerCursorDepth({ gsap }: ScrollFxContext): ScrollFxCleanup {
  const layers = Array.from(document.querySelectorAll<HTMLElement>('[data-fx="cursor-depth"]'));
  if (layers.length === 0) return () => {};

  const setters = layers.map((el) => ({
    depth: Number(el.dataset.fxDepth ?? "0.5"),
    setX: gsap.quickTo(el, "x", { duration: 0.9, ease: "power3.out" }),
    setY: gsap.quickTo(el, "y", { duration: 0.9, ease: "power3.out" }),
  }));

  const unsubscribe = subscribePointer((x, y) => {
    const nx = (x / window.innerWidth - 0.5) * 2; // -1 (left) .. 1 (right)
    const ny = (y / window.innerHeight - 0.5) * 2; // -1 (top) .. 1 (bottom)
    setters.forEach(({ depth, setX, setY }) => {
      setX(nx * MAX_SHIFT_PX * depth);
      setY(ny * MAX_SHIFT_PX * depth);
    });
  });

  return () => {
    unsubscribe();
    gsap.set(layers, { clearProps: "transform" });
  };
}

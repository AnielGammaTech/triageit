import type Lenis from "lenis";

// Shared handle to the single live Lenis instance that fx/scroll-fx.tsx
// mounts — same "one module-scoped value, many independent readers"
// pattern as pointer.ts's shared pointer store. Lets components mounted
// outside the orchestrator's own tree (the back-to-top button, so far)
// smooth-scroll through Lenis too, instead of duplicating "is the scroll
// feature gate even active right now?" logic in every consumer. `null`
// whenever the gate hasn't passed (touch/reduced-motion/no-JS) or Lenis
// hasn't mounted (or has already unmounted) — callers should always treat
// `null` as "fall back to native `window.scrollTo`".
let activeLenis: Lenis | null = null;

export function setActiveLenis(instance: Lenis | null): void {
  activeLenis = instance;
}

export function getActiveLenis(): Lenis | null {
  return activeLenis;
}

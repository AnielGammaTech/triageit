import type { gsap } from "gsap";
import type { ScrollTrigger } from "gsap/ScrollTrigger";
import type Lenis from "lenis";

// Shared handle every scroll-fx-*.ts registrar receives from the
// orchestrator (scroll-fx.tsx) — one already-registered GSAP instance, the
// ScrollTrigger plugin, and the live Lenis instance driving the single rAF
// loop. Registrars assume the feature gate has already passed; they just
// wire DOM queries + ScrollTriggers and hand back a cleanup function.
export interface ScrollFxContext {
  gsap: typeof gsap;
  ScrollTrigger: typeof ScrollTrigger;
  lenis: Lenis;
}

export type ScrollFxCleanup = () => void;

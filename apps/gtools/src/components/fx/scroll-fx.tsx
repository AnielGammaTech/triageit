"use client";

import { useEffect, useState } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";
import { prefersFinePointer, prefersReducedMotion } from "./pointer";
import type { ScrollFxCleanup, ScrollFxContext } from "./scroll-fx-context";
import { registerHeroAssembly } from "./scroll-fx-hero";
import { registerGridLogoDeal } from "./scroll-fx-grid";
import { registerSectionLogoGlide } from "./scroll-fx-section-logo";
import { registerParallax } from "./scroll-fx-parallax";
import { registerMarqueeBoost } from "./scroll-fx-marquee";
import { registerCursorDepth } from "./scroll-fx-cursor-depth";
import { registerConnectItDiagram } from "./scroll-fx-diagram";
import { registerProgressAndNav } from "./scroll-fx-nav";
import { registerDecryptKickers } from "./scroll-fx-decrypt";
import { registerStatsCountUp } from "./scroll-fx-stats";
import { registerBootLine } from "./scroll-fx-boot";
import { setActiveLenis } from "./scroll-fx-lenis-ref";

// Motion v3 orchestrator — the one place that mounts Lenis + GSAP
// ScrollTrigger and registers every scroll-driven effect (11-effect spec:
// 2026-07-15-gtools-motion-v3-scroll.md, plus THE LOGO JOURNEY's 3-phase
// hero->marquee->grid->section choreography from task 17, split across
// scroll-fx-hero/grid/section-logo.ts). Two-phase mount, same pattern as
// Spotlight/ReticleCursor: phase 1 just resolves the feature gate (fine
// pointer + `prefers-reduced-motion: no-preference`); phase 2 — gated on
// that result, so it only ever runs once this component's own DOM (the
// progress beam below) has actually committed — does the real work and
// queries every other server component's `data-fx="..."` markup. If the
// gate fails, or GSAP/Lenis throw on init, this renders nothing and touches
// nothing: v1/v2's Reveal-based motion is the fallback and is never modified.
export function ScrollFx() {
  const [gateOk, setGateOk] = useState(false);

  useEffect(() => {
    setGateOk(prefersFinePointer() && !prefersReducedMotion());
  }, []);

  useEffect(() => {
    if (!gateOk) return;

    let lenis: Lenis | undefined;
    let tick: ((time: number) => void) | undefined;
    let cleanups: ScrollFxCleanup[] = [];
    let previousScrollBehavior = "";

    try {
      gsap.registerPlugin(ScrollTrigger);

      lenis = new Lenis({ anchors: true });
      tick = (time: number) => lenis?.raf(time * 1000);
      setActiveLenis(lenis);

      lenis.on("scroll", ScrollTrigger.update);
      gsap.ticker.add(tick);
      gsap.ticker.lagSmoothing(0);

      // Lenis re-implements smoothness itself via per-frame *instant* native
      // scrollTo calls; the page's `scroll-behavior: smooth` (globals.css —
      // a v1/fallback nicety for native anchor jumps) would otherwise race
      // it on every hash-link click, so it's suspended while Lenis is live.
      previousScrollBehavior = document.documentElement.style.scrollBehavior;
      document.documentElement.style.scrollBehavior = "auto";

      const ctx: ScrollFxContext = { gsap, ScrollTrigger, lenis };
      cleanups = [
        registerHeroAssembly(ctx),
        registerGridLogoDeal(ctx),
        registerSectionLogoGlide(ctx),
        registerParallax(ctx),
        registerMarqueeBoost(ctx),
        registerCursorDepth(ctx),
        registerConnectItDiagram(ctx),
        registerProgressAndNav(ctx),
        registerDecryptKickers(ctx),
        registerStatsCountUp(ctx),
        registerBootLine(ctx),
      ];

      document.documentElement.dataset.fxScroll = "active";
      ScrollTrigger.refresh();
    } catch (error) {
      // Genuinely unexpected (e.g. a corrupted install) — surface it once
      // for developers, but never break the page: cleanup below still runs
      // and the v1 fallback is untouched either way.
      console.error("scroll-fx: init failed, falling back to v1 motion", error);
    }

    return () => {
      cleanups.forEach((cleanup) => cleanup());
      ScrollTrigger.killAll();
      if (tick) gsap.ticker.remove(tick);
      setActiveLenis(null);
      lenis?.destroy();
      document.documentElement.style.scrollBehavior = previousScrollBehavior;
      delete document.documentElement.dataset.fxScroll;
    };
  }, [gateOk]);

  if (!gateOk) return null;

  // The progress beam is the only piece of markup this orchestrator itself
  // owns (same pattern as Spotlight/ReticleCursor rendering their own fixed
  // layer) — every other effect animates markup that already lives in its
  // owning server component.
  return (
    <div aria-hidden data-fx="progress-beam" className="fx-progress-beam pointer-events-none" />
  );
}

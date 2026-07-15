"use client";

import { useEffect, useState } from "react";
import { getActiveLenis } from "./scroll-fx-lenis-ref";

// How far down the page (in viewport heights) before the button appears —
// "after scrolling ~1 viewport" per spec.
const SHOW_AFTER_VIEWPORTS = 1;

// Floating circular button, always rendered (functional, so it stays
// available under reduced motion too — only its fade/scale *entrance* is
// gated behind `prefers-reduced-motion: no-preference`, in fx-interactive
// .css). A plain scroll listener drives visibility, same lightweight
// pattern nav.tsx already uses for its own `data-scrolled` toggle, rather
// than pulling in a ScrollTrigger for something this simple that also has
// to work when the whole scroll-fx feature gate is off.
export function BackToTop() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => {
      setVisible(window.scrollY > window.innerHeight * SHOW_AFTER_VIEWPORTS);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const handleClick = () => {
    // Lenis (when the motion feature gate passed and it's actually
    // mounted) re-implements scrolling itself, so a native `scrollTo`
    // alongside it would fight/desync its internal position tracking —
    // route through it when live, and only fall back to native scrolling
    // when it's not (touch, reduced motion, or a hypothetical Lenis init
    // failure). Reduced-motion visitors never have a live Lenis instance
    // (the whole feature gate is off for them), so they always land on
    // the native branch — which itself checks the same media query and
    // asks for an instant jump instead of a smooth one, per spec ("scrolls
    // instantly under reduced motion").
    const lenis = getActiveLenis();
    if (lenis) {
      lenis.scrollTo(0);
      return;
    }
    // `behavior: "auto"` is *not* "instant" — per spec it defers to the
    // page's own `scroll-behavior` CSS (globals.css sets `html { scroll-
    // behavior: smooth }` unconditionally, and nothing suspends it here
    // since Lenis never mounted for this visitor), so it would have quietly
    // animated anyway. `"instant"` is the only value that actually
    // guarantees the immediate jump reduced-motion visitors are promised.
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: reduced ? "instant" : "smooth" });
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label="Back to top"
      data-visible={visible ? "true" : undefined}
      className="fx-back-to-top fixed right-5 bottom-6 z-[70] flex size-11 items-center justify-center rounded-full border border-line bg-panel-2/90 text-fog backdrop-blur-md transition-colors hover:border-white/20 hover:text-snow focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
    >
      <svg aria-hidden width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path
          d="M8 13V3M8 3L3.5 7.5M8 3l4.5 4.5"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}

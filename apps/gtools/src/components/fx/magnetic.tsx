"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { prefersFinePointer, prefersReducedMotion, subscribePointer } from "./pointer";

const RADIUS = 90; // px — proximity reach before pull kicks in
const STRENGTH = 10; // px — max displacement at dead center

/**
 * Magnetic-pull hook: attach the returned ref to a button/card and it
 * translates a few clamped px toward the cursor whenever the pointer comes
 * within `RADIUS`, easing back to rest once it leaves. A hook (not a
 * cloneElement wrapper like `Reveal`) so callers can attach it to the same
 * DOM node another wrapper already manages — e.g. a suite-grid card that's
 * also wrapped in `<Reveal innerRef={...}>` for its scroll-reveal.
 *
 * Uses the shared pointer store (pointer.ts) rather than its own listener,
 * so N magnetic targets on a page still cost exactly one global
 * `pointermove` listener between them.
 */
export function useMagnetic<T extends HTMLElement>(): RefObject<T | null> {
  const ref = useRef<T | null>(null);
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    setEnabled(prefersFinePointer() && !prefersReducedMotion());
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const node = ref.current;
    if (!node) return;
    node.classList.add("fx-magnetic");
    let active = false;

    const unsubscribe = subscribePointer((x, y) => {
      const rect = node.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.hypot(dx, dy);

      if (dist < RADIUS) {
        const pull = (1 - dist / RADIUS) * STRENGTH;
        const angle = Math.atan2(dy, dx);
        node.style.setProperty("--magnet-x", `${(Math.cos(angle) * pull).toFixed(1)}px`);
        node.style.setProperty("--magnet-y", `${(Math.sin(angle) * pull).toFixed(1)}px`);
        if (!active) {
          active = true;
          node.setAttribute("data-magnet-active", "true");
        }
      } else if (active) {
        active = false;
        node.removeAttribute("data-magnet-active");
        node.style.setProperty("--magnet-x", "0px");
        node.style.setProperty("--magnet-y", "0px");
      }
    });

    return () => {
      unsubscribe();
      node.classList.remove("fx-magnetic");
      node.removeAttribute("data-magnet-active");
      node.style.removeProperty("--magnet-x");
      node.style.removeProperty("--magnet-y");
    };
  }, [enabled]);

  return ref;
}

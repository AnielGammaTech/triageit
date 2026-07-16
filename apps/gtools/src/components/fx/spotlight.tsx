"use client";

import { useEffect, useRef, useState } from "react";
import { prefersFinePointer, prefersReducedMotion, subscribePointer } from "./pointer";

// Fixed, full-viewport layer: a soft radial glow follows the cursor and a
// brighter copy of the page's grid texture is revealed through a radial mask
// around it. SSR renders nothing — `enabled` starts false and is only ever
// flipped true client-side after checking `(pointer: fine)` and reduced
// motion, so hydration always matches (nothing → nothing on the first
// client render, same as the server's). Position updates are written
// directly to CSS custom properties via a ref on every rAF-batched pointer
// flush (see pointer.ts) instead of React state, so a moving mouse never
// triggers a re-render of this — or any other — component.
export function Spotlight() {
  const [enabled, setEnabled] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setEnabled(prefersFinePointer() && !prefersReducedMotion());
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const root = rootRef.current;
    if (!root) return;

    const unsubscribe = subscribePointer((x, y) => {
      root.style.setProperty("--mx", `${x}px`);
      root.style.setProperty("--my", `${y}px`);
      if (root.dataset.active !== "true") root.dataset.active = "true";
    });

    return unsubscribe;
  }, [enabled]);

  if (!enabled) return null;

  return (
    <div
      ref={rootRef}
      aria-hidden
      className="fx-spotlight pointer-events-none fixed inset-0 -z-40 overflow-hidden"
    >
      <div className="fx-spotlight-glow" />
      <div className="fx-spotlight-grid" />
    </div>
  );
}

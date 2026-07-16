"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { prefersFinePointer, prefersReducedMotion } from "./pointer";

const MAX_TILT_DEG = 6;

// Wraps a BrowserFrame (or any block) with cursor-tracked 3D tilt + a glare
// highlight. Pointer tracking here is local (React's own onPointerMove on
// this wrapper), not the shared global store in pointer.ts — it only needs
// to know the cursor position while it's actually over this element, so a
// scoped listener is both simpler and cheaper than subscribing globally.
//
// Rotation/glare position are written as CSS custom properties consumed by
// `.fx-frame-tilt` (rotateX/rotateY) and `.fx-glare` (radial-gradient
// position) in fx-diagram.css / fx-interactive.css — BrowserFrame's own
// markup is untouched beyond the glare overlay node itself. Always renders
// the same wrapper div regardless of `enabled` so server and first-client
// render match exactly (no hydration mismatch); tilt just never activates.
export function Tilt({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    setEnabled(prefersFinePointer() && !prefersReducedMotion());
  }, []);

  useEffect(() => () => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
  }, []);

  const handleMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!enabled) return;
      const node = ref.current;
      if (!node) return;
      const rect = node.getBoundingClientRect();
      const px = (event.clientX - rect.left) / rect.width;
      const py = (event.clientY - rect.top) / rect.height;

      if (rafRef.current !== null) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        const rotateY = (px - 0.5) * 2 * MAX_TILT_DEG;
        const rotateX = (0.5 - py) * 2 * MAX_TILT_DEG;
        node.style.setProperty("--tilt-x", `${rotateX.toFixed(2)}deg`);
        node.style.setProperty("--tilt-y", `${rotateY.toFixed(2)}deg`);
        node.style.setProperty("--glare-x", `${(px * 100).toFixed(1)}%`);
        node.style.setProperty("--glare-y", `${(py * 100).toFixed(1)}%`);
      });
    },
    [enabled],
  );

  const handleEnter = useCallback(() => {
    if (!enabled) return;
    ref.current?.setAttribute("data-tilt-active", "true");
  }, [enabled]);

  const handleLeave = useCallback(() => {
    const node = ref.current;
    if (!node) return;
    node.removeAttribute("data-tilt-active");
    node.style.setProperty("--tilt-x", "0deg");
    node.style.setProperty("--tilt-y", "0deg");
  }, []);

  return (
    <div
      ref={ref}
      className={enabled ? "fx-tilt" : undefined}
      onPointerMove={handleMove}
      onPointerEnter={handleEnter}
      onPointerLeave={handleLeave}
    >
      {children}
    </div>
  );
}

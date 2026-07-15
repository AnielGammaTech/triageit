"use client";

import { useEffect, useRef, useState } from "react";
import { prefersFinePointer, prefersReducedMotion, subscribePointer } from "./pointer";

const LERP_FACTOR = 0.22;

interface CursorState {
  targetX: number;
  targetY: number;
  x: number;
  y: number;
  hasPosition: boolean;
  rafId: number;
}

// Sci-fi reticle that replaces the native cursor on fine pointers: lerped
// follow (never snaps 1:1 to the raw pointer), expands + shifts tone over
// interactive elements. The spark-particle trail this used to throw on fast
// movement is gone — replaced by the canvas-based smoke trail
// (smoke-trail.tsx), mounted as its own sibling layer (page.tsx) so this
// component can stay focused on just the reticle. The native cursor is
// hidden by toggling one class on <html> (`.fx-cursor-active`, in
// fx-interactive.css) — pure CSS, and always removed in this effect's
// cleanup so a fast pointer-type change or an unmount never leaves the user
// without a cursor.
export function ReticleCursor() {
  const [enabled, setEnabled] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<CursorState>({
    targetX: 0,
    targetY: 0,
    x: 0,
    y: 0,
    hasPosition: false,
    rafId: 0,
  });

  useEffect(() => {
    setEnabled(prefersFinePointer() && !prefersReducedMotion());
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const root = rootRef.current;
    if (!root) return;
    const state = stateRef.current;

    document.documentElement.classList.add("fx-cursor-active");

    const unsubscribePointer = subscribePointer((x, y) => {
      state.targetX = x;
      state.targetY = y;
      state.hasPosition = true;
    });

    const handlePointerOver = (event: PointerEvent) => {
      const target = event.target as Element | null;
      const isInteractive = Boolean(target?.closest("a[href], button"));
      if (isInteractive) root.setAttribute("data-hover", "true");
      else root.removeAttribute("data-hover");
    };
    document.addEventListener("pointerover", handlePointerOver, { passive: true });

    function tick() {
      const s = stateRef.current;
      if (s.hasPosition) {
        s.x += (s.targetX - s.x) * LERP_FACTOR;
        s.y += (s.targetY - s.y) * LERP_FACTOR;

        if (root) {
          root.style.setProperty("--cursor-x", `${s.x.toFixed(1)}px`);
          root.style.setProperty("--cursor-y", `${s.y.toFixed(1)}px`);
          if (root.dataset.visible !== "true") root.dataset.visible = "true";
        }
      }
      s.rafId = requestAnimationFrame(tick);
    }

    state.rafId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(state.rafId);
      unsubscribePointer();
      document.removeEventListener("pointerover", handlePointerOver);
      document.documentElement.classList.remove("fx-cursor-active");
    };
  }, [enabled]);

  if (!enabled) return null;

  return (
    <div
      ref={rootRef}
      aria-hidden
      className="fx-cursor pointer-events-none fixed inset-0 z-[999]"
    >
      <div className="fx-cursor-reticle" />
    </div>
  );
}

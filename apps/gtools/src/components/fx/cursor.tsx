"use client";

import { useEffect, useRef, useState } from "react";
import { accentVar } from "@/components/browser-frame";
import { TOOLS } from "@/content/tools";
import { prefersFinePointer, prefersReducedMotion, subscribePointer } from "./pointer";

const PARTICLE_POOL_SIZE = 24;
const LERP_FACTOR = 0.22;
const SPARK_SPEED_THRESHOLD = 38; // px moved between frames before a spark fires
const SPARK_MIN_INTERVAL_MS = 45; // floor between spawns so fast swipes don't drain the pool in one frame

const SPARK_COLORS = TOOLS.map((tool) => accentVar(tool.accent));

interface CursorState {
  targetX: number;
  targetY: number;
  x: number;
  y: number;
  lastX: number;
  lastY: number;
  hasPosition: boolean;
  poolIndex: number;
  lastSparkAt: number;
  rafId: number;
}

// Sci-fi reticle that replaces the native cursor on fine pointers: lerped
// follow (never snaps 1:1 to the raw pointer), expands + shifts tone over
// interactive elements, and throws a handful of recycled spark particles on
// fast movement. The native cursor is hidden by toggling one class on
// <html> (`.fx-cursor-active`, in fx-interactive.css) — pure CSS, and always
// removed in this effect's cleanup so a fast pointer-type change or an
// unmount never leaves the user without a cursor.
export function ReticleCursor() {
  const [enabled, setEnabled] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const particlesRef = useRef<Array<HTMLSpanElement | null>>([]);
  const stateRef = useRef<CursorState>({
    targetX: 0,
    targetY: 0,
    x: 0,
    y: 0,
    lastX: 0,
    lastY: 0,
    hasPosition: false,
    poolIndex: 0,
    lastSparkAt: 0,
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

    const spawnSpark = (x: number, y: number, dx: number, dy: number) => {
      const pool = particlesRef.current;
      if (pool.length === 0) return;
      const node = pool[state.poolIndex % pool.length];
      state.poolIndex += 1;
      if (!node) return;

      const angle = Math.atan2(dy, dx) + (Math.random() - 0.5) * 0.7;
      const dist = 16 + Math.random() * 22;
      node.style.background = SPARK_COLORS[state.poolIndex % SPARK_COLORS.length];
      node.getAnimations().forEach((anim) => anim.cancel());
      node.animate(
        [
          { transform: `translate3d(${x}px, ${y}px, 0) scale(1)`, opacity: 0.9 },
          {
            transform: `translate3d(${x + Math.cos(angle) * dist}px, ${y + Math.sin(angle) * dist}px, 0) scale(0.2)`,
            opacity: 0,
          },
        ],
        { duration: 480, easing: "cubic-bezier(0.16, 1, 0.3, 1)", fill: "forwards" },
      );
    };

    function tick(now: number) {
      const s = stateRef.current;
      if (s.hasPosition) {
        s.x += (s.targetX - s.x) * LERP_FACTOR;
        s.y += (s.targetY - s.y) * LERP_FACTOR;

        if (root) {
          root.style.setProperty("--cursor-x", `${s.x.toFixed(1)}px`);
          root.style.setProperty("--cursor-y", `${s.y.toFixed(1)}px`);
          if (root.dataset.visible !== "true") root.dataset.visible = "true";
        }

        const dx = s.targetX - s.lastX;
        const dy = s.targetY - s.lastY;
        const speed = Math.hypot(dx, dy);
        if (speed > SPARK_SPEED_THRESHOLD && now - s.lastSparkAt > SPARK_MIN_INTERVAL_MS) {
          s.lastSparkAt = now;
          spawnSpark(s.x, s.y, dx, dy);
        }
        s.lastX = s.targetX;
        s.lastY = s.targetY;
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
      {Array.from({ length: PARTICLE_POOL_SIZE }).map((_, i) => (
        <span
          key={i}
          ref={(node) => {
            particlesRef.current[i] = node;
          }}
          className="fx-cursor-spark"
        />
      ))}
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { prefersFinePointer, prefersReducedMotion, subscribePointer } from "./pointer";
import { buildSmokeSprites } from "./smoke-sprites";
import { createSmokeEngine } from "./smoke-particles";

const MAX_EMIT_PER_TICK = 4;
const EMIT_SPACING_PX = 14;
const MIN_EMIT_DIST_PX = 1.5; // skip movement-emission on sub-pixel jitter from a near-stationary cursor
const MAX_FRAME_DELTA_MS = 48; // clamps the physics step after a tab-switch/idle gap
const IDLE_SMOKE_INTERVAL_MS = 140; // gentle baseline plume cadence while the pointer sits still
const IDLE_RIPPLE_INTERVAL_MS = 850; // rhythm for the ambient water-ripple rings
const IDLE_RIPPLE_STRENGTH = 0.4; // softer than a click ring, layers under the smoke
const IDLE_RIPPLE_LIFE_MS = 1700;
const IDLE_RIPPLE_RADIUS_PX = 34;

// Fluid smoke/water cursor trail — a fixed full-viewport canvas (own layer,
// separate from the reticle in cursor.tsx) that emits soft, additively
// blended plumes continuously at the cursor position — a gentle idle plume
// plus a rhythmic ambient ripple ring keep the layer alive even while the
// pointer sits still, both tinted toward whichever tool section is nearest
// the viewport center (brand indigo default elsewhere). Movement adds a
// denser trail on top of the idle plume (naturally reading as "stronger
// with velocity" since it stacks additional spawns rather than needing its
// own separate curve), and a click still fires a markedly stronger ripple
// than the ambient rhythm. Particle simulation lives in smoke-particles.ts
// (a fixed-size mutable pool, not reallocated per frame); sprite
// pre-rendering lives in smoke-sprites.ts. This component only owns: the
// canvas element + DPR-aware sizing, translating pointer/click events into
// engine calls, the idle-cadence timers, the section-accent tracker, and
// the rAF loop itself — which now runs continuously for as long as the
// pointer is known to be on the page, and only stops once the pointer has
// left the browser viewport (or the tab is hidden) *and* every live
// particle/ripple has finished fading, so the trail always exits
// gracefully instead of snapping off. Fine-pointer + no-reduced-motion
// gated, same contract as the reticle; fully torn down on unmount.
export function SmokeTrail() {
  const [enabled, setEnabled] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    setEnabled(prefersFinePointer() && !prefersReducedMotion());
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const sprites = buildSmokeSprites();
    const engine = createSmokeEngine();

    function resize() {
      const dpr = Math.max(1, window.devicePixelRatio || 1);
      canvas!.width = window.innerWidth * dpr;
      canvas!.height = window.innerHeight * dpr;
      canvas!.style.width = `${window.innerWidth}px`;
      canvas!.style.height = `${window.innerHeight}px`;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    window.addEventListener("resize", resize);

    // Which tool section is nearest the viewport center right now — smoke
    // tints toward that section's accent; falls back to brand indigo
    // whenever no section occupies the tracked center band (hero, footer,
    // gaps between sections).
    let currentSprite = sprites.brand;
    let currentStroke = sprites.brandStroke;
    const sections = Array.from(
      document.querySelectorAll<HTMLElement>('[data-fx="tool-section"]'),
    );
    const sectionObserver = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting);
        if (visible.length === 0) return;
        const top = visible.reduce((best, entry) =>
          entry.intersectionRatio > best.intersectionRatio ? entry : best,
        );
        const slug = (top.target as HTMLElement).dataset.fxSlug;
        currentSprite = (slug && sprites.bySlug.get(slug)) || sprites.brand;
        currentStroke = (slug && sprites.strokeBySlug.get(slug)) || sprites.brandStroke;
      },
      { rootMargin: "-45% 0px -45% 0px", threshold: [0, 0.25, 0.5, 0.75, 1] },
    );
    sections.forEach((section) => sectionObserver.observe(section));

    let lastX = window.innerWidth / 2;
    let lastY = window.innerHeight / 2;
    let hasPosition = false; // don't spawn the idle plume/ripple at a guessed center before the first real pointer position
    let pointerOnPage = !document.hidden;
    let lastFrameAt = performance.now();
    let lastIdleSmokeAt = performance.now();
    let lastIdleRippleAt = performance.now();
    let running = false;
    let rafId = 0;

    function emit(x: number, y: number, vx: number, vy: number) {
      const dist = Math.hypot(x - lastX, y - lastY);
      const count = Math.min(MAX_EMIT_PER_TICK, Math.floor(dist / EMIT_SPACING_PX));
      for (let i = 0; i < count; i += 1) {
        const t = (i + 1) / (count + 1);
        engine.spawnSmoke(lastX + (x - lastX) * t, lastY + (y - lastY) * t, vx, vy, currentSprite);
      }
    }

    function loop(now: number) {
      // Clamped to >= 0: a rAF callback's own timestamp isn't guaranteed to
      // be >= a `performance.now()` captured synchronously moments earlier
      // (e.g. right when `ensureLoop`/`handleVisibility` stamped
      // `lastFrameAt`), so `now - lastFrameAt` can occasionally go slightly
      // negative. Feeding a negative `dt` into the engine would age a
      // freshly spawned ripple backwards into negative progress, and
      // `ctx.arc()` throws outright on a negative radius.
      const dt = Math.max(0, Math.min(MAX_FRAME_DELTA_MS, now - lastFrameAt));
      lastFrameAt = now;

      if (hasPosition && pointerOnPage) {
        if (now - lastIdleSmokeAt >= IDLE_SMOKE_INTERVAL_MS) {
          lastIdleSmokeAt = now;
          engine.spawnSmoke(lastX, lastY, 0, 0, currentSprite);
        }
        if (now - lastIdleRippleAt >= IDLE_RIPPLE_INTERVAL_MS) {
          lastIdleRippleAt = now;
          engine.spawnRipple(
            lastX,
            lastY,
            currentStroke,
            IDLE_RIPPLE_STRENGTH,
            IDLE_RIPPLE_LIFE_MS,
            IDLE_RIPPLE_RADIUS_PX,
          );
        }
      }

      engine.update(dt);
      ctx!.clearRect(0, 0, canvas!.width, canvas!.height);
      engine.draw(ctx!);

      if (!pointerOnPage && !engine.hasActive()) {
        running = false;
        return;
      }
      rafId = requestAnimationFrame(loop);
    }

    function ensureLoop() {
      if (running) return;
      running = true;
      lastFrameAt = performance.now();
      rafId = requestAnimationFrame(loop);
    }

    const unsubscribePointer = subscribePointer((x, y) => {
      hasPosition = true;
      pointerOnPage = true;
      const dist = Math.hypot(x - lastX, y - lastY);
      if (dist > MIN_EMIT_DIST_PX) emit(x, y, x - lastX, y - lastY);
      lastX = x;
      lastY = y;
      ensureLoop();
    });

    function handleClick(event: MouseEvent) {
      engine.spawnRipple(event.clientX, event.clientY, currentStroke);
      ensureLoop();
    }
    document.addEventListener("click", handleClick, { passive: true });

    // "Pointer left the window" — `mouseleave` (unlike `mouseout`) doesn't
    // bubble, so listening directly on `document` is exactly the trick that
    // makes it fire only once the pointer has actually left the whole
    // viewport (through the browser chrome), not just moved between page
    // elements. The idle plume/ripple stop on this signal; any particles
    // already in flight keep fading out via the `hasActive()` check above.
    function handlePointerLeave() {
      pointerOnPage = false;
    }
    function handlePointerEnter() {
      pointerOnPage = true;
      ensureLoop();
    }
    document.addEventListener("mouseleave", handlePointerLeave);
    document.addEventListener("mouseenter", handlePointerEnter);

    // Background tabs never get real rAF ticks anyway, but explicitly
    // parking the loop on `visibilitychange` avoids a burst of clamped,
    // catch-up idle spawns firing the instant the tab regains focus.
    function handleVisibility() {
      if (document.hidden) {
        pointerOnPage = false;
      } else if (hasPosition) {
        pointerOnPage = true;
        lastFrameAt = performance.now();
        lastIdleSmokeAt = performance.now();
        lastIdleRippleAt = performance.now();
        ensureLoop();
      }
    }
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      cancelAnimationFrame(rafId);
      unsubscribePointer();
      window.removeEventListener("resize", resize);
      document.removeEventListener("click", handleClick);
      document.removeEventListener("mouseleave", handlePointerLeave);
      document.removeEventListener("mouseenter", handlePointerEnter);
      document.removeEventListener("visibilitychange", handleVisibility);
      sectionObserver.disconnect();
    };
  }, [enabled]);

  if (!enabled) return null;

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="fx-smoke pointer-events-none fixed inset-0 z-[997]"
    />
  );
}

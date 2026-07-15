"use client";

import { useEffect, useRef, useState } from "react";
import { prefersFinePointer, prefersReducedMotion, subscribePointer } from "./pointer";
import { buildSmokeSprites } from "./smoke-sprites";
import { createSmokeEngine } from "./smoke-particles";

const IDLE_PAUSE_MS = 2000;
const MAX_EMIT_PER_TICK = 4;
const EMIT_SPACING_PX = 14;
const MIN_EMIT_DIST_PX = 1.5; // skip emission on sub-pixel jitter from a near-stationary cursor
const MAX_FRAME_DELTA_MS = 48; // clamps the physics step after a tab-switch/idle gap

// Fluid smoke/water cursor trail — a fixed full-viewport canvas (own layer,
// separate from the reticle in cursor.tsx) that emits soft, additively
// blended plumes as the pointer moves, tinted toward whichever tool
// section is nearest the viewport center (brand indigo default elsewhere),
// plus a ripple ring on click. Particle simulation lives in
// smoke-particles.ts (a fixed-size mutable pool, not reallocated per
// frame); sprite pre-rendering lives in smoke-sprites.ts. This component
// only owns: the canvas element + DPR-aware sizing, translating pointer/
// click events into engine calls, the section-accent tracker, and the
// rAF loop itself (paused whenever the pointer has been idle for
// `IDLE_PAUSE_MS` and no particles are still alive, resumed on the next
// move or click). Fine-pointer + no-reduced-motion gated, same contract as
// the reticle; fully torn down on unmount.
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
    let lastMoveAt = performance.now();
    let lastFrameAt = performance.now();
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
      const dt = Math.min(MAX_FRAME_DELTA_MS, now - lastFrameAt);
      lastFrameAt = now;
      engine.update(dt);
      ctx!.clearRect(0, 0, canvas!.width, canvas!.height);
      engine.draw(ctx!);

      if (now - lastMoveAt > IDLE_PAUSE_MS && !engine.hasActive()) {
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
      lastMoveAt = performance.now();
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

    return () => {
      cancelAnimationFrame(rafId);
      unsubscribePointer();
      window.removeEventListener("resize", resize);
      document.removeEventListener("click", handleClick);
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

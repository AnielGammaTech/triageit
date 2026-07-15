"use client";

import { useEffect, useRef, useState } from "react";
import { prefersFinePointer, prefersReducedMotion } from "./pointer";
import { buildDustSprite, resolveColor } from "./smoke-sprites";
import { createSmokeEngine } from "./smoke-particles";
import { createAsteroidField, MAX_ROCKS } from "./asteroid-engine";
import { createFragmentField } from "./asteroid-fragments";

const SPAWN_MIN_DELAY_MS = 8000;
const SPAWN_MAX_DELAY_MS = 15000;
const MAX_FRAME_DELTA_MS = 48; // clamps the physics step after a tab-switch/idle gap
const DUST_BURST_COUNT = 10;
const DUST_BURST_SPEED = 18;
const SCORE_KEY = "gtools:asteroid-score";
// A click within a rock's drawn radius still doesn't count as a "hit" on
// the game if it actually landed on real interactive content — the layer is
// `pointer-events: none`, so `event.target` here is always whatever's
// genuinely underneath the rock, never the canvas itself. Checked before
// ever calling preventDefault/stopPropagation, so a link or button under a
// rock always wins.
const INTERACTIVE_SELECTOR =
  'a[href], button, input, select, textarea, [role="button"], [contenteditable="true"]';

interface AsteroidDebugApi {
  /** Playwright-only test hook — forces an immediate spawn regardless of the
   * ambient 8-15s timer, so a test doesn't have to sit through the real
   * wait. No UI surface, no user-facing effect; only exists while this
   * component is mounted and its fine-pointer/no-reduced-motion gate has
   * passed (i.e. only when the game itself actually exists on the page). */
  spawnNow: () => void;
  /** Playwright-only test hook — current active rock centers, so a test can
   * click a rock's exact position deterministically instead of guessing. */
  getRockPositions: () => Array<{ x: number; y: number; radius: number }>;
  /** Playwright-only test hook — places a stationary rock at an exact point,
   * so a test can verify "a link under a rock still wins" by placing one
   * directly over real interactive content instead of waiting for a natural
   * drift to cross it. */
  placeRockAt: (x: number, y: number) => void;
}
type WindowWithAsteroidDebug = Window & { __gtoolsAsteroidDebug?: AsteroidDebugApi };

function readStoredScore(): number {
  try {
    const raw = window.sessionStorage.getItem(SCORE_KEY);
    const parsed = raw ? Number.parseInt(raw, 10) : 0;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  } catch {
    return 0; // sessionStorage can throw under some privacy settings — the chip still works for this page life
  }
}

function writeStoredScore(score: number) {
  try {
    window.sessionStorage.setItem(SCORE_KEY, String(score));
  } catch {
    // Same tolerance as readStoredScore — a failed write just means the
    // count won't survive a reload; the session's live chip is unaffected.
  }
}

// Ambient, always-on asteroid mini-game: a couple of small rocks drift
// slowly across the viewport; clicking one shatters it (fragments + a dust
// burst reusing the cursor-trail's own particle engine/sprite code) and
// bumps a small persistent score chip. Deliberately its own canvas + its own
// rAF loop rather than piggybacking on ReticleCursor's — that loop only
// drives the reticle's position lerp, has nothing to draw to, and is gated
// identically (fine-pointer + no-reduced-motion) but with a fully independent
// lifecycle; giving this feature its own self-contained loop (same shape as
// SmokeTrail's) keeps the two decoupled instead of threading an unrelated
// concern through cursor.tsx. Same fine-pointer + no-reduced-motion gate,
// same graceful "run only while something is actually animating" discipline,
// full teardown on unmount — see smoke-trail.tsx for the shared pattern this
// mirrors.
export function Asteroids() {
  const [enabled, setEnabled] = useState(false);
  const [score, setScore] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    setEnabled(prefersFinePointer() && !prefersReducedMotion());
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    setScore(readStoredScore());

    const field = createAsteroidField();
    const fragmentField = createFragmentField();
    const dustEngine = createSmokeEngine();
    const dustSprite = buildDustSprite();
    const fillColor = resolveColor("var(--color-panel-2)", "rgb(22, 22, 31)");
    const edgeColor = resolveColor("var(--color-brand)", "rgb(110, 123, 255)");

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

    let running = false;
    let rafId = 0;
    let lastFrameAt = performance.now();
    let spawnTimer = 0;
    let scoreRef = readStoredScore();

    function loop(now: number) {
      const dt = Math.max(0, Math.min(MAX_FRAME_DELTA_MS, now - lastFrameAt));
      lastFrameAt = now;

      field.updateRocks(dt, window.innerWidth, window.innerHeight);
      fragmentField.updateFragments(dt);
      dustEngine.update(dt);

      ctx!.clearRect(0, 0, canvas!.width, canvas!.height);
      field.drawRocks(ctx!);
      fragmentField.drawFragments(ctx!);
      dustEngine.draw(ctx!);

      if (!field.hasActiveRocks() && !fragmentField.hasActiveFragments() && !dustEngine.hasActive()) {
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

    function trySpawnRock() {
      if (document.hidden) return;
      if (field.activeRockCount() >= MAX_ROCKS) return;
      const spawned = field.spawnRock(window.innerWidth, window.innerHeight, fillColor, edgeColor);
      if (spawned) ensureLoop();
    }

    function scheduleSpawn() {
      const delay = SPAWN_MIN_DELAY_MS + Math.random() * (SPAWN_MAX_DELAY_MS - SPAWN_MIN_DELAY_MS);
      spawnTimer = window.setTimeout(() => {
        trySpawnRock();
        scheduleSpawn();
      }, delay);
    }
    scheduleSpawn();

    function burstDust(x: number, y: number) {
      for (let i = 0; i < DUST_BURST_COUNT; i += 1) {
        const angle = Math.random() * Math.PI * 2;
        const speed = DUST_BURST_SPEED * (0.4 + Math.random() * 0.6);
        dustEngine.spawnSmoke(x, y, Math.cos(angle) * speed, Math.sin(angle) * speed, dustSprite);
      }
    }

    function bumpScore() {
      scoreRef += 1;
      writeStoredScore(scoreRef);
      setScore(scoreRef);
    }

    function handleClick(event: MouseEvent) {
      const hitIndex = field.hitTestRock(event.clientX, event.clientY);
      if (hitIndex === null) return;

      const target = event.target as Element | null;
      if (target?.closest(INTERACTIVE_SELECTOR)) return; // a real link/button under the rock wins

      const shatter = field.shatterRock(hitIndex);
      if (!shatter) return;

      fragmentField.spawnFragments(shatter.x, shatter.y, shatter.fillColor, shatter.edgeColor);
      burstDust(shatter.x, shatter.y);
      bumpScore();
      ensureLoop();
      event.preventDefault();
      event.stopPropagation();
    }
    // Capture phase: runs before the click reaches its real target, so a
    // rock hit can be consumed (preventDefault/stopPropagation) ahead of any
    // other document-level click listener (the smoke trail's ripple, the
    // Office easter egg's click counter) — a rock hit is one dedicated
    // interaction, not also a ripple-trigger.
    document.addEventListener("click", handleClick, { capture: true });

    const debugApi: AsteroidDebugApi = {
      spawnNow: () => {
        const spawned = field.spawnRock(window.innerWidth, window.innerHeight, fillColor, edgeColor);
        if (spawned) ensureLoop();
      },
      getRockPositions: () => field.getActiveRockPositions(),
      placeRockAt: (x: number, y: number) => {
        field.placeRockAt(x, y, fillColor, edgeColor);
        ensureLoop();
      },
    };
    (window as WindowWithAsteroidDebug).__gtoolsAsteroidDebug = debugApi;

    return () => {
      cancelAnimationFrame(rafId);
      window.clearTimeout(spawnTimer);
      window.removeEventListener("resize", resize);
      document.removeEventListener("click", handleClick, { capture: true });
      delete (window as WindowWithAsteroidDebug).__gtoolsAsteroidDebug;
    };
  }, [enabled]);

  if (!enabled) return null;

  return (
    <>
      <canvas
        ref={canvasRef}
        aria-hidden
        className="fx-asteroid-canvas pointer-events-none fixed inset-0 z-[900]"
      />
      {score > 0 && (
        <div aria-hidden="true" className="fx-asteroid-score fixed bottom-5 left-5 z-[70]">
          <span aria-hidden>☄</span> {score}
        </div>
      )}
    </>
  );
}

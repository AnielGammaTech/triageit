// Shared pointer-position store. Spotlight, the reticle cursor, and magnetic
// pull all need live viewport pointer coordinates — without this, each would
// attach its own `pointermove` listener and run its own per-event handler,
// three competing loops doing the same job. Instead every consumer calls
// `subscribePointer`, and exactly one real `window.pointermove` listener is
// ever attached (attached lazily on first subscriber, removed once the last
// one unsubscribes), batched to a single `requestAnimationFrame` flush per
// frame no matter how many subscribers or how many pointermove events fired
// since the last frame.
//
// Deliberately not a React hook: consumers need the callback to fire inside
// their own rAF-driven render loop (cursor.tsx keeps interpolating between
// frames even when the pointer stops moving), not on every React re-render.

type PointerListener = (x: number, y: number) => void;

const listeners = new Set<PointerListener>();
let rafId: number | null = null;
let latestX = 0;
let latestY = 0;
let attached = false;

function flush() {
  rafId = null;
  for (const listener of listeners) listener(latestX, latestY);
}

function handlePointerMove(event: PointerEvent) {
  latestX = event.clientX;
  latestY = event.clientY;
  if (rafId === null) {
    rafId = requestAnimationFrame(flush);
  }
}

/**
 * Subscribe to rAF-batched pointer position updates (viewport px). Returns
 * an unsubscribe function. Safe to call from an effect on every mount/unmount
 * — the underlying listener is reference-counted via `listeners.size`.
 */
export function subscribePointer(listener: PointerListener): () => void {
  listeners.add(listener);
  if (!attached) {
    attached = true;
    window.addEventListener("pointermove", handlePointerMove, { passive: true });
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && attached) {
      attached = false;
      window.removeEventListener("pointermove", handlePointerMove);
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
    }
  };
}

/**
 * True on fine-pointer devices (mouse/trackpad). Client-only — call from
 * inside an effect, never during render (SSR has no `window`/`matchMedia`).
 */
export function prefersFinePointer(): boolean {
  return window.matchMedia("(pointer: fine)").matches;
}

/**
 * True when the user has requested reduced motion. Client-only — same rule
 * as `prefersFinePointer`.
 */
export function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

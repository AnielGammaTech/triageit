import { TOOLS } from "@/content/tools";
import { accentVar } from "@/components/browser-frame";

// Sprite canvas is a long horizontal strip, not a square — the shape itself
// is what turns a "puff" into a "wisp": a soft blob tapered along its length
// so one end (the head, toward SPRITE_LEN) reads dense/bright and the other
// (the tail, toward 0) fades to nothing. smoke-particles.ts orients this
// strip along each particle's live velocity vector every frame (rotate +
// non-uniform scale before drawImage) so the head always leads the direction
// of travel and the tail streams behind it — a comet, not a circle.
const SPRITE_LEN_PX = 256;
const SPRITE_WID_PX = 64;
const BRAND_FALLBACK = "rgb(110, 123, 255)"; // --color-brand, in case resolution ever fails

export interface SmokeSpriteSet {
  /** Pre-rendered tapered wisp strip, tinted per tool accent — drawn via ctx.drawImage. */
  bySlug: Map<string, HTMLCanvasElement>;
  /** Flat "rgb(r, g, b)" per tool accent, for the click-ripple stroke (no gradient needed there). */
  strokeBySlug: Map<string, string>;
  brand: HTMLCanvasElement;
  brandStroke: string;
}

// Canvas fillStyle/strokeStyle can't resolve `var(--color-x)` on its own —
// it has no CSS cascade to consult — so colors are resolved once, up front,
// via a detached probe element the real cascade *does* apply to, then baked
// into plain "rgb(...)" strings the canvas API understands directly. Only
// ever called client-side (from an effect), never at module scope. Exported
// so other canvas-drawn FX (fx/asteroid-engine.ts, for rock fill/edge
// colors) can resolve theme colors the same way instead of re-implementing
// the probe trick.
export function resolveColor(cssVarExpr: string, fallback: string): string {
  const probe = document.createElement("span");
  probe.style.color = cssVarExpr;
  document.body.appendChild(probe);
  const resolved = getComputedStyle(probe).color;
  probe.remove();
  return resolved || fallback;
}

function withAlpha(rgb: string, alpha: number): string {
  const parts = rgb.match(/\d+(\.\d+)?/g);
  if (!parts || parts.length < 3) return `rgba(110, 123, 255, ${alpha})`;
  const [r, g, b] = parts;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// One soft, pre-baked wisp strip per color — drawing a fresh gradient every
// particle every frame (up to 64 particles * 60fps) is exactly the kind of
// per-frame allocation/computation the "stays smooth under rapid movement"
// requirement rules out, so every color variant is rendered once, offscreen,
// at mount, and reused via cheap drawImage calls after that.
//
// Two gradients, composited together: a soft radial body (biased toward the
// head end so the blob itself isn't perfectly symmetric) gives the puffy
// cross-section smoke needs, then a `destination-in` linear taper wipes the
// tail down to full transparency — that second pass is what makes the shape
// read as a trailing streak instead of an elongated (but still symmetric,
// still bubble-like) ellipse.
function paintWisp(rgb: string): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = SPRITE_LEN_PX;
  canvas.height = SPRITE_WID_PX;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  const headX = SPRITE_LEN_PX * 0.62;
  const cy = SPRITE_WID_PX / 2;
  const body = ctx.createRadialGradient(headX, cy, 0, headX, cy, SPRITE_LEN_PX * 0.62);
  body.addColorStop(0, withAlpha(rgb, 0.55));
  body.addColorStop(0.4, withAlpha(rgb, 0.28));
  body.addColorStop(1, withAlpha(rgb, 0));
  ctx.fillStyle = body;
  ctx.fillRect(0, 0, SPRITE_LEN_PX, SPRITE_WID_PX);

  ctx.globalCompositeOperation = "destination-in";
  const taper = ctx.createLinearGradient(0, 0, SPRITE_LEN_PX, 0);
  taper.addColorStop(0, "rgba(0, 0, 0, 0)");
  taper.addColorStop(0.55, "rgba(0, 0, 0, 0.45)");
  taper.addColorStop(1, "rgba(0, 0, 0, 1)");
  ctx.fillStyle = taper;
  ctx.fillRect(0, 0, SPRITE_LEN_PX, SPRITE_WID_PX);
  ctx.globalCompositeOperation = "source-over";

  return canvas;
}

export function buildSmokeSprites(): SmokeSpriteSet {
  const bySlug = new Map<string, HTMLCanvasElement>();
  const strokeBySlug = new Map<string, string>();
  for (const tool of TOOLS) {
    const rgb = resolveColor(accentVar(tool.accent), BRAND_FALLBACK);
    bySlug.set(tool.slug, paintWisp(rgb));
    strokeBySlug.set(tool.slug, rgb);
  }
  const brandRgb = resolveColor("var(--color-brand)", BRAND_FALLBACK);
  return { bySlug, strokeBySlug, brand: paintWisp(brandRgb), brandStroke: brandRgb };
}

// A single neutral dust-colored wisp sprite — used for the asteroid game's
// shatter smoke burst (fx/asteroids.tsx), which has no per-tool accent to
// key off of. Reuses the exact same sprite shape/build path as the cursor
// trail so "reusing the trail system" is literal, not just visually similar.
export function buildDustSprite(): HTMLCanvasElement {
  const rgb = resolveColor("var(--color-fog)", "rgb(155, 155, 168)");
  return paintWisp(rgb);
}

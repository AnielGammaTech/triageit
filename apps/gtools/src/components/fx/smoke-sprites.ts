import { TOOLS } from "@/content/tools";
import { accentVar } from "@/components/browser-frame";

const SPRITE_SIZE_PX = 128;
const BRAND_FALLBACK = "rgb(110, 123, 255)"; // --color-brand, in case resolution ever fails

export interface SmokeSpriteSet {
  /** Pre-rendered radial-gradient puff, tinted per tool accent — drawn via ctx.drawImage. */
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
// ever called client-side (from an effect), never at module scope.
function resolveColor(cssVarExpr: string, fallback: string): string {
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

// One soft, pre-baked puff per color — drawing a fresh radial gradient
// every particle every frame (up to 64 particles * 60fps) is exactly the
// kind of per-frame allocation/computation the "stays smooth under rapid
// movement" requirement rules out, so every color variant is rendered
// once, offscreen, at mount, and reused via cheap drawImage calls after
// that.
function paintPuff(rgb: string): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = SPRITE_SIZE_PX;
  canvas.height = SPRITE_SIZE_PX;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  const r = SPRITE_SIZE_PX / 2;
  const gradient = ctx.createRadialGradient(r, r, 0, r, r, r);
  gradient.addColorStop(0, withAlpha(rgb, 0.5));
  gradient.addColorStop(0.35, withAlpha(rgb, 0.26));
  gradient.addColorStop(1, withAlpha(rgb, 0));
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(r, r, r, 0, Math.PI * 2);
  ctx.fill();
  return canvas;
}

export function buildSmokeSprites(): SmokeSpriteSet {
  const bySlug = new Map<string, HTMLCanvasElement>();
  const strokeBySlug = new Map<string, string>();
  for (const tool of TOOLS) {
    const rgb = resolveColor(accentVar(tool.accent), BRAND_FALLBACK);
    bySlug.set(tool.slug, paintPuff(rgb));
    strokeBySlug.set(tool.slug, rgb);
  }
  const brandRgb = resolveColor("var(--color-brand)", BRAND_FALLBACK);
  return { bySlug, strokeBySlug, brand: paintPuff(brandRgb), brandStroke: brandRgb };
}

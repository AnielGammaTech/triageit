const MAX_PARTICLES = 64;
const MAX_RIPPLES = 8; // headroom for an ambient ring or two plus an occasional click on top
// Longer-lived than the old bubble puffs (owner: "should be longer too") —
// long enough for a fast cursor throw to read as a lingering comet tail
// instead of a quick pop.
const PARTICLE_LIFE_MIN_MS = 1400;
const PARTICLE_LIFE_MAX_MS = 2600;
const BUOYANCY_PX_PER_MS2 = 0.00003; // gentle upward drift, like rising smoke
const DRAG = 0.985; // per-frame velocity damping so the initial cursor "throw" settles into a drift
const WOBBLE_MIN = 0.002;
const WOBBLE_MAX = 0.005;
const CURL_RAD = 0.5; // wobble-driven rotational curl, so the wisp bends like ink in water instead of staying ruler-straight
// Wisp draw geometry — a thin cross-section stretched along the live
// velocity vector (see `draw()`), not a circle. WIDTH is the short axis;
// LEN is the long axis, biased up by speed so a fast throw reads as a long
// comet streak while a stationary idle plume stays a thin rising column.
const WIDTH_START_PX = 4;
const WIDTH_END_PX = 13;
const LEN_BASE_PX = 30; // floor length even at zero velocity (the idle "thin rising wisp")
const LEN_SPEED_PX = 5.5; // added length per px/frame-step of speed
const LEN_MAX_BONUS_PX = 170;
// Below this, orient the wisp straight up instead of trusting a near-zero
// vector's angle — deliberately above the typical magnitude of per-particle
// spawn jitter alone (so idle jitter noise doesn't flicker the orientation)
// but well below both real cursor-movement speed and the idle plume's own
// buoyancy-driven terminal upward velocity, so both settle to their intended
// look within the first few frames.
const MIN_DIRECTIONAL_SPEED = 0.15;
// Click ripple defaults — the "stronger ring" every `spawnRipple` call falls
// back to unless the caller (the ambient idle rhythm in smoke-trail.tsx)
// passes its own softer strength/life/radius.
const RIPPLE_LIFE_MS = 650;
const RIPPLE_MAX_RADIUS_PX = 46;
const RIPPLE_STRENGTH = 1;

interface Particle {
  active: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  wobblePhase: number;
  wobbleSpeed: number;
  sprite: HTMLCanvasElement | null;
}

interface Ripple {
  active: boolean;
  x: number;
  y: number;
  age: number;
  life: number;
  maxRadius: number;
  strength: number; // 0-1, scales opacity + line weight — click rings vs. the softer ambient rhythm
  color: string;
}

// A fixed-size, mutated-in-place particle/ripple pool — the standard
// real-time-rendering exception to "always create new objects, never
// mutate": allocating a fresh object per emission (and letting spent ones
// become garbage) puts GC pressure directly inside a 60fps canvas loop,
// which is precisely the jank "must stay smooth under rapid movement"
// rules out. Every slot is allocated once and only ever has its fields
// overwritten afterward — same tradeoff GSAP itself makes internally, and
// the same one this codebase already leans on for the cursor reticle's own
// per-frame lerp state (fx/cursor.tsx).
export function createSmokeEngine() {
  const particles: Particle[] = Array.from({ length: MAX_PARTICLES }, () => ({
    active: false,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    age: 0,
    life: 0,
    wobblePhase: 0,
    wobbleSpeed: 0,
    sprite: null,
  }));
  const ripples: Ripple[] = Array.from({ length: MAX_RIPPLES }, () => ({
    active: false,
    x: 0,
    y: 0,
    age: 0,
    life: 0,
    maxRadius: RIPPLE_MAX_RADIUS_PX,
    strength: RIPPLE_STRENGTH,
    color: "",
  }));
  let particleCursor = 0;
  let rippleCursor = 0;

  function spawnSmoke(x: number, y: number, vx: number, vy: number, sprite: HTMLCanvasElement) {
    const p = particles[particleCursor % particles.length];
    particleCursor += 1;
    p.active = true;
    p.x = x;
    p.y = y;
    p.vx = vx * 0.35 + (Math.random() - 0.5) * 0.5;
    p.vy = vy * 0.35 + (Math.random() - 0.5) * 0.5;
    p.age = 0;
    p.life = PARTICLE_LIFE_MIN_MS + Math.random() * (PARTICLE_LIFE_MAX_MS - PARTICLE_LIFE_MIN_MS);
    p.wobblePhase = Math.random() * Math.PI * 2;
    p.wobbleSpeed = WOBBLE_MIN + Math.random() * (WOBBLE_MAX - WOBBLE_MIN);
    p.sprite = sprite;
  }

  // `strength`/`life`/`maxRadius` default to the click-ripple values, so
  // every existing call site (the click handler) is untouched and still
  // produces the "stronger ring." The continuous ambient rhythm
  // (smoke-trail.tsx) passes a lower strength, a longer life, and a smaller
  // radius for a softer, slower-breathing ring that layers under the smoke
  // instead of competing with a real click.
  function spawnRipple(
    x: number,
    y: number,
    color: string,
    strength: number = RIPPLE_STRENGTH,
    life: number = RIPPLE_LIFE_MS,
    maxRadius: number = RIPPLE_MAX_RADIUS_PX,
  ) {
    const r = ripples[rippleCursor % ripples.length];
    rippleCursor += 1;
    r.active = true;
    r.x = x;
    r.y = y;
    r.age = 0;
    r.life = life;
    r.maxRadius = maxRadius;
    r.strength = strength;
    r.color = color;
  }

  function update(dtMs: number) {
    const steps = dtMs / 16.6;
    for (const p of particles) {
      if (!p.active) continue;
      p.age += dtMs;
      if (p.age >= p.life) {
        p.active = false;
        continue;
      }
      p.vy -= BUOYANCY_PX_PER_MS2 * dtMs * dtMs;
      p.vx *= DRAG;
      p.vy *= DRAG;
      p.wobblePhase += p.wobbleSpeed * dtMs;
      p.x += p.vx * steps + Math.sin(p.wobblePhase) * 0.6;
      p.y += p.vy * steps;
    }
    for (const r of ripples) {
      if (!r.active) continue;
      r.age += dtMs;
      if (r.age >= r.life) r.active = false;
    }
  }

  function hasActive() {
    return particles.some((p) => p.active) || ripples.some((r) => r.active);
  }

  function draw(ctx: CanvasRenderingContext2D) {
    ctx.globalCompositeOperation = "lighter";
    for (const p of particles) {
      if (!p.active || !p.sprite) continue;
      const t = p.age / p.life;
      // Fast fade-in (12% of life), then an eased power fade-out over the
      // rest — reads as "materializes, then tapers away" rather than the
      // old linear ramp-down, matching a wisp thinning out instead of a
      // bubble popping.
      const alpha =
        t < 0.12 ? t / 0.12 : Math.pow(Math.max(0, 1 - (t - 0.12) / 0.88), 1.3);
      if (alpha <= 0) continue;

      // Orientation + length are derived from the particle's *live* velocity
      // every frame (not fixed at spawn), so idle particles — vx/vy start at
      // 0, then pick up a little upward speed as buoyancy accumulates —
      // naturally resolve to a thin vertical wisp, while movement-spawned
      // particles (real cursor velocity baked in at spawnSmoke) immediately
      // read as long comet streaks pointed the way the cursor is moving.
      const speed = Math.hypot(p.vx, p.vy);
      const dirAngle =
        speed > MIN_DIRECTIONAL_SPEED ? Math.atan2(p.vy, p.vx) : -Math.PI / 2;
      // Wobble already perturbs position (below, in `update`); reusing the
      // same phase as a small rotational offset here is what makes the
      // wisp's *bend* correlate with its own drift instead of the two
      // fighting each other — "ink curling in water," not a straight rod
      // that happens to wiggle sideways.
      const curl = Math.sin(p.wobblePhase) * CURL_RAD;
      const growth = 0.6 + 0.4 * t;
      const length =
        (LEN_BASE_PX + Math.min(LEN_MAX_BONUS_PX, speed * LEN_SPEED_PX)) * growth;
      const width = WIDTH_START_PX + (WIDTH_END_PX - WIDTH_START_PX) * t;

      ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(dirAngle + curl);
      // The sprite's bright "head" sits at its own right edge (see
      // smoke-sprites.ts's paintWisp) — anchoring the draw rect's right
      // edge at the local origin puts that head exactly on the particle's
      // live position, tail trailing behind along -x (i.e. opposite the
      // direction of travel, once rotated into place above).
      ctx.drawImage(p.sprite, -length, -width / 2, length, width);
      ctx.restore();
    }
    for (const r of ripples) {
      if (!r.active) continue;
      const t = r.age / r.life;
      // `ctx.arc()` throws on any negative radius, even float noise just
      // under 0 — clamp defensively so a mistimed frame delta upstream can
      // never crash the draw loop.
      const radius = Math.max(0, r.maxRadius * t);
      ctx.globalAlpha = Math.max(0, 1 - t) * r.strength;
      ctx.strokeStyle = r.color;
      ctx.lineWidth = 1 + r.strength * 0.8;
      ctx.beginPath();
      ctx.arc(r.x, r.y, radius, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }

  return { spawnSmoke, spawnRipple, update, draw, hasActive };
}

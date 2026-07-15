const MAX_PARTICLES = 64;
const MAX_RIPPLES = 6;
const PARTICLE_LIFE_MIN_MS = 650;
const PARTICLE_LIFE_MAX_MS = 1150;
const START_SIZE_PX = 5;
const END_SIZE_PX = 34;
const BUOYANCY_PX_PER_MS2 = 0.00003; // gentle upward drift, like rising smoke
const DRAG = 0.985; // per-frame velocity damping so the initial cursor "throw" settles into a drift
const WOBBLE_MIN = 0.002;
const WOBBLE_MAX = 0.005;
const RIPPLE_LIFE_MS = 650;
const RIPPLE_MAX_RADIUS_PX = 46;

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

  function spawnRipple(x: number, y: number, color: string) {
    const r = ripples[rippleCursor % ripples.length];
    rippleCursor += 1;
    r.active = true;
    r.x = x;
    r.y = y;
    r.age = 0;
    r.life = RIPPLE_LIFE_MS;
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
      const size = START_SIZE_PX + (END_SIZE_PX - START_SIZE_PX) * t;
      const alpha = t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85;
      ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
      ctx.drawImage(p.sprite, p.x - size, p.y - size, size * 2, size * 2);
    }
    for (const r of ripples) {
      if (!r.active) continue;
      const t = r.age / r.life;
      ctx.globalAlpha = Math.max(0, 1 - t);
      ctx.strokeStyle = r.color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(r.x, r.y, RIPPLE_MAX_RADIUS_PX * t, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }

  return { spawnSmoke, spawnRipple, update, draw, hasActive };
}

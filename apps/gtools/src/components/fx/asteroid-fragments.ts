// Shatter debris for the asteroid mini-game (fx/asteroids.tsx) — split out
// of asteroid-engine.ts, which owns the rocks themselves, so each file stays
// small and focused: one pool for the drifting hazards, one for the quick
// burst their destruction fires off. Same fixed-size, mutate-in-place pool
// discipline as smoke-particles.ts.

const FRAGMENT_POOL_SIZE = 24; // headroom for two rocks shattering in close succession
const FRAGMENT_COUNT_PER_ROCK = 8;
const FRAGMENT_LIFE_MIN_MS = 450;
const FRAGMENT_LIFE_MAX_MS = 850;
const FRAGMENT_SPEED_MIN_PX_MS = 0.05;
const FRAGMENT_SPEED_MAX_PX_MS = 0.22;
const FRAGMENT_DRAG = 0.94; // faster decay than smoke — a quick burst, not a drift
const FRAGMENT_SIZE_MIN_PX = 2;
const FRAGMENT_SIZE_MAX_PX = 5;

interface Fragment {
  active: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  rotation: number;
  rotationSpeed: number;
  size: number;
  color: string;
}

export function createFragmentField() {
  const fragments: Fragment[] = Array.from({ length: FRAGMENT_POOL_SIZE }, () => ({
    active: false,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    age: 0,
    life: 0,
    rotation: 0,
    rotationSpeed: 0,
    size: 0,
    color: "",
  }));
  let cursor = 0;

  function spawnFragments(x: number, y: number, fillColor: string, edgeColor: string) {
    for (let i = 0; i < FRAGMENT_COUNT_PER_ROCK; i += 1) {
      const f = fragments[cursor % fragments.length];
      cursor += 1;
      const angle = Math.random() * Math.PI * 2;
      const speed =
        FRAGMENT_SPEED_MIN_PX_MS + Math.random() * (FRAGMENT_SPEED_MAX_PX_MS - FRAGMENT_SPEED_MIN_PX_MS);
      f.active = true;
      f.x = x;
      f.y = y;
      f.vx = Math.cos(angle) * speed;
      f.vy = Math.sin(angle) * speed;
      f.age = 0;
      f.life = FRAGMENT_LIFE_MIN_MS + Math.random() * (FRAGMENT_LIFE_MAX_MS - FRAGMENT_LIFE_MIN_MS);
      f.rotation = Math.random() * Math.PI * 2;
      f.rotationSpeed = (Math.random() - 0.5) * 0.02;
      f.size = FRAGMENT_SIZE_MIN_PX + Math.random() * (FRAGMENT_SIZE_MAX_PX - FRAGMENT_SIZE_MIN_PX);
      f.color = i % 3 === 0 ? edgeColor : fillColor;
    }
  }

  function updateFragments(dtMs: number) {
    for (const f of fragments) {
      if (!f.active) continue;
      f.age += dtMs;
      if (f.age >= f.life) {
        f.active = false;
        continue;
      }
      f.vx *= FRAGMENT_DRAG;
      f.vy *= FRAGMENT_DRAG;
      f.x += f.vx * dtMs;
      f.y += f.vy * dtMs;
      f.rotation += f.rotationSpeed * dtMs;
    }
  }

  function drawFragments(ctx: CanvasRenderingContext2D) {
    for (const f of fragments) {
      if (!f.active) continue;
      const alpha = Math.max(0, 1 - f.age / f.life);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(f.x, f.y);
      ctx.rotate(f.rotation);
      ctx.fillStyle = f.color;
      ctx.beginPath();
      ctx.moveTo(0, -f.size);
      ctx.lineTo(f.size, f.size);
      ctx.lineTo(-f.size, f.size * 0.6);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  function hasActiveFragments(): boolean {
    return fragments.some((f) => f.active);
  }

  return { spawnFragments, updateFragments, drawFragments, hasActiveFragments };
}

// Physics + drawing for the ambient asteroid mini-game's rocks
// (fx/asteroids.tsx). The shatter debris pool lives in its own file
// (asteroid-fragments.ts) so each stays small and focused. Same fixed-size,
// mutate-in-place pool discipline as smoke-particles.ts (spawn/update/draw
// split, nothing allocated inside the per-frame loop) — the one exception is
// each rock's own polygon `vertices` array, regenerated fresh on every
// spawn. That's a genuine, deliberate relaxation of the "never allocate in
// the hot path" rule: rocks spawn once every 8-15s at most 2 at a time,
// nowhere near the 60fps particle-emission rate the stricter pool in
// smoke-particles.ts exists to protect.

export const MAX_ROCKS = 2;
const ROCK_MIN_RADIUS_PX = 8; // ~16px diameter
const ROCK_MAX_RADIUS_PX = 14; // ~28px diameter
const ROCK_SPEED_MIN_PX_MS = 0.035; // slow ambient drift, not a game-speed obstacle
const ROCK_SPEED_MAX_PX_MS = 0.075;
const ROCK_ROTATION_SPEED_MAX = 0.0012; // rad/ms — a gentle tumble
const ROCK_VERTEX_MIN = 7;
const ROCK_VERTEX_MAX = 9;
const ROCK_EDGE_MARGIN_PX = 60; // spawns just off-screen, despawns once fully clear
const HIT_PADDING_PX = 6; // small forgiveness beyond the drawn radius for a satisfying click

interface RockVertex {
  x: number;
  y: number;
}

interface Rock {
  active: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  rotation: number;
  rotationSpeed: number;
  vertices: RockVertex[];
  fillColor: string;
  edgeColor: string;
}

export interface RockShatter {
  x: number;
  y: number;
  fillColor: string;
  edgeColor: string;
}

function generateRockVertices(radius: number): RockVertex[] {
  const count =
    ROCK_VERTEX_MIN + Math.floor(Math.random() * (ROCK_VERTEX_MAX - ROCK_VERTEX_MIN + 1));
  const vertices: RockVertex[] = [];
  for (let i = 0; i < count; i += 1) {
    const angle = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * ((Math.PI * 2) / count) * 0.5;
    const r = radius * (0.68 + Math.random() * 0.32);
    vertices.push({ x: Math.cos(angle) * r, y: Math.sin(angle) * r });
  }
  return vertices;
}

// Enters from a random edge, heads roughly toward the far side of the
// viewport (with enough randomness in the target point that it doesn't read
// as a perfectly straight, mechanical line).
function pickSpawn(viewportW: number, viewportH: number) {
  const edge = Math.floor(Math.random() * 4);
  const m = ROCK_EDGE_MARGIN_PX;
  let x: number;
  let y: number;
  let targetX: number;
  let targetY: number;
  if (edge === 0) {
    // top
    x = Math.random() * viewportW;
    y = -m;
    targetX = Math.random() * viewportW;
    targetY = viewportH + m;
  } else if (edge === 1) {
    // right
    x = viewportW + m;
    y = Math.random() * viewportH;
    targetX = -m;
    targetY = Math.random() * viewportH;
  } else if (edge === 2) {
    // bottom
    x = Math.random() * viewportW;
    y = viewportH + m;
    targetX = Math.random() * viewportW;
    targetY = -m;
  } else {
    // left
    x = -m;
    y = Math.random() * viewportH;
    targetX = viewportW + m;
    targetY = Math.random() * viewportH;
  }
  const dx = targetX - x;
  const dy = targetY - y;
  const dist = Math.hypot(dx, dy) || 1;
  const speed = ROCK_SPEED_MIN_PX_MS + Math.random() * (ROCK_SPEED_MAX_PX_MS - ROCK_SPEED_MIN_PX_MS);
  return { x, y, vx: (dx / dist) * speed, vy: (dy / dist) * speed };
}

export function createAsteroidField() {
  const rocks: Rock[] = Array.from({ length: MAX_ROCKS }, () => ({
    active: false,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    radius: ROCK_MIN_RADIUS_PX,
    rotation: 0,
    rotationSpeed: 0,
    vertices: [],
    fillColor: "",
    edgeColor: "",
  }));

  function activeRockCount(): number {
    return rocks.reduce((count, r) => count + (r.active ? 1 : 0), 0);
  }

  // Read-only snapshot of active rock positions — used by fx/asteroids.tsx's
  // Playwright-only debug API so a test can click a rock's exact center
  // deterministically instead of guessing coordinates.
  function getActiveRockPositions(): Array<{ x: number; y: number; radius: number }> {
    return rocks.filter((r) => r.active).map((r) => ({ x: r.x, y: r.y, radius: r.radius }));
  }

  // Test-only: places a stationary rock at an exact point instead of a
  // random edge trajectory — used by fx/asteroids.tsx's debug API so a test
  // can verify "a link under a rock still wins" deterministically (e.g. by
  // placing one directly over a real nav link) without waiting for a
  // natural drift to happen to cross it.
  function placeRockAt(x: number, y: number, fillColor: string, edgeColor: string) {
    const slot = rocks.find((r) => !r.active) ?? rocks[0];
    const radius = (ROCK_MIN_RADIUS_PX + ROCK_MAX_RADIUS_PX) / 2;
    slot.active = true;
    slot.x = x;
    slot.y = y;
    slot.vx = 0;
    slot.vy = 0;
    slot.radius = radius;
    slot.rotation = 0;
    slot.rotationSpeed = 0;
    slot.vertices = generateRockVertices(radius);
    slot.fillColor = fillColor;
    slot.edgeColor = edgeColor;
  }

  // Returns false only if every slot is already active — callers are
  // expected to check `activeRockCount() < MAX_ROCKS` first, so in practice
  // this always finds a free slot.
  function spawnRock(viewportW: number, viewportH: number, fillColor: string, edgeColor: string): boolean {
    const slot = rocks.find((r) => !r.active);
    if (!slot) return false;
    const { x, y, vx, vy } = pickSpawn(viewportW, viewportH);
    const radius = ROCK_MIN_RADIUS_PX + Math.random() * (ROCK_MAX_RADIUS_PX - ROCK_MIN_RADIUS_PX);
    slot.active = true;
    slot.x = x;
    slot.y = y;
    slot.vx = vx;
    slot.vy = vy;
    slot.radius = radius;
    slot.rotation = Math.random() * Math.PI * 2;
    slot.rotationSpeed = (Math.random() - 0.5) * 2 * ROCK_ROTATION_SPEED_MAX;
    slot.vertices = generateRockVertices(radius);
    slot.fillColor = fillColor;
    slot.edgeColor = edgeColor;
    return true;
  }

  function updateRocks(dtMs: number, viewportW: number, viewportH: number) {
    for (const r of rocks) {
      if (!r.active) continue;
      r.x += r.vx * dtMs;
      r.y += r.vy * dtMs;
      r.rotation += r.rotationSpeed * dtMs;
      const margin = ROCK_EDGE_MARGIN_PX + r.radius;
      if (r.x < -margin || r.x > viewportW + margin || r.y < -margin || r.y > viewportH + margin) {
        r.active = false; // drifted fully off-screen — just gone, no shatter
      }
    }
  }

  function drawRocks(ctx: CanvasRenderingContext2D) {
    for (const r of rocks) {
      if (!r.active || r.vertices.length === 0) continue;
      ctx.save();
      ctx.translate(r.x, r.y);
      ctx.rotate(r.rotation);
      ctx.beginPath();
      r.vertices.forEach((v, i) => {
        if (i === 0) ctx.moveTo(v.x, v.y);
        else ctx.lineTo(v.x, v.y);
      });
      ctx.closePath();
      ctx.fillStyle = r.fillColor;
      ctx.fill();
      ctx.strokeStyle = r.edgeColor;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
    }
  }

  // Circle-approximated hit test (padded a little beyond the drawn radius)
  // rather than exact polygon containment — plenty precise for a small,
  // casual "click the rock" target and far cheaper than point-in-polygon on
  // every click.
  function hitTestRock(x: number, y: number): number | null {
    for (let i = 0; i < rocks.length; i += 1) {
      const r = rocks[i];
      if (!r.active) continue;
      if (Math.hypot(x - r.x, y - r.y) <= r.radius + HIT_PADDING_PX) return i;
    }
    return null;
  }

  // Deactivates the rock at `index` and returns its shatter point + colors
  // (so the caller — fx/asteroids.tsx — can hand them to the separate
  // fragment pool and a dust burst); returns null if that slot wasn't
  // actually an active rock (stale index).
  function shatterRock(index: number): RockShatter | null {
    const r = rocks[index];
    if (!r || !r.active) return null;
    const { x, y, fillColor, edgeColor } = r;
    r.active = false;
    return { x, y, fillColor, edgeColor };
  }

  function hasActiveRocks(): boolean {
    return rocks.some((r) => r.active);
  }

  return {
    activeRockCount,
    getActiveRockPositions,
    placeRockAt,
    spawnRock,
    updateRocks,
    drawRocks,
    hitTestRock,
    shatterRock,
    hasActiveRocks,
  };
}

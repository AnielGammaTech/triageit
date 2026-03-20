import { NextResponse } from "next/server";

/**
 * In-memory sliding window rate limiter.
 *
 * Identifies callers by authenticated user ID. Returns null when the request
 * is allowed, or a 429 NextResponse when the limit is exceeded.
 *
 * Defaults:
 *   limit     = 60 requests
 *   windowMs  = 60_000 ms (1 minute)
 *
 * Use a lower limit (e.g. 10) for expensive routes such as triage, retriage,
 * summarize, and pull-tickets.
 */

interface WindowEntry {
  readonly timestamps: number[];
}

const windows = new Map<string, WindowEntry>();

// Clean up stale entries every 5 minutes to prevent unbounded memory growth.
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

let cleanupTimer: ReturnType<typeof setInterval> | null = null;

function startCleanupTimer(windowMs: number): void {
  if (cleanupTimer !== null) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of windows.entries()) {
      const fresh = entry.timestamps.filter((t) => now - t < windowMs);
      if (fresh.length === 0) {
        windows.delete(key);
      } else {
        windows.set(key, { timestamps: fresh });
      }
    }
  }, CLEANUP_INTERVAL_MS);

  // Allow the Node.js process to exit even if this timer is still active.
  if (cleanupTimer && typeof cleanupTimer === "object" && "unref" in cleanupTimer) {
    (cleanupTimer as { unref: () => void }).unref();
  }
}

/**
 * Check whether `userId` has exceeded their rate limit for a specific route.
 *
 * @param userId   - Authenticated user ID (from requireAuth).
 * @param limit    - Max requests allowed within the window. Default: 60.
 * @param windowMs - Sliding window size in milliseconds. Default: 60_000.
 * @param routeKey - Optional route identifier to scope the limit. When omitted,
 *                   a "global" bucket is used. Expensive routes (triage/all,
 *                   retriage, etc.) should pass a unique key so their strict
 *                   limits don't collide with normal page-load traffic.
 * @returns `null` when the request is allowed, a 429 NextResponse when blocked.
 */
export function checkRateLimit(
  userId: string,
  limit = 60,
  windowMs = 60_000,
  routeKey = "global",
): NextResponse | null {
  startCleanupTimer(windowMs);

  const bucketKey = `${userId}:${routeKey}`;
  const now = Date.now();
  const existing = windows.get(bucketKey);
  const prevTimestamps = existing?.timestamps ?? [];

  // Slide the window: keep only timestamps within the current window.
  const windowTimestamps = prevTimestamps.filter((t) => now - t < windowMs);

  if (windowTimestamps.length >= limit) {
    const oldestInWindow = windowTimestamps[0];
    const retryAfterMs = windowMs - (now - oldestInWindow);
    const retryAfterSec = Math.ceil(retryAfterMs / 1000);

    return NextResponse.json(
      { error: "Too many requests. Please slow down and try again shortly." },
      {
        status: 429,
        headers: {
          "Retry-After": String(retryAfterSec),
          "X-RateLimit-Limit": String(limit),
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": String(Math.ceil((now + retryAfterMs) / 1000)),
        },
      },
    );
  }

  // Record this request and update the window (immutable pattern).
  windows.set(bucketKey, { timestamps: [...windowTimestamps, now] });

  return null;
}

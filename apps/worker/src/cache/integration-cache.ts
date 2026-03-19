import { Redis } from "ioredis";
import { getRedisConnectionOptions } from "../queue/connection.js";

/**
 * Integration response cache — stores API responses for 15 minutes
 * to avoid repeated calls to the same integration endpoints.
 *
 * Uses the existing Redis instance (same one BullMQ uses).
 */

const DEFAULT_TTL_SECONDS = 15 * 60; // 15 minutes
const CACHE_PREFIX = "triageit:cache:";

let redisInstance: Redis | null = null;

function getRedis(): Redis {
  if (!redisInstance) {
    const opts = getRedisConnectionOptions();
    redisInstance = new Redis({
      host: opts.host ?? "localhost",
      port: opts.port ?? 6379,
      password: opts.password,
      maxRetriesPerRequest: 1,
      lazyConnect: true,
    });

    redisInstance.on("error", (err: Error) => {
      console.warn("[CACHE] Redis error (cache degraded, not fatal):", err.message);
    });
  }
  return redisInstance;
}

/**
 * Build a cache key from service name and lookup parameters.
 */
function buildKey(service: string, operation: string, ...args: ReadonlyArray<string>): string {
  return `${CACHE_PREFIX}${service}:${operation}:${args.join(":")}`;
}

/**
 * Get a cached value. Returns null on miss or error.
 */
export async function getCached<T>(
  service: string,
  operation: string,
  ...args: ReadonlyArray<string>
): Promise<T | null> {
  try {
    const redis = getRedis();
    const key = buildKey(service, operation, ...args);
    const raw = await redis.get(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    // Cache miss is not an error — just return null
    return null;
  }
}

/**
 * Set a cached value with optional TTL (defaults to 15 minutes).
 */
export async function setCached<T>(
  service: string,
  operation: string,
  value: T,
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
  ...args: ReadonlyArray<string>
): Promise<void> {
  try {
    const redis = getRedis();
    const key = buildKey(service, operation, ...args);
    await redis.set(key, JSON.stringify(value), "EX", ttlSeconds);
  } catch {
    // Cache write failure is not critical — log and move on
    console.warn("[CACHE] Failed to write cache entry");
  }
}

/**
 * Invalidate a specific cache entry.
 */
export async function invalidateCache(
  service: string,
  operation: string,
  ...args: ReadonlyArray<string>
): Promise<void> {
  try {
    const redis = getRedis();
    const key = buildKey(service, operation, ...args);
    await redis.del(key);
  } catch {
    // Ignore cache invalidation failures
  }
}

/**
 * Invalidate all cache entries for a service.
 */
export async function invalidateServiceCache(service: string): Promise<void> {
  try {
    const redis = getRedis();
    const pattern = `${CACHE_PREFIX}${service}:*`;
    const keys = await redis.keys(pattern);
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  } catch {
    // Ignore
  }
}

/**
 * Wrapper that checks cache first, calls fetcher on miss, and caches the result.
 */
export async function withCache<T>(
  service: string,
  operation: string,
  fetcher: () => Promise<T>,
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
  ...keyArgs: ReadonlyArray<string>
): Promise<T> {
  const cached = await getCached<T>(service, operation, ...keyArgs);
  if (cached !== null) {
    return cached;
  }

  const result = await fetcher();
  await setCached(service, operation, result, ttlSeconds, ...keyArgs);
  return result;
}

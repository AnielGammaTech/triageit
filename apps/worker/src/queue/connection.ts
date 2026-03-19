export interface RedisConnectionOptions {
  readonly host: string;
  readonly port: number;
  readonly username?: string;
  readonly password?: string;
  readonly maxRetriesPerRequest: null;
}

export function getRedisConnectionOptions(): RedisConnectionOptions {
  const url = process.env.REDIS_URL ?? "redis://localhost:6379";
  const parsed = new URL(url);

  console.log(`[REDIS] Connecting to ${parsed.hostname}:${parsed.port || "6379"} (password: ${parsed.password ? "set" : "none"}, username: ${parsed.username || "none"})`);

  return {
    host: parsed.hostname,
    port: parseInt(parsed.port || "6379", 10),
    username: parsed.username || undefined,
    password: parsed.password || undefined,
    maxRetriesPerRequest: null,
  };
}

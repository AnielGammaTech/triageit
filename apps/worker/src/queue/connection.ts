export interface RedisConnectionOptions {
  readonly host: string;
  readonly port: number;
  readonly password?: string;
  readonly maxRetriesPerRequest: null;
}

export function getRedisConnectionOptions(): RedisConnectionOptions {
  const url = process.env.REDIS_URL ?? "redis://localhost:6379";
  const parsed = new URL(url);

  return {
    host: parsed.hostname,
    port: parseInt(parsed.port || "6379", 10),
    password: parsed.password || undefined,
    maxRetriesPerRequest: null,
  };
}

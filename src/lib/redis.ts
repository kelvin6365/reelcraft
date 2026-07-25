import Redis from "ioredis";
import type { RedisOptions } from "ioredis";
import { env } from "@/lib/env";

const g = globalThis as unknown as {
  __rcRedis?: Redis;
  __rcQueueRedis?: Redis;
};

// Lazy handle: `new Redis()` connects immediately, but in DEPLOY_MODE=local
// nothing should ever open a Redis socket (every caller of `redis`/`queueRedis`
// branches to an in-process substitute before touching them). A Proxy defers
// the real connection to first property access — full mode's behavior is
// unchanged (connection still happens, just on first use instead of on
// import, which in practice is immediate anyway).
function lazyRedis(key: "__rcRedis" | "__rcQueueRedis", options: RedisOptions): Redis {
  return new Proxy({} as Redis, {
    get(_target, prop, _receiver) {
      const client = (g[key] ??= new Redis(env.REDIS_URL, options));
      const value = Reflect.get(client, prop, client);
      return typeof value === "function" ? value.bind(client) : value;
    },
  });
}

// App client (cache, pub)
export const redis = lazyRedis("__rcRedis", { maxRetriesPerRequest: 2 });

// BullMQ requires maxRetriesPerRequest: null
export const queueRedis = lazyRedis("__rcQueueRedis", { maxRetriesPerRequest: null });

// Dedicated subscriber connections (caller owns lifecycle)
export function createSubscriber(): Redis {
  return new Redis(env.REDIS_URL, { maxRetriesPerRequest: 2 });
}

export function projectChannel(projectId: string): string {
  return `rc:events:${projectId}`;
}

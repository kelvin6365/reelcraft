import Redis from "ioredis";
import { env } from "@/lib/env";

const g = globalThis as unknown as {
  __rcRedis?: Redis;
  __rcQueueRedis?: Redis;
};

// App client (cache, pub)
export const redis = (g.__rcRedis ??= new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 2,
}));

// BullMQ requires maxRetriesPerRequest: null
export const queueRedis = (g.__rcQueueRedis ??= new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
}));

// Dedicated subscriber connections (caller owns lifecycle)
export function createSubscriber(): Redis {
  return new Redis(env.REDIS_URL, { maxRetriesPerRequest: 2 });
}

export function projectChannel(projectId: string): string {
  return `rc:events:${projectId}`;
}

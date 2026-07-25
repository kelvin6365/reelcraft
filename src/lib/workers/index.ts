// Worker entry — run with: npm run worker (tsx --env-file=.env src/lib/workers/index.ts)
import { Worker } from "bullmq";
import { queueRedis } from "@/lib/redis";
import { env, isLocalMode } from "@/lib/env";
import { prisma } from "@/lib/db";
import { processTask } from "@/lib/workers/processor";
import type { QueueName, TaskJobData } from "@/lib/task/types";

const CONCURRENCY: Record<QueueName, number> = {
  "rc-text": env.QUEUE_CONCURRENCY_TEXT,
  "rc-image": env.QUEUE_CONCURRENCY_IMAGE,
  "rc-video": env.QUEUE_CONCURRENCY_VIDEO,
  "rc-voice": env.QUEUE_CONCURRENCY_VOICE,
};

if (isLocalMode()) {
  // Local mode's worker runs embedded in the Next.js server process
  // (src/instrumentation.ts -> src/lib/task/local-queue.ts). This separate
  // process — still spawned by `npm run dev`'s concurrently leg — must stay a
  // no-op rather than open a BullMQ/Redis connection local mode has no Redis for.
  console.log("[worker] DEPLOY_MODE=local — worker 已內嵌喺 web process，呢個獨立 process 冇嘢做");
} else {
  const workers: Worker<TaskJobData>[] = [];

  for (const [queueName, concurrency] of Object.entries(CONCURRENCY) as [QueueName, number][]) {
    const worker = new Worker<TaskJobData>(
      queueName,
      async (job) => {
        await processTask(queueName, job.data.taskId);
      },
      { connection: queueRedis, concurrency },
    );
    worker.on("ready", () => console.log(`[worker] ${queueName} ready (concurrency ${concurrency})`));
    worker.on("error", (err) => console.error(`[worker] ${queueName} error`, err));
    workers.push(worker);
  }

  const shutdown = async (signal: string) => {
    console.log(`[worker] ${signal} — closing…`);
    await Promise.allSettled(workers.map((w) => w.close()));
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  // Dev convenience: run the watchdog inside the worker process. Without it, a
  // tsx-watch reload mid-task strands 'processing' rows forever (stale heartbeat,
  // nobody requeues → UI shows 生成中 indefinitely). Production keeps its own
  // dedicated watchdog process (Dockerfile) so we skip it there.
  if (env.NODE_ENV !== "production") void import("@/lib/workers/watchdog");

  console.log("[worker] started");
}

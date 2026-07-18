// Worker entry — run with: npm run worker (tsx --env-file=.env src/lib/workers/index.ts)
import { Worker } from "bullmq";
import { queueRedis } from "@/lib/redis";
import { env } from "@/lib/env";
import { withTaskLifecycle } from "@/lib/workers/lifecycle";
import { getHandler } from "@/lib/workers/registry";
import { prisma } from "@/lib/db";
import type { QueueName, TaskJobData, TaskType } from "@/lib/task/types";
import "@/lib/workers/handlers"; // side-effect: registers pipeline handlers

const CONCURRENCY: Record<QueueName, number> = {
  "rc-text": env.QUEUE_CONCURRENCY_TEXT,
  "rc-image": env.QUEUE_CONCURRENCY_IMAGE,
  "rc-video": env.QUEUE_CONCURRENCY_VIDEO,
  "rc-voice": env.QUEUE_CONCURRENCY_VOICE,
};

const workers: Worker<TaskJobData>[] = [];

for (const [queueName, concurrency] of Object.entries(CONCURRENCY) as [QueueName, number][]) {
  const worker = new Worker<TaskJobData>(
    queueName,
    async (job) => {
      const { taskId } = job.data;
      const task = await prisma.task.findUnique({ where: { id: taskId }, select: { type: true } });
      if (!task) return; // task row gone — nothing to do
      await withTaskLifecycle(taskId, getHandler(task.type as TaskType));
    },
    { connection: queueRedis, concurrency },
  );
  worker.on("ready", () => console.log(`[worker] ${queueName} ready (concurrency ${concurrency})`));
  worker.on("error", (err) => console.error(`[worker] ${queueName} error`, err));
  workers.push(worker);
}

async function shutdown(signal: string) {
  console.log(`[worker] ${signal} — closing…`);
  await Promise.allSettled(workers.map((w) => w.close()));
  await prisma.$disconnect();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

console.log("[worker] started");

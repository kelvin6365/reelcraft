// Worker entry — run with: npm run worker (tsx --env-file=.env src/lib/workers/index.ts)
import { Worker } from "bullmq";
import { queueRedis } from "@/lib/redis";
import { env } from "@/lib/env";
import { withTaskLifecycle } from "@/lib/workers/lifecycle";
import { getHandler } from "@/lib/workers/registry";
import { prisma } from "@/lib/db";
import { addTaskJob } from "@/lib/task/queues";
import { acquireSlot, releaseSlot, type GateScope } from "@/lib/quota/gate";
import type { QueueName, TaskJobData, TaskType } from "@/lib/task/types";
import "@/lib/workers/handlers"; // side-effect: registers pipeline handlers

const CONCURRENCY: Record<QueueName, number> = {
  "rc-text": env.QUEUE_CONCURRENCY_TEXT,
  "rc-image": env.QUEUE_CONCURRENCY_IMAGE,
  "rc-video": env.QUEUE_CONCURRENCY_VIDEO,
  "rc-voice": env.QUEUE_CONCURRENCY_VOICE,
};

// Which queues gate per-user concurrency, and the env-driven slot limit for each.
// text/voice are cheap → ungated. Slots self-expire after 15min (crashed-worker safety).
const GATE_TTL_SEC = 15 * 60;
const QUEUE_GATE: Partial<Record<QueueName, { scope: GateScope; limit: number }>> = {
  "rc-image": { scope: "image", limit: env.QUOTA_USER_CONCURRENT_IMAGE },
  "rc-video": { scope: "video", limit: env.QUOTA_USER_CONCURRENT_VIDEO },
};

const REQUEUE_DELAY_MS = 5_000;

const workers: Worker<TaskJobData>[] = [];

for (const [queueName, concurrency] of Object.entries(CONCURRENCY) as [QueueName, number][]) {
  const gate = QUEUE_GATE[queueName];
  const worker = new Worker<TaskJobData>(
    queueName,
    async (job) => {
      const { taskId } = job.data;
      const task = await prisma.task.findUnique({ where: { id: taskId }, select: { type: true, userId: true } });
      if (!task) return; // task row gone — nothing to do

      // Gated queues: take a per-user slot before doing any work. If the user is at
      // their concurrency cap, requeue with a delay WITHOUT claiming the task (it stays
      // 'queued'), so another user's job isn't starved behind this one.
      if (gate) {
        const token = await acquireSlot(task.userId, gate.scope, gate.limit, GATE_TTL_SEC);
        if (!token) {
          await addTaskJob(queueName, taskId, REQUEUE_DELAY_MS);
          return;
        }
        try {
          await withTaskLifecycle(taskId, getHandler(task.type as TaskType));
        } finally {
          await releaseSlot(task.userId, gate.scope, token);
        }
        return;
      }

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

// Dev convenience: run the watchdog inside the worker process. Without it, a
// tsx-watch reload mid-task strands 'processing' rows forever (stale heartbeat,
// nobody requeues → UI shows 生成中 indefinitely). Production keeps its own
// dedicated watchdog process (Dockerfile) so we skip it there.
if (env.NODE_ENV !== "production") void import("@/lib/workers/watchdog");

console.log("[worker] started");

// Worker entry — run with: npm run worker (tsx --env-file=.env src/lib/workers/index.ts)
import { Worker } from "bullmq";
import { queueRedis } from "@/lib/redis";
import { env, isLocalMode } from "@/lib/env";
import { prisma } from "@/lib/db";
import { processTask } from "@/lib/workers/processor";
import { releaseActiveTasks } from "@/lib/workers/lifecycle";
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
    // 先俾機會 graceful drain。⚠️ 一定要等 drain 逾時、確認我哋放棄咗嗰啲 job
    // 之後至可以交還 —— 邊做緊邊交還會令另一個 worker 同時claim 同一個 task，
    // 兩個 process 一齊跑同一件事。
    const drained = await Promise.race([
      Promise.allSettled(workers.map((w) => w.close())).then(() => true),
      new Promise<boolean>((r) => setTimeout(() => r(false), env.WORKER_SHUTDOWN_DRAIN_MS)),
    ]);

    if (!drained) {
      // 逾時：force close（即刻放棄在途 job、唔再續 lock），然後交還手上嘅 task
      // 等新 process 一開就接得返手，唔使等 heartbeat timeout（90s）+ watchdog
      // tick（30s）。provider request journal 保證接返嗰陣係續 poll 而唔係重新
      // submit，所以「放棄」嘅成本近乎零。
      await Promise.allSettled(workers.map((w) => w.close(true)));
      const released = await releaseActiveTasks();
      if (released > 0) console.log(`[worker] 交還咗 ${released} 個在途 task，等新 process 續接`);
    }
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

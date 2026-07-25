import { EventEmitter } from "node:events";
import { prisma } from "@/lib/db";
import { redis, createSubscriber, projectChannel } from "@/lib/redis";
import { isLocalMode } from "@/lib/env";

export type TaskEventType =
  | "CREATED"
  | "PROCESSING"
  | "PROGRESS"
  | "COMPLETED"
  | "FAILED"
  | "RETRYING"
  | "CANCELED";

export interface TaskEventPayload {
  taskId: string;
  taskType: string;
  eventType: TaskEventType;
  // which row this task acts on (e.g. targetType "shot" + shot id) — lets the UI
  // map events onto individual cells instead of whole stages
  targetType?: string;
  targetId?: string;
  progress?: number;
  errorCode?: string | null;
  data?: unknown;
}

// Local-mode substitute for Redis pub/sub: single process, so a plain
// EventEmitter carries the same "publish to a project channel, subscribe to
// it" surface (docs/plans/2026-07-25-local-quickstart-design.md §3). Many SSE
// connections can subscribe to the same project — raise the default cap.
const localBus = new EventEmitter();
localBus.setMaxListeners(0);

function localChannel(projectId: string): string {
  return `local:${projectId}`;
}

// Persists to task_events (SSE replay source) and publishes live — Redis
// pub/sub in full mode, the in-process bus in local mode. Fire-and-forget:
// eventing must never break the task flow.
export function publishTaskEvent(projectId: string | null, ev: TaskEventPayload): void {
  void prisma.taskEvent
    .create({
      data: {
        taskId: ev.taskId,
        eventType: ev.eventType,
        payload: { taskType: ev.taskType, targetType: ev.targetType, targetId: ev.targetId, progress: ev.progress, errorCode: ev.errorCode, data: ev.data } as object,
      },
    })
    .then((row) => {
      if (!projectId) return;
      const message = JSON.stringify({ id: String(row.id), ...ev });
      if (isLocalMode()) {
        localBus.emit(localChannel(projectId), message);
      } else {
        void redis.publish(projectChannel(projectId), message).catch(() => {});
      }
    })
    .catch((err) => console.error("[task-event] write failed", { taskId: ev.taskId, err: String(err) }));
}

export interface ProjectEventSubscription {
  /** Idempotent — safe to call more than once. */
  close: () => void;
}

// Unified live-event subscription for a project, used by the SSE route
// (src/app/api/sse/route.ts). Full mode opens a dedicated Redis subscriber
// connection (same behavior as before this existed — just extracted here so
// the route doesn't need to branch on mode); local mode attaches an
// EventEmitter listener. Same onMessage(message: string) callback either way.
export async function subscribeProjectEvents(
  projectId: string,
  onMessage: (message: string) => void,
): Promise<ProjectEventSubscription> {
  if (isLocalMode()) {
    const channel = localChannel(projectId);
    const listener = (message: string) => onMessage(message);
    localBus.on(channel, listener);
    let closed = false;
    return {
      close: () => {
        if (closed) return;
        closed = true;
        localBus.off(channel, listener);
      },
    };
  }

  const subscriber = createSubscriber();
  try {
    await subscriber.subscribe(projectChannel(projectId));
  } catch (err) {
    void subscriber.quit().catch(() => {});
    throw err;
  }
  subscriber.on("message", (_ch, message) => onMessage(message));

  let closed = false;
  return {
    close: () => {
      if (closed) return;
      closed = true;
      void subscriber.quit().catch(() => {});
    },
  };
}

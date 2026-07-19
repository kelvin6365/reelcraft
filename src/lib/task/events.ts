import { prisma } from "@/lib/db";
import { redis, projectChannel } from "@/lib/redis";

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

// Persists to task_events (SSE replay source) and publishes to Redis for live SSE.
// Fire-and-forget: eventing must never break the task flow.
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
      if (projectId) {
        void redis
          .publish(projectChannel(projectId), JSON.stringify({ id: String(row.id), ...ev }))
          .catch(() => {});
      }
    })
    .catch((err) => console.error("[task-event] write failed", { taskId: ev.taskId, err: String(err) }));
}

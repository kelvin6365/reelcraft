import type { TaskHandler } from "@/lib/workers/lifecycle";
import { TASK_TYPE, TaskError, type TaskType } from "@/lib/task/types";

// Handler registry — M1-T4 fills the pipeline handlers in src/lib/workers/handlers/.
const handlers = new Map<TaskType, TaskHandler>();

export function registerHandler(type: TaskType, handler: TaskHandler): void {
  handlers.set(type, handler);
}

export function getHandler(type: TaskType): TaskHandler {
  const h = handlers.get(type);
  if (!h) throw new TaskError("NO_HANDLER", `no handler registered for task type: ${type}`);
  return h;
}

// Dev/test handler: echoes payload, supports {sleepMs} to simulate long work
// (used by the kill-worker recovery acceptance test) and {fail} to simulate errors.
registerHandler(TASK_TYPE.TEST_ECHO, async ({ task, reportProgress }) => {
  const payload = task.payload as { sleepMs?: number; fail?: "retryable" | "terminal" };
  const sleepMs = payload.sleepMs ?? 0;
  const steps = Math.max(1, Math.ceil(sleepMs / 1000));
  for (let i = 0; i < steps; i++) {
    if (sleepMs > 0) await new Promise((r) => setTimeout(r, Math.min(1000, sleepMs)));
    reportProgress(((i + 1) / (steps + 1)) * 100);
  }
  if (payload.fail === "retryable") throw new TaskError("TEST_RETRYABLE", "simulated transient failure", true);
  if (payload.fail === "terminal") throw new TaskError("TEST_TERMINAL", "simulated terminal failure", false);
  return { echoed: payload };
});

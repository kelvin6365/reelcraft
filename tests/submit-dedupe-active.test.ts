// dedupeActive: a manual "generate" click while the same (type, targetId) task is
// still queued/processing must return the running task instead of enqueuing (and
// paying for) a second one — payload {at: Date.now()} defeats dedupeKey on purpose,
// so this pre-check is the double-submit guard.
import { beforeEach, describe, expect, it, vi } from "vitest";

const { taskFindFirst, taskFindUnique, taskCreate, addTaskJob } = vi.hoisted(() => ({
  taskFindFirst: vi.fn(),
  taskFindUnique: vi.fn(async () => null),
  taskCreate: vi.fn(),
  addTaskJob: vi.fn(async () => {}),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    task: { findFirst: taskFindFirst, findUnique: taskFindUnique, create: taskCreate, update: vi.fn(async () => ({})) },
  },
}));
vi.mock("@/lib/task/queues", () => ({ addTaskJob }));
vi.mock("@/lib/task/events", () => ({ publishTaskEvent: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/quota/daily", () => ({
  checkDailyQuota: vi.fn(async () => {}),
  dailyApiTypeForTask: vi.fn(() => null),
  refundDailyQuota: vi.fn(async () => {}),
}));
vi.mock("@/lib/billing/quote", () => ({ estimateTaskCost: vi.fn(async () => 0) }));
vi.mock("@/lib/billing/ledger", () => ({
  freezeBalance: vi.fn(async () => {}),
  rollbackTaskFreeze: vi.fn(async () => {}),
  InsufficientBalanceError: class extends Error {},
}));
vi.mock("@/lib/env", () => ({ env: { BILLING_MODE: "SHADOW" } }));

import { submitTask } from "@/lib/task/submit";

beforeEach(() => {
  vi.clearAllMocks();
  taskFindUnique.mockResolvedValue(null);
  taskCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => data);
});

const input = {
  userId: "u1",
  type: "VIDEO_SHOT" as never,
  targetType: "shot",
  targetId: "shot-1",
  projectId: "p1",
  episodeId: "e1",
  payload: { at: 12345 },
  dedupeActive: true,
};

describe("submitTask dedupeActive", () => {
  it("returns the running task without creating a new one", async () => {
    taskFindFirst.mockResolvedValue({ id: "running-task" });
    const res = await submitTask(input);
    expect(res).toEqual({ taskId: "running-task", deduped: true });
    expect(taskCreate).not.toHaveBeenCalled();
    expect(addTaskJob).not.toHaveBeenCalled();
  });

  it("creates a fresh task when nothing is active", async () => {
    taskFindFirst.mockResolvedValue(null);
    const res = await submitTask(input);
    expect(res.deduped).toBe(false);
    expect(taskCreate).toHaveBeenCalledOnce();
    expect(addTaskJob).toHaveBeenCalledOnce();
    // guard only scans ACTIVE statuses on the same (userId, type, targetId)
    expect(taskFindFirst).toHaveBeenCalledWith({
      where: { userId: "u1", type: "VIDEO_SHOT", targetId: "shot-1", status: { in: ["queued", "processing"] } },
      select: { id: true },
    });
  });

  it("skips the pre-check when dedupeActive is not set (batch path untouched)", async () => {
    taskFindFirst.mockResolvedValue({ id: "running-task" });
    const res = await submitTask({ ...input, dedupeActive: undefined });
    expect(taskFindFirst).not.toHaveBeenCalled();
    expect(res.deduped).toBe(false);
    expect(taskCreate).toHaveBeenCalledOnce();
  });
});

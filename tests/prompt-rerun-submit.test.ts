// Slice 3 (edit-and-rerun): the prompt-rerun route submits via submitTask WITHOUT
// dedupeActive (see src/lib/task/submit.ts:20-27 — dedupeActive collapses on
// (type, targetId) ignoring payload, which would silently hand back a RUNNING
// task's id and drop the user's edited prompt). This exercises submitTask
// directly, the same layer prompt-rerun/route.ts calls through
// submitEpisodeTask, confirming a rerun with a distinct promptOverrides
// payload always creates a fresh task even while another task is active.
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

const baseInput = {
  userId: "u1",
  type: "REWRITE_SCRIPT" as never,
  targetType: "episode",
  targetId: "ep-1",
  projectId: "p1",
  episodeId: "ep-1",
};

describe("prompt-rerun submit (no dedupeActive)", () => {
  it("creates a fresh task for a rerun even though the pre-check target is 'active' elsewhere", async () => {
    // findFirst is only consulted by the route's own 409 guard, never by
    // submitTask itself when dedupeActive is unset — confirm submitTask
    // doesn't call it at all on this path.
    taskFindFirst.mockResolvedValue({ id: "some-other-active-task" });

    const res = await submitTask({
      ...baseInput,
      payload: { at: 1, promptOverrides: { rewrite_script: "first edit" } },
    });

    expect(taskFindFirst).not.toHaveBeenCalled();
    expect(res.deduped).toBe(false);
    expect(taskCreate).toHaveBeenCalledOnce();
  });

  it("a second rerun with different override text gets a distinct dedupeKey / new task", async () => {
    const created: string[] = [];
    taskCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
      created.push(data.dedupeKey as string);
      return data;
    });

    await submitTask({ ...baseInput, payload: { at: 1, promptOverrides: { rewrite_script: "first edit" } } });
    await submitTask({ ...baseInput, payload: { at: 1, promptOverrides: { rewrite_script: "second edit" } } });

    expect(taskCreate).toHaveBeenCalledTimes(2);
    expect(created[0]).not.toEqual(created[1]);
  });
});

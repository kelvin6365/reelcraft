// Regression: the status-guarded terminal writes in withTaskLifecycle prevent a
// watchdog-requeued task (taken over by a second worker) from being double-
// completed / double-settled. We assert the DB-level guard directly: an
// updateMany scoped to status:'processing' is a no-op once the row left that state.
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { newId } from "@/lib/ids";

const email = `lifecycle-guard-${newId()}@test.local`;
let userId: string;

async function makeTask(status: string) {
  if (!userId) {
    const u = await prisma.user.create({ data: { id: newId(), name: "lg", email } });
    userId = u.id;
  }
  return prisma.task.create({
    data: { id: newId(), userId, type: "TEST_ECHO", dedupeKey: newId(), status },
  });
}

afterAll(async () => {
  await prisma.task.deleteMany({ where: { userId } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
});

describe("lifecycle terminal guard", () => {
  it("completes a processing task exactly once", async () => {
    const task = await makeTask("processing");
    const first = await prisma.task.updateMany({
      where: { id: task.id, status: "processing" },
      data: { status: "completed", progress: 100 },
    });
    const second = await prisma.task.updateMany({
      where: { id: task.id, status: "processing" },
      data: { status: "completed", progress: 100 },
    });
    expect(first.count).toBe(1);
    expect(second.count).toBe(0); // the losing worker no-ops — no double settle
  });

  it("does not resurrect a task the watchdog already failed", async () => {
    const task = await makeTask("failed"); // watchdog terminalized it
    const won = await prisma.task.updateMany({
      where: { id: task.id, status: "processing" },
      data: { status: "completed" },
    });
    expect(won.count).toBe(0); // the slow worker cannot overwrite the terminal state
    const fresh = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(fresh.status).toBe("failed");
  });
});

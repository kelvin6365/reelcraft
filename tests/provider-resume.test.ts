// Worker 重啟之後，在途嘅 provider request 必須續 poll 而唔係重新 submit
// （src/lib/ai/request-journal.ts）。呢個係「worker 一 restart 就丟資源／俾兩次錢」
// 嘅根治測試。
import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.DATABASE_URL ??= "postgres://user:pw@localhost:5432/test";
process.env.REDIS_URL ??= "redis://localhost:6379";
process.env.STORAGE_ENDPOINT ??= "http://localhost:9000";
process.env.STORAGE_BUCKET ??= "test";
process.env.STORAGE_ACCESS_KEY ??= "test";
process.env.STORAGE_SECRET_KEY ??= "test";
process.env.BETTER_AUTH_SECRET ??= "x".repeat(32);
process.env.BETTER_AUTH_URL ??= "http://localhost:3000";
process.env.API_ENCRYPTION_KEY ??= "y".repeat(32);

interface Row {
  id: string;
  userId: string;
  taskId: string;
  stepKey: string;
  provider: string;
  apiType: string;
  modelKey: string;
  endpoint: string;
  requestId: string;
  status: string;
  mediaId: string | null;
  errorCode: string | null;
  createdAt: Date;
}

// 極簡 in-memory providerRequest —— 只實作 journal 用到嗰幾隻 query。
const db = vi.hoisted(() => ({ rows: [] as Row[], tasks: [] as { id: string; status: string }[] }));

function matches(row: Row, where: Record<string, unknown>): boolean {
  for (const [k, v] of Object.entries(where)) {
    const actual = (row as unknown as Record<string, unknown>)[k];
    if (v && typeof v === "object") {
      const cond = v as { startsWith?: string; gte?: Date; lt?: Date; in?: unknown[] };
      if (cond.startsWith !== undefined && !String(actual).startsWith(cond.startsWith)) return false;
      if (cond.gte !== undefined && !((actual as Date) >= cond.gte)) return false;
      if (cond.lt !== undefined && !((actual as Date) < cond.lt)) return false;
      if (cond.in !== undefined && !cond.in.includes(actual)) return false;
    } else if (actual !== v) return false;
  }
  return true;
}

vi.mock("@/lib/db", () => ({
  prisma: {
    providerRequest: {
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
        db.rows.filter((r) => matches(r, where)).at(-1) ?? null,
      ),
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => db.rows.filter((r) => matches(r, where))),
      create: vi.fn(async ({ data }: { data: Omit<Row, "mediaId" | "errorCode" | "createdAt"> }) => {
        db.rows.push({ ...data, mediaId: null, errorCode: null, createdAt: new Date() });
        return data;
      }),
      updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Partial<Row> }) => {
        const hit = db.rows.filter((r) => matches(r, where));
        for (const r of hit) Object.assign(r, data);
        return { count: hit.length };
      }),
      deleteMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) => {
        const before = db.rows.length;
        db.rows = db.rows.filter((r) => !where.id.in.includes(r.id));
        return { count: before - db.rows.length };
      }),
    },
    task: {
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] }; status: { in: string[] } } }) =>
        db.tasks.filter((t) => where.id.in.includes(t.id) && where.status.in.includes(t.status)),
      ),
    },
  },
}));

vi.mock("@/lib/ai/provider-key", () => ({ getProviderKey: vi.fn(async () => "k") }));
const canceled = vi.hoisted(() => ({ ids: [] as string[] }));
vi.mock("@/lib/ai/adapters/fal", () => ({
  falCancel: vi.fn(async (h: { requestId: string }) => void canceled.ids.push(h.requestId)),
}));
vi.mock("@/lib/ai/adapters/atlascloud", () => ({
  atlasCancel: vi.fn(async () => {
    throw new Error("no cancel endpoint");
  }),
}));

const { runJournaled, markConsumed, cancelPendingForTask, sweepStalePending, pruneTerminalRequests } = await import(
  "@/lib/ai/request-journal"
);
const { AiError } = await import("@/lib/ai/types");

const META = { provider: "fal" as const, apiType: "image" as const, modelKey: "fal::m", descriptor: { prompt: "a cat" } };
const CTX = { userId: "u1", taskId: "t1" };

beforeEach(() => {
  db.rows = [];
  db.tasks = [];
  canceled.ids = [];
});

describe("runJournaled", () => {
  it("submit 一成功即刻寫低 handle —— poll 之前", async () => {
    let rowsAtPollTime = 0;
    const out = await runJournaled(CTX, META, {
      submit: async () => ({ endpoint: "fal-ai/m", requestId: "req-1" }),
      poll: async () => {
        rowsAtPollTime = db.rows.length;
        return "https://cdn/out.png";
      },
    });

    expect(rowsAtPollTime).toBe(1); // ← 重點：poll 之前已經落咗地
    expect(out.result).toBe("https://cdn/out.png");
    expect(db.rows[0]).toMatchObject({ taskId: "t1", provider: "fal", requestId: "req-1", status: "pending" });
  });

  it("worker 死喺 poll 中途：下一次同一步唔會再 submit，而係續 poll 同一個 request", async () => {
    const submit = vi.fn(async () => ({ endpoint: "fal-ai/m", requestId: "req-1" }));

    // 第一次：submit 成功，poll 途中 worker 死（retryable 超時）
    await expect(
      runJournaled(CTX, META, {
        submit,
        poll: async () => {
          throw new AiError("FAL_TIMEOUT", "timed out", true);
        },
      }),
    ).rejects.toThrow("timed out");
    expect(db.rows[0].status).toBe("pending"); // retryable → 留返俾下次續接

    // 重啟後重試同一步
    const polled: string[] = [];
    const out = await runJournaled(CTX, META, {
      submit,
      poll: async (h) => {
        polled.push(h.requestId);
        return "https://cdn/out.png";
      },
    });

    expect(submit).toHaveBeenCalledTimes(1); // ← 冇第二次 submit
    expect(polled).toEqual(["req-1"]);
    expect(out.handle.requestId).toBe("req-1");
    expect(db.rows).toHaveLength(1);
  });

  it("terminal 失敗會標 failed，下次重試重新 submit", async () => {
    const submit = vi
      .fn()
      .mockResolvedValueOnce({ endpoint: "fal-ai/m", requestId: "req-1" })
      .mockResolvedValueOnce({ endpoint: "fal-ai/m", requestId: "req-2" });

    await expect(
      runJournaled(CTX, META, {
        submit,
        poll: async () => {
          throw new AiError("FAL_FAILED", "provider says failed", false);
        },
      }),
    ).rejects.toThrow("provider says failed");
    expect(db.rows[0]).toMatchObject({ status: "failed", errorCode: "FAL_FAILED" });

    const out = await runJournaled(CTX, META, { submit, poll: async () => "https://cdn/out.png" });
    expect(submit).toHaveBeenCalledTimes(2);
    expect(out.handle.requestId).toBe("req-2");
  });

  it("已收貨（consumed）嘅一步唔會被重用 —— 原樣重試要真係再生成一次", async () => {
    const submit = vi
      .fn()
      .mockResolvedValueOnce({ endpoint: "fal-ai/m", requestId: "req-1" })
      .mockResolvedValueOnce({ endpoint: "fal-ai/m", requestId: "req-2" });

    const first = await runJournaled(CTX, META, { submit, poll: async () => "https://cdn/a.png" });
    await markConsumed(first.journalId, "media-1");
    expect(db.rows[0]).toMatchObject({ status: "consumed", mediaId: "media-1" });

    const second = await runJournaled(CTX, META, { submit, poll: async () => "https://cdn/b.png" });
    expect(submit).toHaveBeenCalledTimes(2);
    expect(second.handle.requestId).toBe("req-2");
    expect(db.rows).toHaveLength(2);
  });

  it("過咗續接窗口嘅 pending 唔會再續 —— 重新 submit", async () => {
    const submit = vi
      .fn()
      .mockResolvedValueOnce({ endpoint: "fal-ai/m", requestId: "req-1" })
      .mockResolvedValueOnce({ endpoint: "fal-ai/m", requestId: "req-2" });

    await expect(
      runJournaled(CTX, META, {
        submit,
        poll: async () => {
          throw new AiError("FAL_TIMEOUT", "timed out", true);
        },
      }),
    ).rejects.toThrow();
    db.rows[0].createdAt = new Date(Date.now() - 24 * 60 * 60 * 1000); // 一日前

    const out = await runJournaled(CTX, META, { submit, poll: async () => "https://cdn/out.png" });
    expect(submit).toHaveBeenCalledTimes(2);
    expect(out.handle.requestId).toBe("req-2");
  });

  it("冇 taskId（smoke／一次性呼叫）就唔寫 journal，行為同以前一樣", async () => {
    const out = await runJournaled({ userId: "u1" }, META, {
      submit: async () => ({ endpoint: "fal-ai/m", requestId: "req-1" }),
      poll: async () => "https://cdn/out.png",
    });
    expect(out.journalId).toBeNull();
    expect(db.rows).toHaveLength(0);
  });
});

describe("cancelPendingForTask", () => {
  it("叫停在途 request 並標 canceled", async () => {
    await runJournaled(CTX, META, {
      submit: async () => ({ endpoint: "fal-ai/m", requestId: "req-1" }),
      poll: async () => {
        throw new AiError("FAL_TIMEOUT", "timed out", true);
      },
    }).catch(() => {});

    expect(await cancelPendingForTask("t1")).toBe(1);
    expect(canceled.ids).toEqual(["req-1"]);
    expect(db.rows[0].status).toBe("canceled");
  });

  it("provider cancel 失敗（例如 atlascloud 冇 endpoint）都照標 canceled", async () => {
    await runJournaled(CTX, { ...META, provider: "atlascloud" }, {
      submit: async () => ({ endpoint: "generateImage", requestId: "pred-1" }),
      poll: async () => {
        throw new AiError("FAL_TIMEOUT", "timed out", true);
      },
    }).catch(() => {});

    expect(await cancelPendingForTask("t1")).toBe(1);
    expect(db.rows[0].status).toBe("canceled");
  });
});

describe("sweepStalePending", () => {
  it("task 仲行緊嘅唔會掃，已終結嘅先掃", async () => {
    const stale = new Date(Date.now() - 24 * 60 * 60 * 1000);
    db.rows = [
      { ...base("live", "t-live", "req-live"), createdAt: stale },
      { ...base("dead", "t-dead", "req-dead"), createdAt: stale },
      { ...base("fresh", "t-dead", "req-fresh"), createdAt: new Date() },
    ];
    db.tasks = [{ id: "t-live", status: "processing" }];

    expect(await sweepStalePending()).toBe(1);
    expect(canceled.ids).toEqual(["req-dead"]);
    expect(db.rows.find((r) => r.id === "live")!.status).toBe("pending");
    expect(db.rows.find((r) => r.id === "fresh")!.status).toBe("pending");
  });
});

describe("pruneTerminalRequests", () => {
  it("只刪過咗保留期嘅 terminal 行；pending 幾舊都唔掂", async () => {
    const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 日前
    db.rows = [
      { ...base("a", "t1", "req-a"), status: "consumed", createdAt: old },
      { ...base("b", "t1", "req-b"), status: "failed", createdAt: old },
      { ...base("c", "t1", "req-c"), status: "canceled", createdAt: old },
      { ...base("d", "t1", "req-d"), status: "pending", createdAt: old }, // 唔准刪
      { ...base("e", "t1", "req-e"), status: "consumed", createdAt: new Date() }, // 未到期
    ];

    expect(await pruneTerminalRequests()).toBe(3);
    expect(db.rows.map((r) => r.id).sort()).toEqual(["d", "e"]);
  });

  it("冇嘢好刪就唔會發 delete", async () => {
    db.rows = [{ ...base("a", "t1", "req-a"), status: "consumed", createdAt: new Date() }];
    expect(await pruneTerminalRequests()).toBe(0);
    expect(db.rows).toHaveLength(1);
  });
});

function base(id: string, taskId: string, requestId: string): Row {
  return {
    id,
    userId: "u1",
    taskId,
    stepKey: `${id}#${requestId}`,
    provider: "fal",
    apiType: "image",
    modelKey: "fal::m",
    endpoint: "fal-ai/m",
    requestId,
    status: "pending",
    mediaId: null,
    errorCode: null,
    createdAt: new Date(),
  };
}

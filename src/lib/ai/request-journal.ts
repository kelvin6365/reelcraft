// Provider request journal —— 生成請求嘅斷點續傳。
//
// 問題：媒體生成係 submit → poll（可以行足 10 分鐘）。以前 request_id 淨係
// 存喺記憶體，worker 一重啟（dev 嘅 tsx watch、deploy、OOM、被 BullMQ 當
// stalled），watchdog 會把 task 打返 queued 重跑 → 重新 submit。fal 嗰邊舊
// request 繼續跑到完，冇人收貨：錢照計、GPU 時間丟咗、用戶等多一轉。
//
// 做法：submit 一成功、poll 之前，即刻寫一行 provider_requests。下次同一個
// task 行到同一步，見到有未收貨嘅 handle 就跳過 submit，攞返同一個 requestId
// 續 poll（provider 嘅 status/result endpoint 係冪等嘅）。
//
// 只喺有 ctx.taskId 嘅時候先寫 journal —— smoke script／一次性呼叫冇 task 可以
// 重入，行為同以前一樣。
import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { newId } from "@/lib/ids";
import { AiError, type CallContext } from "@/lib/ai/types";
import { falCancel } from "@/lib/ai/adapters/fal";
import { atlasCancel } from "@/lib/ai/adapters/atlascloud";
import { getProviderKey } from "@/lib/ai/provider-key";

export type JournalProvider = "fal" | "atlascloud";

// 一條在途 provider request 嘅座標 —— 兩個 adapter 嘅 handle 都係呢個形狀。
export interface ProviderHandle {
  endpoint: string;
  requestId: string;
}

export interface JournalMeta {
  provider: JournalProvider;
  apiType: "image" | "video" | "tts";
  modelKey: string;
  // 呢一步生成嘅穩定描述（用 mediaId 而唔係 data URI，跨重啟要一模一樣）。
  descriptor: unknown;
}

export interface JournaledOutcome<R> {
  result: R;
  // 收貨（createMediaFromUrl）成功之後，呼叫 markConsumed 收尾；冇 journal 就係 null。
  journalId: string | null;
  // 實際用咗嘅 provider handle（新 submit 或者續接返嚟嗰個）—— 入 AiCallLog 用。
  handle: ProviderHandle;
}

// 描述 hash —— 同一個 task 入面用嚟認返「係咪同一步生成」。
export function stepHash(descriptor: unknown): string {
  return createHash("sha256").update(JSON.stringify(descriptor ?? null)).digest("hex").slice(0, 32);
}

export async function runJournaled<R>(
  ctx: CallContext,
  meta: JournalMeta,
  ops: { submit: () => Promise<ProviderHandle>; poll: (handle: ProviderHandle) => Promise<R> },
): Promise<JournaledOutcome<R>> {
  const taskId = ctx.taskId;
  if (!taskId) {
    const oneOff = await ops.submit();
    return { result: await ops.poll(oneOff), journalId: null, handle: oneOff };
  }

  const prefix = `${stepHash(meta.descriptor)}#`;
  const cutoff = new Date(Date.now() - env.PROVIDER_RESUME_MAX_AGE_MS);

  // 續接候選：同一 task／同一步、仲係 pending、未過窗口。terminal（consumed/
  // failed/canceled）嘅行刻意唔重用 —— 例如 handler 判咗張圖唔合格要「原樣重試
  // 一次」，嗰次一定要真係重新 submit。
  const resumable = await prisma.providerRequest.findFirst({
    where: { taskId, stepKey: { startsWith: prefix }, status: "pending", createdAt: { gte: cutoff } },
    orderBy: { createdAt: "desc" },
  });

  let journalId: string;
  let handle: ProviderHandle;

  if (resumable) {
    journalId = resumable.id;
    handle = { endpoint: resumable.endpoint, requestId: resumable.requestId };
    console.log(
      `[journal] resume ${meta.provider} ${meta.apiType} request=${handle.requestId} task=${taskId} —— 跳過 submit，續 poll`,
    );
  } else {
    handle = await ops.submit();
    journalId = newId();
    // ⚠️ 呢個 create 一定要喺 poll 之前完成 —— 成個方案嘅重點就係「未 poll 之前
    // 已經有 handle 落咗地」。
    await prisma.providerRequest.create({
      data: {
        id: journalId,
        userId: ctx.userId,
        taskId,
        stepKey: `${prefix}${handle.requestId}`,
        provider: meta.provider,
        apiType: meta.apiType,
        modelKey: meta.modelKey,
        endpoint: handle.endpoint,
        requestId: handle.requestId,
        status: "pending",
      },
    });
  }

  try {
    return { result: await ops.poll(handle), journalId, handle };
  } catch (err) {
    // Retryable（超時／429／5xx）→ 留返 pending，下一次 attempt 續 poll 同一條
    // request。Terminal（provider 報 FAILED、輸出缺失）→ 標 failed，重試時重新 submit。
    const retryable = err instanceof AiError && err.retryable;
    if (!retryable) {
      await prisma.providerRequest
        .updateMany({
          where: { id: journalId, status: "pending" },
          data: { status: "failed", errorCode: err instanceof AiError ? err.code : "UNKNOWN" },
        })
        .catch(() => {});
    }
    throw err;
  }
}

// 收貨完成（媒體已經落到 MediaObject）——呢行再冇續接價值。
export async function markConsumed(journalId: string | null, mediaId: string): Promise<void> {
  if (!journalId) return;
  await prisma.providerRequest
    .updateMany({ where: { id: journalId, status: "pending" }, data: { status: "consumed", mediaId } })
    .catch((err) => console.error("[journal] markConsumed failed", { journalId, err: String(err) }));
}

async function cancelOne(row: {
  id: string;
  userId: string;
  provider: string;
  endpoint: string;
  requestId: string;
}): Promise<boolean> {
  const handle = { endpoint: row.endpoint, requestId: row.requestId };
  try {
    const apiKey = await getProviderKey(row.userId, row.provider);
    if (row.provider === "fal") await falCancel(handle, apiKey);
    else await atlasCancel(handle, apiKey);
    return true;
  } catch (err) {
    // Best-effort：request 可能已經完成／provider 冇 cancel endpoint。照標
    // canceled（我哋唔會再收貨），只留一行 log 方便追數。
    console.warn(`[journal] cancel ${row.provider} ${row.requestId} 失敗（照標 canceled）`, String(err));
    return false;
  }
}

// Task 取消／終局失敗時叫：把仲喺度燒 GPU 嘅 request 叫停。
// ⚠️ 唔好喺 retryable 重試路徑叫 —— 嗰啲正正係要留返嚟續接嘅。
export async function cancelPendingForTask(taskId: string): Promise<number> {
  const rows = await prisma.providerRequest.findMany({ where: { taskId, status: "pending" } });
  for (const row of rows) {
    await cancelOne(row);
    await prisma.providerRequest
      .updateMany({ where: { id: row.id, status: "pending" }, data: { status: "canceled" } })
      .catch(() => {});
  }
  return rows.length;
}

// Watchdog 保留期清理：terminal 行過咗保留期就刪走。每次生成都寫一行，唔清
// 就會變成全庫最大張表。⚠️ 只刪 terminal —— pending 行無論幾舊都要留返（續接
// 交由 sweepStalePending 先標 canceled，下一輪先輪到佢被刪）。
export async function pruneTerminalRequests(limit = 500): Promise<number> {
  const cutoff = new Date(Date.now() - env.PROVIDER_REQUEST_RETENTION_MS);
  const stale = await prisma.providerRequest.findMany({
    where: { status: { in: ["consumed", "failed", "canceled"] }, createdAt: { lt: cutoff } },
    select: { id: true },
    take: limit,
  });
  if (stale.length === 0) return 0;
  const { count } = await prisma.providerRequest.deleteMany({ where: { id: { in: stale.map((r) => r.id) } } });
  return count;
}

// Watchdog 清理：過咗續接窗口、而 task 已經唔喺運行狀態嘅 pending 行。
export async function sweepStalePending(limit = 100): Promise<number> {
  const cutoff = new Date(Date.now() - env.PROVIDER_RESUME_MAX_AGE_MS);
  const rows = await prisma.providerRequest.findMany({
    where: { status: "pending", createdAt: { lt: cutoff } },
    take: limit,
  });
  if (rows.length === 0) return 0;

  const liveTaskIds = new Set(
    (
      await prisma.task.findMany({
        where: { id: { in: rows.map((r) => r.taskId) }, status: { in: ["queued", "processing"] } },
        select: { id: true },
      })
    ).map((t) => t.id),
  );

  let swept = 0;
  for (const row of rows) {
    if (liveTaskIds.has(row.taskId)) continue; // task 仲行緊 → 留返俾佢自己收尾
    await cancelOne(row);
    await prisma.providerRequest
      .updateMany({ where: { id: row.id, status: "pending" }, data: { status: "canceled" } })
      .catch(() => {});
    swept++;
  }
  return swept;
}

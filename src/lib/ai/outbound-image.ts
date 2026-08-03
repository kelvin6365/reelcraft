// Outbound reference-image normalization for character consistency
// (docs/plans/2026-07-19-character-consistency-design.md). Turns locked-asset
// mediaIds into provider-ready base64 data-URIs: fetched from storage, cropped to
// the target output ratio, downscaled + JPEG-compressed (keeps multi-ref payloads
// small), deduped, capped, and partial-failure tolerant — a couple of unreachable
// refs don't sink the shot.
// Only generate-media.ts may import this (guard: no-ai-bypass).
import sharp from "sharp";
import { prisma } from "@/lib/db";
import { getStorage } from "@/lib/storage";
import { AiError } from "@/lib/ai/types";

// ⚠️ 呢個【唔係】語義上嘅參考圖上限，係一個「應該永遠唔會踩到」嘅 payload 保險絲。
// 真正嘅截斷屬於呼叫方：見 shot-assets.ts 嘅 MAX_SHOT_REFS = 3（Gemini 2.5 Flash Image
// 官方「maximum of three images in an input」）。點解唔喺呢層截：prompt 嘅 图片N legend
// 係按呼叫方嗰個陣列編號嘅，如果呢層再靜靜 splice 多一刀，兩邊截斷點唔一致就會令
// legend 同實際送出嘅圖片錯位——模型會照住錯嘅 legend 讀圖。
// 所以呢層刻意設得比任何呼叫方嘅語義上限鬆，而且踩到嗰陣會嗌（唔會靜靜切）。
const MAX_REFS = 6;
const MAX_EDGE = 1024; // downscale longest edge
const JPEG_QUALITY = 80;

// 身份錨定圖（角色近臉特寫）專用門檻。理由：
// 1. Gemini 把輸入切成 768×768 tile——塊臉要至少填滿一個完整 tile 先有足夠 token
//    去承載身份特徵。9:16 嘅圖長邊 1024 → 短邊得 576，連一個 tile 都唔夠闊。
//    短邊要 ≥768 即長邊要 ≥1366（9:16），取 2048 留 headroom。
// 2. ISO/IEC 19794-5 最佳實踐 IED 120px（39794-5 最低 90px）。實測長邊 1024 路徑
//    落嚟塊臉 IED ≈30–40px，低過行業下限一半;走 2048 路徑後大致 ×2。
// 3. JPEG 80 嘅 chroma subsampling 正正食掉眼／唇邊界——身份比對就係睇呢啲，
//    所以呢條路徑用 q92 + 4:4:4 唔做色度抽樣。
// 只有 identityAnchor 走呢條路，其餘參考圖照舊 1024/q80 控 payload 同成本。
const IDENTITY_MAX_EDGE = 2048;
const IDENTITY_JPEG_QUALITY = 92;

export interface ReferenceImageInput {
  mediaId: string;
  // 標明呢張係「身份錨定圖」（角色近臉特寫）：走高解析度／低壓縮路徑，
  // 而且唔會按出圖比例 center-crop（怕切走塊臉）。
  identityAnchor?: boolean;
  // 逼不得已要 crop 嗰陣由邊度切起。預設 centre —— 鏡頭生圖嘅參考圖本身已經係
  // 近臉特寫，中間就係塊臉。
  //
  // ⚠️ "top" 係畀「由全身鎖定圖生近臉特寫」呢條路用嘅。角色鎖定圖係 9:16 全身
  // 正面站姿（768×1344），近臉出圖係 1:1 —— center-crop 落去攞到嘅係 768×768
  // **中段腰腹，完全冇頭冇臉**，而 prompt 同時叫模型「照抄參考圖嘅臉同髮型」。
  // 模型冇臉可抄就唯有作一個，實測近臉特寫同主圖眼色、髮長、服裝全部唔同。
  // 站姿正面圖塊頭一定喺頂部，所以由頂切。
  cropAnchor?: "centre" | "top";
}

export type ReferenceImageRef = string | ReferenceImageInput;

export interface NormalizeReferenceOptions {
  // 目標出圖比例，形如 "9:16"。Gemini 會採用「最後一張輸入圖」嘅比例，
  // 所以參考圖要預先裁到同出圖一致，唔係就會燒死黑邊。
  // parse 唔到就 fallback 返保留原比例嘅 fit:"inside" 行為。
  aspectRatio?: string;
}

interface EncodeOptions {
  targetRatio: number | null;
  identityAnchor: boolean;
  // 係咪陣列最後一張——決定咗佢使唔使為咗比例正確性犧牲面部保真度，見 planEncode。
  isLast: boolean;
  cropAnchor?: "centre" | "top";
}

// 兩個比例差幾多先當「唔同」。5% 嘅相對差足以放行編碼上嘅零頭（角色資產原生
// 768×1344 = 0.5714，對 9:16 = 0.5625 差 1.6%，provider 一樣會出 9:16），
// 但任何有意義嘅比例跳躍都遠遠超標（9:16 vs 16:9 差 216%、vs 1:1 差 78%、
// vs 3:4 差 33%），唔會漏網。
const RATIO_TOLERANCE = 0.05;

export type EncodePlan = "identity" | "identity-crop" | "crop" | "fit-inside";

// 決定一張參考圖行邊條編碼路徑。抽成純函數係為咗可以直接測「最後一張」呢條
// invariant，唔使砌真圖。
//
// 關鍵不變式：**最後一張送出嘅圖必須符合目標出圖比例。** Gemini 官方文檔明文
// 「the model will adopt the aspect ratio of the last image provided」——最後一張
// 比例唔啱，模型就會照佢嘅比例砌構圖再 letterbox 入目標畫布，燒死黑邊。
//
// 呢個令 identityAnchor 喺「排最後」嗰陣要讓步：normalize 唔可以重排（順序係
// load-bearing，prompt 嘅 图片N legend 按呢個陣列編號），而 buildShotRefAssets 嘅
// 排序係 [場景, ...角色]，即係最後一張結構上必然係角色近臉圖。所以最後一張
// identityAnchor 一旦比例唔啱，就無視「唔 crop」嘅保護，照切。
//
// 點解值得犧牲該張嘅面部保真度：黑邊係**確定性**失敗——一旦踩中，該集每一格
// 都燒死，而且冇得補救；面部被切窄係**漸進式降級**——身份特徵仍然大部分保留，
// 而且鏡頭通常仲有其他角色 ref 同純文字外貌描述兜底。確定性災難輸畀漸進降級。
// 注意呢張仍然行 2048/q92/4:4:4 高解析路徑，讓步嘅只係「唔 crop」嗰part。
export function planEncode(opts: {
  identityAnchor: boolean;
  isLast: boolean;
  targetRatio: number | null;
  sourceRatio: number | null;
}): EncodePlan {
  const { identityAnchor, isLast, targetRatio, sourceRatio } = opts;
  // 目標比例 parse 唔到／讀唔到 source 尺寸 → 退回原本保留比例嘅行為，唔炸。
  if (targetRatio === null || sourceRatio === null) return identityAnchor ? "identity" : "fit-inside";
  if (!identityAnchor) return "crop";
  const matches = Math.abs(sourceRatio - targetRatio) / targetRatio <= RATIO_TOLERANCE;
  return isLast && !matches ? "identity-crop" : "identity";
}

// "9:16" / "16:9" / "1:1"，順手收 "16x9" 同 "16/9"。返回 width/height 比值。
// 任何 parse 唔到／非有限／離譜嘅值一律當冇提供（唔炸，退回原比例路徑）。
export function parseAspectRatio(ratio: string | undefined | null): number | null {
  if (!ratio) return null;
  const m = /^\s*(\d+(?:\.\d+)?)\s*[:x/]\s*(\d+(?:\.\d+)?)\s*$/i.exec(ratio);
  if (!m) return null;
  const w = Number(m[1]);
  const h = Number(m[2]);
  if (!(w > 0) || !(h > 0)) return null;
  const r = w / h;
  if (!Number.isFinite(r) || r < 0.05 || r > 20) return null;
  return r;
}

// 算出「切到 targetRatio、又唔使放大」嘅最大 box，再把長邊壓落 maxEdge。
// 注意：唔可以直接用 sharp 嘅 withoutEnlargement 配 fit:"cover"——sharp 會逐邊
// 獨立 clamp，出嚟嘅圖會變返 source 比例（實測 576×1024 → 576×768），黑邊照舊。
export function cropBox(
  src: { width: number; height: number },
  targetRatio: number,
  maxEdge: number,
): { width: number; height: number } {
  const srcRatio = src.width / src.height;
  const [cropW, cropH] =
    srcRatio > targetRatio ? [src.height * targetRatio, src.height] : [src.width, src.width / targetRatio];
  const scale = Math.min(1, maxEdge / Math.max(cropW, cropH));
  return { width: Math.max(1, Math.round(cropW * scale)), height: Math.max(1, Math.round(cropH * scale)) };
}

export async function encodeReferenceImage(raw: Buffer, opts: EncodeOptions): Promise<Buffer> {
  const pipeline = sharp(raw).rotate(); // honor EXIF orientation
  const src = await sourceSize(raw);
  const plan = planEncode({ ...opts, sourceRatio: src ? src.width / src.height : null });
  const identityJpeg = { quality: IDENTITY_JPEG_QUALITY, chromaSubsampling: "4:4:4" } as const;
  const position = opts.cropAnchor ?? "centre";

  switch (plan) {
    case "identity":
      // 近臉特寫唔 center-crop——切走額頭／下巴就冇咗身份資訊。保留原比例，只係唔壓細。
      return pipeline
        .resize(IDENTITY_MAX_EDGE, IDENTITY_MAX_EDGE, { fit: "inside", withoutEnlargement: true })
        .jpeg(identityJpeg)
        .toBuffer();
    case "identity-crop":
      // 排最後 + 比例唔啱：比例正確性贏（見 planEncode 嘅論證）。解析度／壓縮率
      // 照舊行高規格，讓步嘅淨係「唔 crop」。
      // biome-ignore lint/style/noNonNullAssertion: planEncode 只喺兩者皆非 null 先會回呢個 plan
      return pipeline
        .resize({ ...cropBox(src!, opts.targetRatio!, IDENTITY_MAX_EDGE), fit: "cover", position })
        .jpeg(identityJpeg)
        .toBuffer();
    case "crop":
      // biome-ignore lint/style/noNonNullAssertion: 同上
      return pipeline
        .resize({ ...cropBox(src!, opts.targetRatio!, MAX_EDGE), fit: "cover", position })
        .jpeg({ quality: JPEG_QUALITY })
        .toBuffer();
    default:
      return pipeline
        .resize(MAX_EDGE, MAX_EDGE, { fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: JPEG_QUALITY })
        .toBuffer();
  }
}

// EXIF orientation 5–8 代表影像被旋轉 90°，.rotate() 之後 w/h 對調。
async function sourceSize(raw: Buffer): Promise<{ width: number; height: number } | null> {
  const meta = await sharp(raw).metadata();
  if (!meta.width || !meta.height) return null;
  const swapped = (meta.orientation ?? 1) >= 5;
  return swapped ? { width: meta.height, height: meta.width } : { width: meta.width, height: meta.height };
}

async function toDataUri(
  ref: ReferenceImageInput,
  opts: NormalizeReferenceOptions,
  isLast: boolean,
): Promise<string | null> {
  try {
    const media = await prisma.mediaObject.findUnique({ where: { id: ref.mediaId } });
    if (!media) return null;
    const raw = await getStorage().getObjectBuffer(media.storageKey);
    const jpeg = await encodeReferenceImage(raw, {
      targetRatio: parseAspectRatio(opts.aspectRatio),
      identityAnchor: ref.identityAnchor === true,
      cropAnchor: ref.cropAnchor,
      isLast,
    });
    return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
  } catch (err) {
    console.error("[outbound-image] normalize failed", { mediaId: ref.mediaId, err: String(err) });
    return null;
  }
}

// Dedupe by mediaId, preserve first-seen order; identityAnchor is sticky (OR)
// so a duplicate that's flagged anywhere gets the high-resolution path.
export function dedupeReferenceRefs(refs: (ReferenceImageRef | null | undefined)[]): ReferenceImageInput[] {
  const byId = new Map<string, ReferenceImageInput>();
  for (const r of refs) {
    const mediaId = typeof r === "string" ? r : r?.mediaId;
    if (!mediaId) continue;
    const identityAnchor = typeof r === "object" && r !== null && r.identityAnchor === true;
    const cropAnchor = typeof r === "object" && r !== null ? r.cropAnchor : undefined;
    const prev = byId.get(mediaId);
    if (prev) {
      prev.identityAnchor = prev.identityAnchor || identityAnchor;
      // 一旦有任何一處要求由頂切，就跟佢——"top" 係「唔好切走塊頭」嘅明示要求，
      // 而 centre 只係預設值，兩者衝突時保守嗰邊（保住塊臉）贏。
      prev.cropAnchor = prev.cropAnchor ?? cropAnchor;
    } else byId.set(mediaId, { mediaId, identityAnchor, cropAnchor });
  }
  const all = [...byId.values()];
  if (all.length > MAX_REFS) {
    // 踩到保險絲 = 有呼叫方冇喺自己嗰層截斷，legend 已經同實際圖片錯位。
    console.error("[outbound-image] reference count exceeded the payload backstop — caller must truncate", {
      got: all.length,
      backstop: MAX_REFS,
    });
  }
  return all.slice(0, MAX_REFS);
}

// Resolve an ordered list of reference images to data-URIs, preserving order
// (order is load-bearing — the prompt's 图片N legend maps to this array, and
// Gemini adopts the aspect ratio of the LAST image). Accepts bare mediaIds or
// {mediaId, identityAnchor} records. Throws only if EVERY reference fails.
export async function normalizeReferenceImages(
  refs: (ReferenceImageRef | null | undefined)[],
  opts: NormalizeReferenceOptions = {},
): Promise<string[]> {
  const ids = dedupeReferenceRefs(refs);
  if (ids.length === 0) return [];

  // isLast 係按截斷後嘅陣列算。已知細口：如果最後嗰張 fetch 失敗（partial failure），
  // 實際送出嘅最後一張會變成前一張，而佢當時唔係按「最後」嘅規則編碼。呢個組合要
  // 「最後一張掛咗」×「前一張係比例唔啱嘅 anchor」先中，代價係退回黑邊——同修之前
  // 一樣，唔會更差；要根治就要 fetch 完再編碼第二轉，唔值。
  const resolved = await Promise.all(ids.map((ref, i) => toDataUri(ref, opts, i === ids.length - 1)));
  const ok = resolved.filter((u): u is string => u !== null);
  if (ok.length === 0) {
    throw new AiError("REFERENCE_ALL_FAILED", `all ${ids.length} reference image(s) failed to normalize`, true);
  }
  return ok;
}

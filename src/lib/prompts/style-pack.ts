// Style pack loader — shared by worker handlers (media-handlers.ts) and the
// prop prompt-preview API route, so both use the exact same on-disk source
// (prompts/styles/{id}/style.json) instead of drifting from a duplicated copy.
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export interface StylePack {
  prefix?: string;
  assetPrefix?: string;
  locationPrefix?: string;
  negativePrompt?: string;
  // 美學塑形類負面詞（幼態臉／醜化畸形），**只可以喺資產設計嗰一步用**。
  //
  // 點解要同 negativePrompt 分家：呢批詞係「應該設計成點」嘅要求，落喺「照抄參考圖」
  // 嘅步驟（近臉特寫、側背視角）就會同身份鎖競爭並且贏咗。實測 anime pack 加咗
  // childlike face / oversized doll eyes 之後，18 歲動畫臉嘅近臉特寫變咗一個約 30 歲
  // 嘅寫實西方臉，眼色連自己張主圖都對唔上（主圖藍眼→近臉啡眼）、盔甲款都改埋。
  // 根因係把審核準則當成生成負面詞：動畫臉本身就係大眼、年輕比例，呢啲詞同個 medium
  // 直接打對台。所以動畫／3D pack 只保留 chibi 同醜化類，唔要「大眼／幼態」。
  designNegativePrompt?: string;
  bannedWords?: string[];
}

export async function loadStyle(stylePackId: string): Promise<StylePack> {
  try {
    const raw = await readFile(join(process.cwd(), "prompts", "styles", stylePackId, "style.json"), "utf8");
    return JSON.parse(raw) as StylePack;
  } catch {
    return {};
  }
}

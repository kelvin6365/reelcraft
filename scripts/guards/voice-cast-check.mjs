// Guard: 配音必須有明確音色來源，唔准靜默跌返 provider 預設聲（CLAUDE.md #8）。
// Why: TTS 呼叫如果冇帶 voice 參數，provider 會用佢自己嘅預設音色 —— 結果成集
// 每個角色（連旁白）都係同一把聲。呢個 bug 冇任何 error、冇 log，淨係聽落先知，
// 所以要喺 CI 度鎖住三件事：
//   ① 每個 tts model 都要聲明食邊種音色（voiceModes），錯配要 fail 唔准降級
//   ② 音色庫係 standards/ 資產，唔准喺 code 度 inline 一份
//   ③ ttsLineHandler 要行 resolveVoiceBinding + 未派音硬 fail
import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { walk, scan, report } from "./lib.mjs";

const CAPABILITIES = "standards/capabilities.json";
const PRESETS = "standards/voice-presets.json";
const PRESETS_LOADER = "src/lib/voice/presets.ts";
const TTS_HANDLER = "src/lib/workers/handlers/media-handlers.ts";

const hits = [];
const catalog = JSON.parse(readFileSync(CAPABILITIES, "utf8"));
const presets = JSON.parse(readFileSync(PRESETS, "utf8"));

// ① 每個真 tts model 都要聲明 voiceModes；preset 模式仲要講明係邊個 vendor 嘅音色庫。
const ttsEntries = catalog.filter((e) => e.apiType === "tts" && !e.modelKey.startsWith("fake::"));
if (ttsEntries.length === 0) hits.push(`${CAPABILITIES}  一個 tts model 都冇 —— catalog 被拆走咗？`);
for (const e of ttsEntries) {
  const modes = e.capabilities?.voiceModes;
  if (!Array.isArray(modes) || modes.length === 0) {
    hits.push(`${CAPABILITIES}  ${e.modelKey} 冇聲明 capabilities.voiceModes（"preset" 定 "ref"）`);
    continue;
  }
  if (modes.includes("preset") && !e.capabilities?.voicePresetVendor) {
    hits.push(`${CAPABILITIES}  ${e.modelKey} 食 preset 音色但冇寫 voicePresetVendor`);
  }
}

// 音色庫每個 vendor 都要真係有 model 用得着，否則揀咗都配唔成。
const vendors = new Set(ttsEntries.map((e) => e.capabilities?.voicePresetVendor).filter(Boolean));
for (const v of presets.voices ?? []) {
  if (!vendors.has(v.vendor)) {
    hits.push(`${PRESETS}  音色 ${v.id} 嘅 vendor "${v.vendor}" 冇任何 tts model 支援`);
  }
}

// ② 音色庫只可以由 loader 讀 —— 其他地方要行 listVoicePresets()/getVoicePreset()。
const others = walk("src").filter((f) => relative(process.cwd(), f) !== PRESETS_LOADER);
hits.push(
  ...scan(others, (line) => /voice-presets\.json/.test(line) && /\b(import|require|from)\b/.test(line)),
);

// ③ TTS handler 必須解析音色綁定，未派音要硬 fail。
const handler = readFileSync(TTS_HANDLER, "utf8");
if (!handler.includes("resolveVoiceBinding(")) {
  hits.push(`${TTS_HANDLER}  ttsLineHandler 冇 call resolveVoiceBinding —— 會跌返 provider 預設聲`);
}
if (!handler.includes("VOICE_NOT_CAST")) {
  hits.push(`${TTS_HANDLER}  未派音色冇硬 fail（VOICE_NOT_CAST）—— 靜默降級即係成集同一把聲`);
}
if (!handler.includes("checkVoiceMode(")) {
  hits.push(`${TTS_HANDLER}  冇檢查模型食唔食呢種音色（checkVoiceMode）`);
}

process.exit(report("voice-cast-check", hits) ? 0 : 1);

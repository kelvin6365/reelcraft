// 邊句對白用邊把聲 —— 唯一嘅解析入口。ttsLineHandler、配音站 UI gate、
// voice_cast 派音三處都行呢度，唔准各自判斷。Pure：唔掂 DB，call 之前自己撈料。
//
// 兩種音色來源：
//   preset — provider 內置音色 id（standards/voice-presets.json），零成本即揀即用
//   ref    — 用戶上傳嘅參考音（Voice → MediaObject），行聲音克隆
// 一個角色只可以綁其中一種；兩個都空 = 未派音，TTS 會跌返 provider 預設聲
// （即係「全部角色同一把聲」嗰個 bug），所以配音站唔俾喺未派晒之前一鍵生成。

import { z } from "zod";
import { getVoicePreset } from "@/lib/voice/presets";

export type VoiceBinding =
  | { kind: "preset"; presetId: string; vendor: string }
  | { kind: "ref"; mediaId: string };

const speakerVoiceEntrySchema = z.union([
  z.object({ presetId: z.string().min(1) }).strict(),
  z.object({ refId: z.string().min(1) }).strict(),
]);

export const speakerVoicesSchema = z.record(z.string().min(1), speakerVoiceEntrySchema);
export type SpeakerVoiceMap = z.infer<typeof speakerVoicesSchema>;

// Episode.speakerVoices 係 Json 欄位 —— 舊資料／手改壞咗嘅資料唔應該炸鑊，
// 解析唔到就當冇綁（UI 會顯示「未派音」，用戶重揀就得）。
export function parseSpeakerVoices(raw: unknown): SpeakerVoiceMap {
  const parsed = speakerVoicesSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : {};
}

export interface VoiceOwner {
  voicePresetId: string | null;
  voiceRefId: string | null;
}

export type VoiceResolution =
  | { ok: true; binding: VoiceBinding }
  | { ok: false; reason: "unbound" | "unknown-preset" | "missing-ref"; detail: string };

function fromParts(
  presetId: string | null | undefined,
  refId: string | null | undefined,
  refAudioById: Map<string, string>,
  who: string,
): VoiceResolution {
  // ref 優先：API 層保證互斥，但真出現兩個都有值時，用戶上傳嗰把聲係更明確
  // 嘅意圖，唔應該畀個 preset 蓋過。
  if (refId) {
    const mediaId = refAudioById.get(refId);
    if (!mediaId) return { ok: false, reason: "missing-ref", detail: `${who} 綁咗嘅參考音（${refId}）搵唔返` };
    return { ok: true, binding: { kind: "ref", mediaId } };
  }
  if (presetId) {
    const preset = getVoicePreset(presetId);
    if (!preset) return { ok: false, reason: "unknown-preset", detail: `${who} 綁咗嘅音色（${presetId}）唔喺音色庫入面` };
    return { ok: true, binding: { kind: "preset", presetId, vendor: preset.vendor } };
  }
  return { ok: false, reason: "unbound", detail: `${who} 未派音色` };
}

// 有 Character 就跟角色綁定；旁白／【機械音】／「未知」呢啲冇肉身嘅聲源
// 冇 Character 可綁，跌落集級 speakerVoices。
export function resolveVoiceBinding(input: {
  speaker: string;
  character: VoiceOwner | null;
  speakerVoices: SpeakerVoiceMap;
  refAudioById: Map<string, string>;
}): VoiceResolution {
  const who = input.speaker || "未知說話者";
  if (input.character) {
    return fromParts(input.character.voicePresetId, input.character.voiceRefId, input.refAudioById, who);
  }
  const entry = input.speakerVoices[input.speaker];
  return fromParts(
    entry && "presetId" in entry ? entry.presetId : null,
    entry && "refId" in entry ? entry.refId : null,
    input.refAudioById,
    who,
  );
}

// 模型食唔食呢種音色 —— index-tts-2 只收參考音（reference cloning），
// minimax speech-02 只收內置 voice_id。錯配唔應該靜靜降級成預設聲（嗰樣就係
// 本身個 bug），要硬 fail 兼講清楚點解。
export function checkVoiceMode(
  binding: VoiceBinding,
  caps: { voiceModes?: string[]; voicePresetVendor?: string } | null,
  modelKey: string,
): { ok: true } | { ok: false; message: string } {
  const modes = caps?.voiceModes;
  // 冇聲明能力 = 未知模型，唔攔（照舊行為，最多 provider 自己回錯）
  if (!modes) return { ok: true };
  if (!modes.includes(binding.kind)) {
    const want = binding.kind === "preset" ? "內置音色" : "上傳參考音";
    const has = modes.includes("preset") ? "內置音色" : "上傳參考音";
    return { ok: false, message: `配音模型 ${modelKey} 唔支援${want}，只食${has}。請換模型或者換音色來源。` };
  }
  if (binding.kind === "preset" && caps?.voicePresetVendor && caps.voicePresetVendor !== binding.vendor) {
    return {
      ok: false,
      message: `音色「${binding.presetId}」係 ${binding.vendor} 嘅，配音模型 ${modelKey} 用緊 ${caps.voicePresetVendor} 音色庫。`,
    };
  }
  return { ok: true };
}

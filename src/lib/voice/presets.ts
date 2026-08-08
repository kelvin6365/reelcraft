// 音色預設庫 loader —— standards/voice-presets.json 係唯一真相來源，同
// standards/capabilities.json 一樣 zod 硬驗、載入即 throw。UI 下拉、voice_cast
// 派音、TTS 綁定三處都行呢度，唔准各自 hardcode 一份音色清單。

import { z } from "zod";
import presetsJson from "../../../standards/voice-presets.json";

const voiceSchema = z
  .object({
    id: z.string().min(1),
    // 邊個 provider 嘅內置音色 —— 同 capabilities.json 嗰個 model 嘅
    // voicePresetVendor 對唔上就唔會出現喺該模型嘅選項入面。
    vendor: z.string().min(1),
    name: z.string().min(1),
    gender: z.enum(["male", "female", "neutral"]),
    age: z.enum(["童聲", "少年", "青年", "中年", "老年", "特殊"]),
    traits: z.array(z.string().min(1)).min(1),
    goodFor: z.string().min(1),
  })
  .strict();

const fileSchema = z
  .object({ $comment: z.string().optional(), voices: z.array(voiceSchema).min(1) })
  .strict();

export type VoicePreset = z.infer<typeof voiceSchema>;

function load(): Map<string, VoicePreset> {
  const parsed = fileSchema.safeParse(presetsJson);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  [${i.path.join(".")}] ${i.message}`).join("\n");
    throw new Error(`[voice-presets] invalid standards/voice-presets.json:\n${issues}`);
  }
  const byId = new Map<string, VoicePreset>();
  for (const v of parsed.data.voices) {
    if (byId.has(v.id)) throw new Error(`[voice-presets] duplicate voice id: ${v.id}`);
    byId.set(v.id, v);
  }
  return byId;
}

const presets = load();

export function getVoicePreset(id: string): VoicePreset | null {
  return presets.get(id) ?? null;
}

export function listVoicePresets(vendor?: string): VoicePreset[] {
  const all = [...presets.values()];
  return vendor ? all.filter((v) => v.vendor === vendor) : all;
}

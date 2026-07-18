// provider::modelId composite key — the only legal way to reference a model.
// No provider guessing, no static mapping, no default downgrade (CLAUDE.md #3).

export type ModelKey = `${string}::${string}`;
export type ApiType = "text" | "image" | "video" | "tts";

export interface ParsedModelKey {
  provider: string;
  modelId: string;
}

export function parseModelKeyStrict(key: string): ParsedModelKey | null {
  const idx = key.indexOf("::");
  if (idx <= 0) return null;
  const provider = key.slice(0, idx);
  const modelId = key.slice(idx + 2);
  if (!provider || !modelId) return null;
  return { provider, modelId };
}

export function composeModelKey(provider: string, modelId: string): ModelKey {
  return `${provider}::${modelId}`;
}

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

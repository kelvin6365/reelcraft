"use client";
// Compact per-project image-model picker. Reads the project's current
// modelDefaults.image, PATCHes the merged object on change (preserving
// text/video/tts), and shows an optimistic 儲存中/已儲存 hint.
import { useState } from "react";
import { api } from "@/ui/api";
import { useAction } from "./useAction";
import type { ModelDefaults } from "@/ui/types";

const DEFAULT_IMAGE_MODEL = "fake::image";

const IMAGE_MODELS: { key: string; label: string; recommended?: boolean }[] = [
  { key: "fal::fal-ai/nano-banana", label: "nano-banana（快·平）" },
  { key: "fal::fal-ai/nano-banana-pro", label: "nano-banana Pro（高質·貴）", recommended: true },
  { key: "fal::fal-ai/bytedance/seedream/v4/text-to-image", label: "Seedream v4（亞洲面孔強）" },
  { key: DEFAULT_IMAGE_MODEL, label: "示範（免費·假圖）" },
];

export function ModelPicker({
  id,
  modelDefaults,
  refetch,
}: {
  id: string;
  modelDefaults: ModelDefaults | null;
  refetch: () => Promise<void>;
}) {
  const [image, setImage] = useState(modelDefaults?.image ?? DEFAULT_IMAGE_MODEL);
  const [saved, setSaved] = useState(false);
  const { busy, err, run } = useAction(refetch);

  async function onChange(next: string) {
    const prev = image;
    setImage(next); // optimistic
    setSaved(false);
    await run(async () => {
      const merged = { ...(modelDefaults ?? {}), image: next };
      try {
        await api.patch(`/api/projects/${id}`, { modelDefaults: merged });
      } catch (e) {
        setImage(prev); // revert optimistic value; useAction surfaces the error
        throw e;
      }
      setSaved(true);
    });
  }

  return (
    <div className="card section-gap">
      <h2 style={{ fontSize: 18, marginBottom: 4 }}>AI 模型</h2>
      <div className="field" style={{ marginTop: 6, maxWidth: 420 }}>
        <label htmlFor="image-model">圖像 model</label>
        <select
          id="image-model"
          value={image}
          onChange={(e) => void onChange(e.target.value)}
          disabled={busy}
        >
          {IMAGE_MODELS.map((m) => (
            <option key={m.key} value={m.key}>
              {m.recommended ? `${m.label}（推薦）` : m.label}
            </option>
          ))}
        </select>
      </div>
      <div className="row" style={{ gap: 10, marginTop: 8 }}>
        <span className="faint" style={{ fontSize: 12 }}>換 model 只影響之後新生成嘅圖。</span>
        {busy && <span className="faint" style={{ fontSize: 12 }}>儲存中…</span>}
        {!busy && saved && <span className="faint" style={{ fontSize: 12 }}>已儲存 ✓</span>}
      </div>
      {err && <p className="error-text" style={{ marginTop: 8 }}>{err}</p>}
    </div>
  );
}

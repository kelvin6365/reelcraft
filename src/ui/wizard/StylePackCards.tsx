"use client";
// Selectable 畫風包 card grid for the /projects/new wizard's step 2. Tries a
// static preview image per pack first; falls back to a gradient swatch if the
// asset is missing (previews aren't guaranteed to exist for every pack yet).
import { useState } from "react";
import { cn } from "@/lib/utils";

export const STYLE_PACKS = [
  { id: "cinematic-01", label: "真人電影感 cinematic-01", desc: "寫實電影質感，適合都市/豪門劇" },
  { id: "kdrama-01", label: "真人韓劇 kdrama-01", desc: "韓劇柔光質感，適合愛情/職場劇" },
  { id: "anime-01", label: "2D 動漫 anime-01", desc: "日系動漫線條，適合奇幻/校園劇" },
  { id: "3d-01", label: "3D 動畫 3d-01", desc: "3D 渲染質感，適合玄幻/科幻劇" },
];

const GRADIENTS: Record<string, string> = {
  "cinematic-01": "bg-gradient-to-br from-slate-700 via-slate-800 to-black",
  "kdrama-01": "bg-gradient-to-br from-rose-300 via-pink-400 to-orange-300",
  "anime-01": "bg-gradient-to-br from-sky-300 via-indigo-400 to-violet-500",
  "3d-01": "bg-gradient-to-br from-emerald-400 via-teal-500 to-cyan-600",
};

export function StylePackCards({
  value,
  onChange,
}: {
  value: string;
  onChange: (id: string) => void;
}) {
  const [imgError, setImgError] = useState<Record<string, boolean>>({});

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      {STYLE_PACKS.map((pack) => {
        const selected = pack.id === value;
        return (
          <button
            key={pack.id}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(pack.id)}
            className={cn(
              "flex flex-col overflow-hidden rounded-lg border-2 text-left transition-colors",
              selected ? "border-primary ring-2 ring-primary" : "border-transparent hover:border-border",
            )}
          >
            <div className="relative aspect-3/4 w-full overflow-hidden bg-muted">
              {imgError[pack.id] ? (
                <div
                  className={cn(
                    "flex size-full items-center justify-center p-2 text-center text-xs font-medium text-white",
                    GRADIENTS[pack.id],
                  )}
                >
                  {pack.label}
                </div>
              ) : (
                <img
                  src={`/style-previews/${pack.id}.jpg`}
                  alt={pack.label}
                  className="size-full object-cover"
                  onError={() => setImgError((prev) => ({ ...prev, [pack.id]: true }))}
                />
              )}
            </div>
            <div className="space-y-0.5 p-2">
              <p className="text-sm font-medium">{pack.label}</p>
              <p className="text-xs text-muted-foreground">{pack.desc}</p>
            </div>
          </button>
        );
      })}
    </div>
  );
}

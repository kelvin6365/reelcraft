"use client";
// Small, reusable checklist: declared catalog variables vs what's actually
// present in an override's content. Shared by the user-layer editor (slice 4)
// and the project-layer editor (slice 5) — kept self-contained so it doesn't
// know about promptId/projectId at all.
import { Check, X } from "lucide-react";
import { extractPlaceholders } from "@/lib/prompts/placeholders";

export function VariableChecklist({ declaredVars, content }: { declaredVars: string[]; content: string }) {
  const found = extractPlaceholders(content);
  const declared = new Set(declaredVars);
  const extra = [...found].filter((v) => !declared.has(v)).sort();

  return (
    <div className="space-y-3 text-sm">
      <div>
        <p className="mb-1.5 font-medium">變數</p>
        <ul className="space-y-1">
          {declaredVars.map((v) => {
            const present = found.has(v);
            return (
              <li key={v} className="flex items-center gap-1.5">
                {present ? (
                  <Check className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-500" />
                ) : (
                  <X className="size-3.5 shrink-0 text-destructive" />
                )}
                <code
                  className={`font-mono text-xs ${present ? "" : "text-destructive"}`}
                >{`{${v}}`}</code>
              </li>
            );
          })}
        </ul>
      </div>
      {extra.length > 0 && (
        <div>
          <p className="mb-1.5 font-medium text-destructive">多餘變數</p>
          <ul className="space-y-1">
            {extra.map((v) => (
              <li key={v} className="flex items-center gap-1.5">
                <X className="size-3.5 shrink-0 text-destructive" />
                <code className="font-mono text-xs text-destructive">{`{${v}}`}</code>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

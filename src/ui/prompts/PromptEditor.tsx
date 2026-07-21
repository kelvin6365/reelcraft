"use client";
// Shared prompt override editor — used by the user-layer template tab (slice 4)
// and, unchanged, by the project-layer card (slice 5: pass projectId + a
// PromptDetailView fetched with that projectId). Left: mono textarea. Right:
// VariableChecklist + description/version. Bottom: 儲存 / 還原官方版 / 睇 diff
// (diff only shown once there's a saved override to compare against).
import { useState } from "react";
import { AlertTriangle, GitCompare, RotateCcw } from "lucide-react";
import { api, ApiClientError } from "@/ui/api";
import { checkOverridePlaceholders } from "@/lib/prompts/placeholders";
import type { PromptDetailView } from "@/ui/types";
import { PromptDiff } from "@/ui/prompts/PromptDiff";
import { VariableChecklist } from "@/ui/prompts/VariableChecklist";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

type SaveStatus = "saving" | "saved" | "error";

export function PromptEditor({
  promptId,
  projectId,
  detail,
  onSaved,
  onReverted,
}: {
  promptId: string;
  projectId?: string;
  detail: PromptDetailView;
  onSaved?: (detail: PromptDetailView) => void;
  onReverted?: (detail: PromptDetailView) => void;
}) {
  const layer = projectId ? detail.project : detail.user;
  const [content, setContent] = useState(layer?.content ?? detail.system);
  const [status, setStatus] = useState<SaveStatus | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [revertOpen, setRevertOpen] = useState(false);
  const [diffOpen, setDiffOpen] = useState(false);

  const check = checkOverridePlaceholders(detail.variables, content);
  const dirty = content !== (layer?.content ?? detail.system);
  const canRevert = Boolean(layer);

  async function save() {
    if (!check.ok) return;
    setStatus("saving");
    setErrorMsg(null);
    try {
      const result = await api.put<PromptDetailView & { warnings: string[] }>(`/api/prompts/${promptId}`, {
        content,
        ...(projectId ? { projectId } : {}),
      });
      setWarnings(result.warnings ?? []);
      setStatus("saved");
      onSaved?.(result);
      setTimeout(() => setStatus((s) => (s === "saved" ? null : s)), 2000);
    } catch (e) {
      setStatus("error");
      setErrorMsg(e instanceof ApiClientError ? e.message : "儲存失敗");
    }
  }

  async function revert() {
    const query = projectId ? `?projectId=${projectId}` : "";
    const result = await api.del<PromptDetailView>(`/api/prompts/${promptId}${query}`);
    setContent(result.system);
    setWarnings([]);
    setStatus(null);
    setErrorMsg(null);
    onReverted?.(result);
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-[1fr_260px]">
        <Textarea
          rows={24}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          spellCheck={false}
          className="resize-y font-mono text-xs"
        />
        <div className="space-y-4">
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">{detail.description}</p>
            <Badge variant="outline">官方版本：{detail.version}</Badge>
          </div>
          <VariableChecklist declaredVars={detail.variables} content={content} />
        </div>
      </div>

      {!check.ok && (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertDescription>
            變數對唔上，未能儲存
            {check.missing.length > 0 && ` · 缺少：${check.missing.map((v) => `{${v}}`).join(", ")}`}
            {check.extra.length > 0 && ` · 多餘：${check.extra.map((v) => `{${v}}`).join(", ")}`}
          </AlertDescription>
        </Alert>
      )}

      {status === "error" && errorMsg && (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertDescription>{errorMsg}</AlertDescription>
        </Alert>
      )}

      {warnings.length > 0 && (
        <Alert>
          <AlertTriangle />
          <AlertDescription>{warnings.join(" · ")}</AlertDescription>
        </Alert>
      )}

      <div className="flex items-center gap-3">
        <Button onClick={() => void save()} disabled={!check.ok || !dirty || status === "saving"}>
          {status === "saving" ? "儲存中…" : "儲存"}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={!canRevert}
          onClick={() => setRevertOpen(true)}
        >
          <RotateCcw className="size-4" />
          還原官方版
        </Button>
        {layer && (
          <Button type="button" variant="ghost" onClick={() => setDiffOpen(true)}>
            <GitCompare className="size-4" />
            睇 diff
          </Button>
        )}
        <span
          role="status"
          aria-live="polite"
          className={`text-xs ${status === "saved" ? "text-emerald-600 dark:text-emerald-500" : "text-muted-foreground"}`}
        >
          {status === "saved" && "已儲存"}
        </span>
      </div>

      <ConfirmDialog
        open={revertOpen}
        onOpenChange={setRevertOpen}
        title="還原官方版？"
        description="呢層自訂內容會被刪除，之後會用返官方模板，無法復原。"
        confirmLabel="還原"
        destructive
        onConfirm={revert}
      />

      {layer && (
        <Dialog open={diffOpen} onOpenChange={setDiffOpen}>
          <DialogContent className="max-w-4xl">
            <DialogHeader>
              <DialogTitle>Prompt 差異</DialogTitle>
            </DialogHeader>
            <PromptDiff
              yourContent={content}
              baseContent={layer.baseContent}
              systemContent={detail.system}
              version={detail.version}
            />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

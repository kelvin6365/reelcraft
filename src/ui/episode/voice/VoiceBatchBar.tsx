"use client";
// 配音批量重配 —— 對應圖像／視頻站嘅 ShotWorkbench 批量列。
//
// 同分鏡站唔同嘅兩點：
//   ① TTS 論字計，冇「一句幾錢」，預估要由選咗嗰幾句嘅字數乘 perChar。
//   ② 「可選」嘅條件係「派咗音色 + 台詞唔空」。未派音色嘅行送落去一定
//      VOICE_NOT_CAST 失敗，畀人揀落去只係製造紅色 task。
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { api } from "@/ui/api";
import { useAction } from "@/ui/planning/useAction";
import { qk } from "@/ui/query-keys";
import type { VoiceCastView, VoiceLineView } from "@/ui/types";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { formatUsd, needsCostConfirm } from "../cost-confirm";

export type VoiceFilter = "all" | "pending" | "done";

// 一句台詞配得成 = 佢把聲派咗音色，而且台詞唔係空
export function isCastable(line: VoiceLineView, castBySpeaker: Map<string, VoiceCastView>): boolean {
  if (line.content.trim().length === 0) return false;
  return castBySpeaker.get(line.speaker || "未知")?.assigned === true;
}

export function VoiceBatchBar({
  lines,
  cast,
  episodeId,
  perCharUsd,
  filter,
  onFilter,
  selected,
  onSelected,
}: {
  lines: VoiceLineView[];
  cast: VoiceCastView[];
  episodeId: string;
  perCharUsd: number | null | undefined;
  filter: VoiceFilter;
  onFilter: (f: VoiceFilter) => void;
  selected: Set<string>;
  onSelected: (next: Set<string>) => void;
}) {
  const batch = useAction(qk.episode(episodeId));
  const [confirmOpen, setConfirmOpen] = useState(false);

  const castBySpeaker = new Map(cast.map((c) => [c.speaker, c]));
  const eligible = (l: VoiceLineView) => isCastable(l, castBySpeaker);

  const rows = lines.filter((l) => (filter === "all" ? true : filter === "pending" ? !l.audioMediaId : Boolean(l.audioMediaId)));
  const selectable = rows.filter(eligible);
  const allSelected = selectable.length > 0 && selectable.every((l) => selected.has(l.id));

  // 只計仲喺度嘅 id —— 重新分析台詞會換走成批行，揀住嗰陣嘅舊 id 唔可以
  // 算入數量／花費，更加唔可以 POST 落去。
  const liveIds = new Set(lines.map((l) => l.id));
  const selectedLines = lines.filter((l) => selected.has(l.id) && liveIds.has(l.id));
  const count = selectedLines.length;
  const chars = selectedLines.reduce((n, l) => n + l.content.trim().length, 0);
  const estUsd = typeof perCharUsd === "number" ? perCharUsd * chars : undefined;

  const pendingCount = lines.filter((l) => !l.audioMediaId && eligible(l)).length;
  const uncastCount = lines.filter((l) => !eligible(l)).length;

  async function runBatch() {
    // 只喺成功時清選取 —— 提交失敗要留返個選取畀人重試，唔使逐句再剔過
    if (await batch.run(() => api.post(`/api/episodes/${episodeId}/tts-all`, { lineIds: selectedLines.map((l) => l.id) }))) {
      onSelected(new Set());
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 pr-2">
          <Checkbox
            id="sel-all-voice"
            checked={allSelected}
            onCheckedChange={(v) => onSelected(v === true ? new Set(selectable.map((l) => l.id)) : new Set())}
            aria-label="全選"
            disabled={selectable.length === 0}
          />
          <label htmlFor="sel-all-voice" className="text-sm text-muted-foreground">
            全選
          </label>
        </div>
        <Button variant="outline" size="sm" onClick={() => onSelected(new Set(lines.filter((l) => !l.audioMediaId && eligible(l)).map((l) => l.id)))} disabled={pendingCount === 0}>
          只選未配音（{pendingCount}）
        </Button>
        {(["all", "pending", "done"] as VoiceFilter[]).map((f) => (
          <Button
            key={f}
            variant={filter === f ? "secondary" : "ghost"}
            size="sm"
            onClick={() => onFilter(f)}
            aria-pressed={filter === f}
          >
            {f === "all" ? "全部" : f === "pending" ? "未配音" : "已配音"}
          </Button>
        ))}
        {uncastCount > 0 && (
          <span className="text-xs text-muted-foreground" title="未派音色或者台詞係空嘅行揀唔到，配落去只會失敗">
            {uncastCount} 句未派音／空白，揀唔到
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {count > 0 && (
            <Button variant="ghost" size="sm" onClick={() => onSelected(new Set())}>
              清除選取
            </Button>
          )}
          <Button
            size="sm"
            disabled={count === 0 || batch.busy}
            aria-busy={batch.busy}
            onClick={() => {
              if (needsCostConfirm({ usd: estUsd, units: count })) setConfirmOpen(true);
              else void runBatch();
            }}
          >
            {batch.busy ? (
              <>
                <Loader2 className="animate-spin" /> 排隊中…
              </>
            ) : (
              `重配選取 ${count} 句${typeof estUsd === "number" && estUsd > 0 ? ` ${formatUsd(estUsd)}` : ""}`
            )}
          </Button>
        </div>
      </div>
      {batch.err && <p className="text-sm text-destructive">{batch.err}</p>}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`重配 ${count} 句對白？`}
        description={
          <>
            會為選取嘅 {count} 句（共 {chars} 字）排隊重新配音
            {typeof estUsd === "number" && estUsd > 0 ? (
              <>
                ，預估花費 <b>{formatUsd(estUsd)}</b>
              </>
            ) : null}
            。已有嘅音檔會被取代，已花費嘅成本唔會退返。
          </>
        }
        confirmLabel="確定重配"
        onConfirm={runBatch}
      />
    </div>
  );
}

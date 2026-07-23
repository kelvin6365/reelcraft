"use client";
import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { api } from "@/ui/api";
import { useAction } from "@/ui/planning/useAction";
import { qk } from "@/ui/query-keys";
import { cn } from "@/lib/utils";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import type { EpisodeView, LiveTaskMap, ShotView } from "@/ui/types";
import { formatUsd, needsCostConfirm } from "./cost-confirm";

type Filter = "all" | "pending" | "done";

export function ShotWorkbench({
  view,
  media,
  live,
  unitUsd,
}: {
  view: EpisodeView;
  media: "image" | "video";
  live?: LiveTaskMap;
  unitUsd?: number | null;
}) {
  const episodeId = view.episode.id;
  const shots = view.shots;
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<Filter>("all");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const batch = useAction(qk.episode(episodeId));

  const hasMedia = (sh: ShotView) => Boolean(media === "image" ? sh.imageMediaId : sh.videoMediaId);
  const eligible = (sh: ShotView) => (media === "image" ? true : Boolean(sh.imageMediaId));

  // Drop ids that no longer exist — a shot deleted (or a storyboard regen) while
  // it was selected would otherwise inflate the count/cost and post a dead id.
  useEffect(() => {
    setSelected((prev) => {
      const live = new Set(shots.map((s) => s.id));
      const pruned = new Set([...prev].filter((id) => live.has(id)));
      return pruned.size === prev.size ? prev : pruned;
    });
  }, [shots]);

  const rows = useMemo(
    () => shots.filter((sh) => (filter === "all" ? true : filter === "pending" ? !hasMedia(sh) : hasMedia(sh))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shots, filter, media],
  );

  const selectable = rows.filter(eligible);
  const allSelected = selectable.length > 0 && selectable.every((sh) => selected.has(sh.id));
  // Count/cost/payload all read the same live-pruned set, so they can never
  // reference a shot that is gone.
  const liveIds = new Set(shots.map((s) => s.id));
  const selectedIds = [...selected].filter((id) => liveIds.has(id));
  const count = selectedIds.length;
  const estUsd = typeof unitUsd === "number" ? unitUsd * count : undefined;
  const mediaLabel = media === "image" ? "圖" : "視頻";

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAll(on: boolean) {
    setSelected(on ? new Set(selectable.map((sh) => sh.id)) : new Set());
  }

  function selectPending() {
    setSelected(new Set(shots.filter((sh) => !hasMedia(sh) && eligible(sh)).map((sh) => sh.id)));
  }

  async function runBatch() {
    const endpoint = media === "image" ? "generate-shot-images" : "generate-shot-videos";
    // Clear only on success — a failed submit must keep the selection so the user
    // can retry without re-ticking every shot.
    if (await batch.run(() => api.post(`/api/episodes/${episodeId}/${endpoint}`, { shotIds: selectedIds }))) {
      setSelected(new Set());
    }
  }

  const pendingCount = shots.filter((sh) => !hasMedia(sh) && eligible(sh)).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 pr-2">
          <Checkbox
            id={`sel-all-${media}`}
            checked={allSelected}
            onCheckedChange={(v) => selectAll(v === true)}
            aria-label="全選"
            disabled={selectable.length === 0}
          />
          <label htmlFor={`sel-all-${media}`} className="text-sm text-muted-foreground">
            全選
          </label>
        </div>
        <Button variant="outline" size="sm" onClick={selectPending} disabled={pendingCount === 0}>
          只選未生成（{pendingCount}）
        </Button>
        {(["all", "pending", "done"] as Filter[]).map((f) => (
          <Button
            key={f}
            variant={filter === f ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setFilter(f)}
            aria-pressed={filter === f}
          >
            {f === "all" ? "全部" : f === "pending" ? "未生成" : "已生成"}
          </Button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          {count > 0 && (
            <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
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
              `生成選取 ${count} 鏡${typeof estUsd === "number" && estUsd > 0 ? ` ${formatUsd(estUsd)}` : ""}`
            )}
          </Button>
        </div>
      </div>
      {batch.err && <p className="text-sm text-destructive">{batch.err}</p>}

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40">
            <tr className="text-left">
              <th scope="col" className="w-10 p-2">
                <span className="sr-only">選取</span>
              </th>
              <th scope="col" className="w-12 p-2">
                #
              </th>
              <th scope="col" className="w-40 p-2">
                圖像
              </th>
              <th scope="col" className="w-48 p-2">
                視頻
              </th>
              <th scope="col" className="min-w-40 p-2">
                原文片段
              </th>
              <th scope="col" className="w-36 p-2 text-right">
                操作
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((sh) => (
              <ShotRow
                key={sh.id}
                shot={sh}
                media={media}
                episodeId={episodeId}
                live={live}
                unitUsd={unitUsd}
                selected={selected.has(sh.id)}
                selectable={eligible(sh)}
                onToggle={() => toggle(sh.id)}
              />
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="p-6 text-center text-muted-foreground">
                  冇符合篩選嘅鏡頭。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`生成 ${count} 個鏡頭${mediaLabel}？`}
        description={
          <>
            會為選取嘅 {count} 個鏡頭排隊生成{mediaLabel}
            {typeof estUsd === "number" && estUsd > 0 ? (
              <>
                ，預估花費 <b>{formatUsd(estUsd)}</b>
              </>
            ) : null}
            。已有嘅媒體會被取代，已花費嘅成本唔會退返。
          </>
        }
        confirmLabel="確定生成"
        onConfirm={runBatch}
      />
    </div>
  );
}

function ShotRow({
  shot,
  media,
  episodeId,
  live,
  unitUsd,
  selected,
  selectable,
  onToggle,
}: {
  shot: ShotView;
  media: "image" | "video";
  episodeId: string;
  live?: LiveTaskMap;
  unitUsd?: number | null;
  selected: boolean;
  selectable: boolean;
  onToggle: () => void;
}) {
  const { busy, err, run } = useAction(qk.episode(episodeId));
  const [regenOpen, setRegenOpen] = useState(false);
  const url = media === "image" ? shot.imageUrl : shot.videoUrl;
  const endpoint = media === "image" ? "generate-image" : "generate-video";
  const mediaLabel = media === "image" ? "圖像" : "視頻";

  const taskType = media === "image" ? "IMAGE_SHOT" : "VIDEO_SHOT";
  const liveState = live?.[`${taskType}:${shot.id}`];
  const serverTask = media === "image" ? shot.activeImageTask : shot.activeVideoTask;
  const inFlight = Boolean(liveState) || Boolean(serverTask);
  const pct = liveState?.progress ?? serverTask?.progress;

  const priceSuffix = typeof unitUsd === "number" ? ` ~$${unitUsd.toFixed(2)}` : "";
  const generate = () => run(() => api.post(`/api/shots/${shot.id}/${endpoint}`));

  return (
    <tr className={cn("border-b last:border-0", selected && "bg-accent/40")}>
      <td className="p-2 align-top">
        <Checkbox
          checked={selected}
          onCheckedChange={onToggle}
          disabled={!selectable}
          aria-label={`選取鏡 ${shot.shotIndex}`}
        />
      </td>
      <td className="p-2 align-top tabular-nums">{shot.shotIndex}</td>
      {}
      <td className="p-2 align-top">
        <div className={cn("aspect-video w-36 overflow-hidden rounded bg-muted", media === "image" && "ring-1 ring-primary/40")}>
          {shot.imageUrl ? (
            <img src={shot.imageUrl} alt={`鏡 ${shot.shotIndex} 圖像`} className="size-full object-cover" />
          ) : (
            <span className="flex size-full items-center justify-center text-xs text-muted-foreground">未生成</span>
          )}
        </div>
      </td>
      <td className="p-2 align-top">
        <div className={cn("aspect-video w-44 overflow-hidden rounded bg-muted", media === "video" && "ring-1 ring-primary/40")}>
          {shot.videoUrl ? (
            <video src={shot.videoUrl} controls preload="metadata" className="size-full object-cover" />
          ) : (
            <span className="flex size-full items-center justify-center text-xs text-muted-foreground">
              {media === "video" && !shot.imageMediaId ? "等圖像" : "未生成"}
            </span>
          )}
        </div>
      </td>
      <td className="p-2 align-top text-muted-foreground">
        {shot.storyboardJson.plan?.source_text ?? "—"}
      </td>
      <td className="p-2 text-right align-top">
        <Button
          size="sm"
          variant="outline"
          disabled={busy || inFlight || !selectable}
          aria-busy={busy || inFlight}
          title={
            !selectable
              ? "呢個鏡頭仲未有圖像，i2v 需要一張來源圖"
              : url
                ? `重生會產生新一次生成費用${priceSuffix}，舊有媒體會被取代`
                : `生成${mediaLabel}${priceSuffix}`
          }
          onClick={() => {
            if (url) setRegenOpen(true);
            else generate();
          }}
        >
          {busy || inFlight ? (
            <>
              <Loader2 className="animate-spin" /> {inFlight ? `生成中${pct ? ` ${pct}%` : ""}` : ""}
            </>
          ) : url ? (
            `重生${priceSuffix}`
          ) : (
            `生成${priceSuffix}`
          )}
        </Button>
        {err && <p className="mt-1 text-xs text-destructive">{err}</p>}
        <ConfirmDialog
          open={regenOpen}
          onOpenChange={setRegenOpen}
          title={`重生${mediaLabel}？`}
          description={`重生會產生新一次生成費用${priceSuffix ? `（${priceSuffix.trim()}）` : ""}，舊有媒體會被取代，已花費嘅成本唔會退返。`}
          destructive
          confirmLabel="確定重生"
          onConfirm={generate}
        />
      </td>
    </tr>
  );
}

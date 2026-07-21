"use client";
import { useEffect, useState, type ReactNode } from "react";
import { Loader2, Pencil, RefreshCw } from "lucide-react";
import { api } from "@/ui/api";
import { useAction } from "@/ui/planning/useAction";
import { qk } from "@/ui/query-keys";
import type { EpisodeView, LiveTaskMap, StageKey, ShotView, ScriptReviewView } from "@/ui/types";
import { STATION_BY_KEY } from "./stations";
import { shortModelName, isFakeModel } from "@/ui/model-format";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface PanelProps {
  view: EpisodeView;
  progress: Partial<Record<StageKey, number>>;
  live?: LiveTaskMap; // per-target SSE state — used by the media-grid stations
}

// ---------- shared shell ----------
function Station({
  stage,
  progress,
  action,
  children,
}: {
  stage: StageKey;
  progress?: Partial<Record<StageKey, number>>;
  action?: ReactNode;
  children: ReactNode;
}) {
  const meta = STATION_BY_KEY[stage];
  const pct = progress?.[stage];
  return (
    <Card id={meta.dom} className="scroll-mt-20">
      <CardHeader className="flex-row items-center gap-3 [&>div]:min-w-0">
        <CardTitle className="text-base">
          第 {meta.index} 站 · {meta.name}
        </CardTitle>
        {typeof pct === "number" && (
          <Badge variant="secondary" className="text-primary">
            生成中 {pct}%
          </Badge>
        )}
        <div className="ml-auto flex items-center gap-2">{action}</div>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function EmptyState({ children }: { children: ReactNode }) {
  return <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">{children}</p>;
}

// ---------- ① 原文 ----------
export function InputPanel({ view }: PanelProps) {
  return (
    <Station stage="input">
      <div className="space-y-2">
        <Textarea readOnly value={view.episode.rawText} rows={8} className="bg-muted/40" />
        <p className="text-xs text-muted-foreground">原文唯讀。想改內容請喺專案頁重新建立一集。</p>
      </div>
    </Station>
  );
}

// ---------- ② 資產站 ----------
export function AssetsPanel({ view, progress, live }: PanelProps) {
  const { characters, locations, candidateUrlById } = view;
  const episodeId = view.episode.id;
  const empty = characters.length === 0 && locations.length === 0;
  return (
    <Station stage="assets" progress={progress}>
      {empty ? (
        <EmptyState>仲未抽到角色／場景。用右下角「下一步」抽取資產。</EmptyState>
      ) : (
        <div className="flex flex-col gap-4">
          {characters.map((c) => (
            <AssetCard
              key={c.id}
              id={c.id}
              kind="角色"
              name={c.name}
              desc={c.profile}
              prompt={c.appearancePrompt}
              promptField="appearancePrompt"
              candidates={c.candidates}
              chosenId={c.lockedImageMediaId}
              lockedUrl={c.lockedImageUrl}
              faceUrl={c.faceImageUrl ?? null}
              showFaceHint
              isCharacter
              locked={c.locked}
              lockPath="/api/characters"
              liveState={live?.[`IMAGE_CHARACTER:${c.id}`] ?? c.activeTask ?? null}
              candidateUrlById={candidateUrlById}
              episodeId={episodeId}
            />
          ))}
          {locations.map((l) => (
            <AssetCard
              key={l.id}
              id={l.id}
              kind="場景"
              name={l.name}
              desc={l.summary}
              prompt={l.prompt}
              promptField="prompt"
              candidates={l.candidates}
              chosenId={l.lockedImageMediaId}
              lockedUrl={l.lockedImageUrl}
              locked={l.locked}
              lockPath="/api/locations"
              liveState={live?.[`IMAGE_LOCATION:${l.id}`] ?? l.activeTask ?? null}
              candidateUrlById={candidateUrlById}
              episodeId={episodeId}
            />
          ))}
        </div>
      )}
    </Station>
  );
}

function AssetCard(props: {
  id: string;
  kind: string;
  name: string;
  desc: string;
  prompt: string;
  promptField: "appearancePrompt" | "prompt";
  candidates: string[];
  chosenId: string | null;
  lockedUrl: string | null;
  faceUrl?: string | null;
  showFaceHint?: boolean;
  isCharacter?: boolean;
  locked: boolean;
  lockPath: string;
  liveState: { progress?: number } | null;
  candidateUrlById: Record<string, string>;
  episodeId: string;
}) {
  const { busy, err, run } = useAction(qk.episode(props.episodeId));
  const [editing, setEditing] = useState(false);
  const [promptDraft, setPromptDraft] = useState(props.prompt);
  useEffect(() => {
    if (!editing) setPromptDraft(props.prompt);
  }, [props.prompt, editing]);

  const inFlight = props.liveState !== null;
  const pct = props.liveState?.progress;
  const disabled = busy || inFlight;

  async function savePrompt() {
    if (promptDraft === props.prompt) return;
    await run(() => api.patch(`${props.lockPath}/${props.id}`, { [props.promptField]: promptDraft }));
  }

  return (
    <div className={cn("space-y-3 rounded-lg border p-4", props.locked && "border-primary/40 bg-primary/5")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{props.kind}</Badge>
          <strong className="text-sm">{props.name}</strong>
          {props.locked && (
            <Badge variant="secondary" className="text-primary">
              ✓ 已鎖定
            </Badge>
          )}
          {inFlight && (
            <Badge variant="secondary" className="text-primary">
              生成中{typeof pct === "number" ? ` ${pct}%` : "…"}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            disabled={disabled}
            title="編輯生成提示詞，改完可重生"
            onClick={() => setEditing((v) => !v)}
          >
            <Pencil /> 提示詞
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={disabled}
            title={props.locked && props.isCharacter ? "保留身份重生候選圖" : "重新生成候選圖"}
            onClick={() =>
              run(() =>
                api.post(
                  `${props.lockPath}/${props.id}/regenerate`,
                  props.locked && props.isCharacter ? { keepIdentity: true } : {},
                ),
              )
            }
          >
            <RefreshCw /> 重生
          </Button>
          {props.isCharacter && props.locked && (
            <Button
              variant="ghost"
              size="sm"
              disabled={disabled}
              title="用鎖定圖重生近臉特寫"
              onClick={() => run(() => api.post(`${props.lockPath}/${props.id}/regenerate`, { face: true }))}
            >
              <RefreshCw /> 近臉
            </Button>
          )}
          {props.locked && (
            <Button
              variant="ghost"
              size="sm"
              disabled={disabled}
              onClick={() => run(() => api.post(`${props.lockPath}/${props.id}/lock`, { unlock: true }))}
            >
              重新揀圖
            </Button>
          )}
        </div>
      </div>
      {props.desc && <p className="text-sm text-muted-foreground">{props.desc}</p>}
      {editing && (
        <div className="space-y-1">
          <Textarea
            value={promptDraft}
            onChange={(e) => setPromptDraft(e.target.value)}
            onBlur={savePrompt}
            rows={3}
            placeholder="生成提示詞（外貌／環境描述）"
          />
          <p className="text-xs text-muted-foreground">離開輸入框自動儲存；儲存後撳「重生」先會用新提示詞出圖。</p>
        </div>
      )}

      {props.locked && props.lockedUrl ? (
        <div className="flex items-start gap-3">
          <img
            src={props.lockedUrl}
            alt={props.name}
            className="max-w-[200px] rounded-md object-cover"
            style={{ aspectRatio: "3/4" }}
          />
          {props.faceUrl ? (
            <img
              src={props.faceUrl}
              alt={`${props.name} 近臉特寫`}
              title="近臉特寫 — 鏡頭圖同視頻嘅身份參照"
              className="max-w-24 rounded-md object-cover"
              style={{ aspectRatio: "1/1" }}
            />
          ) : props.showFaceHint ? (
            <span className="mt-1 text-xs text-muted-foreground">近臉特寫生成中…</span>
          ) : null}
        </div>
      ) : props.candidates.length === 0 ? (
        <p className="text-sm text-muted-foreground">未有候選圖。用右下角「下一步」生成資產圖。</p>
      ) : (
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
          {props.candidates.map((mediaId) => {
            const url = props.candidateUrlById[mediaId];
            const chosen = props.chosenId === mediaId;
            return (
              <button
                key={mediaId}
                type="button"
                disabled={busy}
                onClick={() => run(() => api.post(`${props.lockPath}/${props.id}/lock`, { mediaId }))}
                title="揀呢張鎖定"
                className={cn(
                  "aspect-[3/4] overflow-hidden rounded-md border-2 transition-colors",
                  chosen ? "border-primary ring-2 ring-primary" : "border-transparent hover:border-border",
                )}
              >
                {url ? (
                  <img src={url} alt="候選" className="size-full object-cover" />
                ) : (
                  <span className="flex size-full items-center justify-center text-xs text-muted-foreground">
                    無圖
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
      {err && <p className="text-sm text-destructive">{err}</p>}
    </div>
  );
}

// ---------- ③ 劇本站 ----------
const SCRIPT_FLAG_LABEL: Record<string, string> = {
  no_purpose: "冇戲劇目的",
  unnatural_dialogue: "對白唔似人話",
  pacing_drag: "節奏拖",
  weak_hook: "鉤子弱",
  telling_not_showing: "講而不演",
};
const LEVEL_EMOJI: Record<string, string> = { ok: "🟢", review: "🟡", problem: "🔴" };

// 劇本體檢燈 — review-by-exception：只展開 🟡🔴 場，🟢 收埋一行。純資訊，唔閘流程。
function ScriptReviewLights({ review }: { review: ScriptReviewView }) {
  const flagged = review.scenes.filter((s) => s.risk.level !== "ok");
  const okCount = review.scenes.length - flagged.length;
  return (
    <div className="mt-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">
          {LEVEL_EMOJI[review.overall.level]} 總評
        </Badge>
        <span className="text-sm">{review.overall.note}</span>
      </div>
      {flagged.map((s) => (
        <div key={s.index} className="flex flex-wrap items-center gap-2 text-sm">
          <span>{LEVEL_EMOJI[s.risk.level]}</span>
          <Badge variant="outline">{s.label || `第 ${s.index} 場`}</Badge>
          {s.risk.flags.map((f) => (
            <Badge key={f} variant="secondary" className="text-amber-500">
              {SCRIPT_FLAG_LABEL[f] ?? f}
            </Badge>
          ))}
          <span className="text-muted-foreground">{s.risk.note}</span>
        </div>
      ))}
      {okCount > 0 && (
        <p className="text-xs text-muted-foreground">
          其餘 {okCount} 場 🟢 穩妥，唔使深審。改完劇本可再撳「劇本體檢」重驗。
        </p>
      )}
    </div>
  );
}

export function ScriptPanel({ view, progress }: PanelProps) {
  const [text, setText] = useState(view.episode.scriptText);
  const [dirty, setDirty] = useState(false);
  // REWRITE_SCRIPT finishing invalidates the episode query — sync the textarea
  // unless the user has local edits (found in browser QA: script stayed blank
  // until reload).
  useEffect(() => {
    if (!dirty) setText(view.episode.scriptText);
  }, [view.episode.scriptText, dirty]);
  const epId = view.episode.id;
  const save = useAction(qk.episode(epId));
  const regen = useAction(qk.episode(epId));
  const checkup = useAction(qk.episode(epId));
  const review = view.episode.scriptReview;
  const hasReview = !!review && Array.isArray((review as { scenes?: unknown[] }).scenes);

  return (
    <Station
      stage="script"
      progress={progress}
      action={
        <>
          <Button
            size="sm"
            disabled={save.busy || !dirty}
            onClick={() =>
              save.run(async () => {
                await api.patch(`/api/episodes/${epId}/script`, { scriptText: text });
                setDirty(false);
              })
            }
          >
            {save.busy ? <Loader2 className="animate-spin" /> : dirty ? "儲存" : "已儲存"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={regen.busy}
            onClick={() => regen.run(() => api.post(`/api/episodes/${epId}/rewrite-script`))}
          >
            {regen.busy ? <Loader2 className="animate-spin" /> : "重新生成"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={checkup.busy || view.episode.scriptText.length === 0}
            title="按檢查清單逐場標風險燈：戲劇目的/對白/節奏/鉤子/展示不明說"
            onClick={() => checkup.run(() => api.post(`/api/episodes/${epId}/script-review`))}
          >
            {checkup.busy ? <Loader2 className="animate-spin" /> : "🩺 劇本體檢"}
          </Button>
        </>
      }
    >
      <div className="space-y-2">
        {view.episode.scriptText.length === 0 && !dirty ? (
          <EmptyState>仲未有劇本。用右下角「下一步」或上面「重新生成」生成劇本。</EmptyState>
        ) : (
          <Textarea
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setDirty(true);
            }}
            rows={14}
          />
        )}
        {(save.err || regen.err || checkup.err) && (
          <p className="text-sm text-destructive">{save.err ?? regen.err ?? checkup.err}</p>
        )}
        {hasReview && <ScriptReviewLights review={review as ScriptReviewView} />}
      </div>
    </Station>
  );
}

// ---------- ④ 分鏡站 ----------
export function StoryboardPanel({ view, progress }: PanelProps) {
  const { shots } = view;
  const epId = view.episode.id;
  const confirm = useAction(qk.episode(epId));
  const regen = useAction(qk.episode(epId));
  return (
    <Station
      stage="storyboard"
      progress={progress}
      action={
        shots.length > 0 && (
          <>
            <Button
              size="sm"
              variant="outline"
              disabled={regen.busy || confirm.busy}
              title="重新規劃分鏡（會重簽空間契約）。已生成嘅鏡頭圖／視頻會被清走，要重新生成。"
              onClick={() => {
                if (!window.confirm("重新生成分鏡會清走所有現有鏡頭（包括已生成嘅圖同視頻），確定？")) return;
                regen.run(() => api.post(`/api/episodes/${epId}/storyboard`));
              }}
            >
              {regen.busy ? <Loader2 className="animate-spin" /> : "🔄 重新生成分鏡"}
            </Button>
            <Button
              size="sm"
              disabled={confirm.busy || regen.busy}
              onClick={() => confirm.run(() => api.post(`/api/episodes/${epId}/storyboard/confirm`))}
            >
              {confirm.busy ? <Loader2 className="animate-spin" /> : "確認分鏡"}
            </Button>
          </>
        )
      }
    >
      {shots.length === 0 ? (
        <EmptyState>仲未有分鏡。用右下角「下一步」生成分鏡。</EmptyState>
      ) : (
        <>
          {/* 成本預覽（M3 預算護欄）：確認前俾用戶睇清楚下游會使幾多錢 */}
          {view.cost?.downstream && view.cost.downstream.totalUsd > 0 && (
            <div className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
              ⚠️ 確認後下游生成預估成本：<b>~US${view.cost.downstream.totalUsd.toFixed(2)}</b>
              {"　"}（{view.cost.downstream.pendingImages} 圖 ≈ ${view.cost.downstream.estImageUsd.toFixed(2)} ·{" "}
              {view.cost.downstream.pendingVideos} 視頻 ≈ ${view.cost.downstream.estVideoUsd.toFixed(2)}
              {view.cost.downstream.videoUnitUsd ? `，每鏡 $${view.cost.downstream.videoUnitUsd.toFixed(2)}` : ""}）
              {"　"}本專案已使 ${view.cost.projectSpendUsd.toFixed(2)}
            </div>
          )}
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-11">#</TableHead>
                  <TableHead className="w-[90px]">景別</TableHead>
                  <TableHead className="w-[120px]">運鏡</TableHead>
                  <TableHead className="min-w-[200px]">原文片段</TableHead>
                  <TableHead className="min-w-[260px]">圖像 Prompt</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shots.map((sh) => (
                  <TableRow key={sh.id}>
                    <TableCell>{sh.shotIndex}</TableCell>
                    <TableCell>{sh.storyboardJson.detail?.shotSize ?? "—"}</TableCell>
                    <TableCell>{sh.storyboardJson.detail?.camera ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{sh.storyboardJson.plan?.source_text ?? "—"}</TableCell>
                    <TableCell>
                      <ShotPromptCell shot={sh} episodeId={epId} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
      {confirm.err && <p className="mt-2 text-sm text-destructive">{confirm.err}</p>}
    </Station>
  );
}

function ShotPromptCell({ shot, episodeId }: { shot: ShotView; episodeId: string }) {
  const [val, setVal] = useState(shot.imagePrompt);
  const [videoVal, setVideoVal] = useState(shot.videoPrompt);
  const { busy, run } = useAction(qk.episode(episodeId));
  return (
    <div className="flex flex-col gap-1">
      <Textarea
        value={val}
        disabled={busy}
        onChange={(e) => setVal(e.target.value)}
        onBlur={() => {
          if (val !== shot.imagePrompt) run(() => api.patch(`/api/shots/${shot.id}`, { imagePrompt: val }), { refetch: false });
        }}
        placeholder="圖像 prompt…"
        className="min-h-16"
      />
      <Textarea
        value={videoVal}
        disabled={busy}
        onChange={(e) => setVideoVal(e.target.value)}
        onBlur={() => {
          if (videoVal !== shot.videoPrompt) run(() => api.patch(`/api/shots/${shot.id}`, { videoPrompt: videoVal }), { refetch: false });
        }}
        placeholder="視頻 prompt（動作/運鏡；留空則用分鏡自動生成嗰版）…"
        title="重生視頻前可以喺度改動作與運鏡描述"
        className="min-h-16"
      />
    </div>
  );
}

// ---------- ⑤ 圖像站 / ⑥ 視頻站 ----------
function ShotMediaGrid({
  shots,
  media,
  episodeId,
  live,
}: {
  shots: ShotView[];
  media: "image" | "video";
  episodeId: string;
  live?: LiveTaskMap;
}) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
      {shots.map((sh) => (
        <ShotMediaCell key={sh.id} shot={sh} media={media} episodeId={episodeId} live={live} />
      ))}
    </div>
  );
}

function ShotMediaCell({
  shot,
  media,
  episodeId,
  live,
}: {
  shot: ShotView;
  media: "image" | "video";
  episodeId: string;
  live?: LiveTaskMap;
}) {
  const { busy, err, run } = useAction(qk.episode(episodeId));
  const url = media === "image" ? shot.imageUrl : shot.videoUrl;
  const endpoint = media === "image" ? "generate-image" : "generate-video";

  // In-flight = server said so at view load (survives reloads) OR the live SSE
  // stream says so now. Locks the button — the server-side dedupeActive guard is
  // the backstop, this is the UX. Live progress (if any) wins over the snapshot's.
  const taskType = media === "image" ? "IMAGE_SHOT" : "VIDEO_SHOT";
  const liveState = live?.[`${taskType}:${shot.id}`];
  const serverTask = media === "image" ? shot.activeImageTask : shot.activeVideoTask;
  const inFlight = Boolean(liveState) || Boolean(serverTask);
  const pct = liveState?.progress ?? serverTask?.progress;

  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="relative aspect-video bg-muted">
        {url ? (
          media === "image" ? (
            <img className="size-full object-cover" src={url} alt={`鏡 ${shot.shotIndex}`} />
          ) : (
            <video className="size-full object-cover" src={url} controls preload="metadata" />
          )
        ) : (
          <div className="flex size-full items-center justify-center">
            <span className="text-xs text-muted-foreground">
              {inFlight ? (
                <span className="inline-flex items-center gap-1">
                  <Loader2 className="size-3 animate-spin" /> 生成中{pct ? ` ${pct}%` : "…"}
                </span>
              ) : (
                "未生成"
              )}
            </span>
          </div>
        )}
      </div>
      <div className="flex items-center justify-between gap-2 p-2">
        <span className="text-xs text-muted-foreground">鏡 {shot.shotIndex}</span>
        <Button
          size="sm"
          variant="outline"
          disabled={busy || inFlight}
          onClick={() => run(() => api.post(`/api/shots/${shot.id}/${endpoint}`))}
        >
          {busy || inFlight ? (
            <>
              <Loader2 className="animate-spin" /> {inFlight ? `生成中${pct ? ` ${pct}%` : ""}` : ""}
            </>
          ) : url ? (
            "重生"
          ) : (
            "生成"
          )}
        </Button>
      </div>
      {err && <p className="px-2 pb-2 text-xs text-destructive">{err}</p>}
    </div>
  );
}

// Station header chip: which model this station will actually generate with
// right now (resolved system/user/project default) + its per-unit price.
// fake::* gets a distinct warning tint — the original fix for the "project
// silently used fake::video and shipped an empty clip" incident.
function ModelChip({
  icon,
  unit,
  model,
}: {
  icon: string;
  unit: string;
  model?: { modelKey: string; unitUsd: number | null } | null;
}) {
  if (!model) return null;
  const fake = isFakeModel(model.modelKey);
  return (
    <Badge variant={fake ? "destructive" : "outline"}>
      {icon} {shortModelName(model.modelKey)}
      {model.unitUsd !== null && ` · ~$${model.unitUsd.toFixed(2)}/${unit}`}
    </Badge>
  );
}

export function ImagesPanel({ view, progress, live }: PanelProps) {
  return (
    <Station
      stage="images"
      progress={progress}
      action={<ModelChip icon="🖼️" unit="張" model={view.cost?.activeModels?.image} />}
    >
      {view.shots.length === 0 ? (
        <EmptyState>先完成分鏡站。</EmptyState>
      ) : (
        <ShotMediaGrid shots={view.shots} media="image" episodeId={view.episode.id} live={live} />
      )}
    </Station>
  );
}

export function VideosPanel({ view, progress, live }: PanelProps) {
  return (
    <Station
      stage="videos"
      progress={progress}
      action={<ModelChip icon="🎬" unit="鏡" model={view.cost?.activeModels?.video} />}
    >
      {view.shots.length === 0 ? (
        <EmptyState>先完成分鏡站。</EmptyState>
      ) : (
        <ShotMediaGrid shots={view.shots} media="video" episodeId={view.episode.id} live={live} />
      )}
    </Station>
  );
}

// ---------- ⑦ 配音站 ----------
export function VoicePanel({ view, progress }: PanelProps) {
  const { voiceLines } = view;
  return (
    <Station stage="voice" progress={progress}>
      {voiceLines.length === 0 ? (
        <EmptyState>仲未有台詞。用右下角「下一步」分析台詞並配音。</EmptyState>
      ) : (
        <div className="flex flex-col gap-3">
          {voiceLines.map((v) => (
            <div key={v.id} className="flex items-start gap-3 rounded-lg border p-3">
              <Badge variant="outline" className="shrink-0">
                {v.speaker || "旁白"}
              </Badge>
              {v.lineType === "vo" && (
                <Badge variant="secondary" className="shrink-0 text-violet-400" title="Voice Over：旁白/內心獨白，場內人聽不到">
                  VO
                </Badge>
              )}
              {v.lineType === "os" && (
                <Badge variant="secondary" className="shrink-0 text-sky-400" title="Off-Screen：人在場景內但不在畫面">
                  OS
                </Badge>
              )}
              <div className="min-w-0 flex-1">
                <div className="text-sm">
                  {v.cue ? <span className="text-muted-foreground">（{v.cue}）</span> : null}
                  {v.content}
                </div>
                {v.emotion && (
                  <div className="text-xs text-muted-foreground">
                    情緒：{v.emotion}（{v.emotionStrength.toFixed(2)}）
                  </div>
                )}
              </div>
              {v.audioUrl ? (
                <audio src={v.audioUrl} controls preload="none" className="h-8 shrink-0" />
              ) : (
                <span className="shrink-0 text-xs text-muted-foreground">待配音</span>
              )}
            </div>
          ))}
        </div>
      )}
    </Station>
  );
}

// ---------- ⑧ 成片站 ----------
export function ExportPanel({ view, progress }: PanelProps) {
  const url = view.episode.exportUrl;
  return (
    <Station stage="export" progress={progress}>
      {url ? (
        <div className="space-y-4 text-center">
          <video src={url} controls className="mx-auto w-full max-w-90 rounded-lg bg-black" />
          <Button asChild>
            <a href={url} download>
              下載成片 MP4
            </a>
          </Button>
        </div>
      ) : (
        <EmptyState>仲未合成。完成前面各站後，用右下角「下一步」合成整集並導出。</EmptyState>
      )}
    </Station>
  );
}

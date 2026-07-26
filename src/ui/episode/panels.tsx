"use client";
import { useEffect, useState, type ReactNode } from "react";
import {
  Check,
  Clapperboard,
  Code2,
  FileText,
  Film,
  Image as ImageIcon,
  LayoutGrid,
  Loader2,
  Maximize2,
  Mic,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Trash2,
  Upload,
  Users,
  X,
  ZoomIn,
  type LucideIcon,
} from "lucide-react";
import { api } from "@/ui/api";
import { useAction } from "@/ui/planning/useAction";
import { qk } from "@/ui/query-keys";
import { useAdvancedMode } from "@/ui/prompts/useAdvancedMode";
import { StationPromptSheet } from "@/ui/prompts/StationPromptSheet";
import type { EpisodeView, LiveTaskMap, StageKey, ShotView, ScriptReviewView, VoiceLineView } from "@/ui/types";
import { STATION_BY_KEY } from "./stations";
import { useStationNav } from "./station-nav";
import { SavedHint, useAutosaveField, useSavedFlash } from "./SavedHint";
import { ShotWorkbench } from "./ShotWorkbench";
import { shortModelName, isFakeModel } from "@/ui/model-format";
import { formatUsdDisplay } from "./cost-confirm";
import { cn } from "@/lib/utils";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { MediaLightbox, type MediaLightboxMedia } from "@/components/media-lightbox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  live?: LiveTaskMap;
}

function Station({
  stage,
  progress,
  action,
  children,
  episodeId,
  promptIds,
}: {
  stage: StageKey;
  progress?: Partial<Record<StageKey, number>>;
  action?: ReactNode;
  children: ReactNode;
  episodeId?: string;
  promptIds?: string[];
}) {
  const meta = STATION_BY_KEY[stage];
  const pct = progress?.[stage];
  const { advancedMode } = useAdvancedMode();
  const [sheetOpen, setSheetOpen] = useState(false);
  const showPromptButton = advancedMode && !!episodeId && !!promptIds && promptIds.length > 0;
  return (
    <Card id={meta.dom} className="scroll-mt-20">
      <CardHeader className="flex-row items-center gap-3 [&>div]:min-w-0">
        {/* Real heading, not a styled div — the station title is the h2 under the
            page's h1, so screen-reader users can navigate the pipeline by heading. */}
        <div className="min-w-0">
          <CardTitle asChild className="text-base">
            <h2>
              第 {meta.index} 站 · {meta.name}
            </h2>
          </CardTitle>
          {meta.hint && <p className="text-xs text-muted-foreground">{meta.hint}</p>}
        </div>
        {typeof pct === "number" && (
          <Badge variant="secondary" className="text-primary">
            生成中 {pct}%
          </Badge>
        )}
        <div className="ml-auto flex items-center gap-2">
          {showPromptButton && (
            <Button
              variant="ghost"
              size="icon"
              title="睇呢站實際送出嘅 Prompt"
              onClick={() => setSheetOpen(true)}
            >
              <Code2 />
            </Button>
          )}
          {action}
        </div>
      </CardHeader>
      <CardContent>{children}</CardContent>
      {showPromptButton && episodeId && promptIds && (
        <StationPromptSheet
          episodeId={episodeId}
          promptIds={promptIds}
          open={sheetOpen}
          onOpenChange={setSheetOpen}
        />
      )}
    </Card>
  );
}

const EMPTY_ICON: Record<StageKey, LucideIcon> = {
  input: FileText,
  assets: Users,
  script: FileText,
  storyboard: LayoutGrid,
  images: ImageIcon,
  videos: Clapperboard,
  voice: Mic,
  export: Film,
};

function EmptyState({ view, stage, children }: { view: EpisodeView; stage: StageKey; children: ReactNode }) {
  const goToStation = useStationNav();
  const { busy, err, run } = useAction(qk.episode(view.episode.id));
  const next = view.nextAction;
  const isMine = next.stage === stage && !!next.endpoint;
  const target = STATION_BY_KEY[next.stage];
  const running = busy || next.busy;
  const Icon = EMPTY_ICON[stage];

  return (
    <div className="rounded-lg border border-dashed p-6 text-center">
      <Icon className="mx-auto mb-2 size-8 text-muted-foreground/40" aria-hidden />
      <p className="text-sm text-muted-foreground">{children}</p>
      {isMine ? (
        <Button
          className="mt-3"
          disabled={running}
          aria-busy={running}
          onClick={() => run(() => api.post(next.endpoint!))}
        >
          {running ? (
            <>
              <Loader2 className="animate-spin" /> 進行中…
            </>
          ) : (
            next.label
          )}
        </Button>
      ) : (
        <Button variant="link" size="sm" className="mt-1" onClick={() => goToStation(next.stage)}>
          先去第 {target.index} 站 · {target.name} →
        </Button>
      )}
      {err && <p className="mt-2 text-sm text-destructive">{err}</p>}
    </div>
  );
}

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

export function AssetsPanel({ view, progress, live }: PanelProps) {
  const { characters, locations, candidateUrlById } = view;
  const episodeId = view.episode.id;
  const empty = characters.length === 0 && locations.length === 0;
  return (
    <Station stage="assets" progress={progress} episodeId={episodeId} promptIds={["extract_assets"]}>
      {empty ? (
        <EmptyState view={view} stage="assets">仲未抽到角色／場景，系統會由劇本讀出人物同地點。</EmptyState>
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
              refFaceUrl={c.refFaceUrl}
              refFaceNote={c.refFaceNote}
              imageRefSupported={view.imageRefSupported}
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
  refFaceUrl?: string | null;
  refFaceNote?: string;
  imageRefSupported?: boolean;
  locked: boolean;
  lockPath: string;
  liveState: { progress?: number } | null;
  candidateUrlById: Record<string, string>;
  episodeId: string;
}) {
  const { busy, err, run } = useAction(qk.episode(props.episodeId));
  const { saved, flash } = useSavedFlash();
  const [editing, setEditing] = useState(false);
  const [promptDraft, setPromptDraft] = useState(props.prompt);
  const [lightbox, setLightbox] = useState<MediaLightboxMedia | null>(null);
  useEffect(() => {
    if (!editing) setPromptDraft(props.prompt);
  }, [props.prompt, editing]);

  const inFlight = props.liveState !== null;
  const pct = props.liveState?.progress;
  const disabled = busy || inFlight;

  async function savePrompt() {
    if (promptDraft === props.prompt) return;
    if (await run(() => api.patch(`${props.lockPath}/${props.id}`, { [props.promptField]: promptDraft }))) flash();
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
            title={
              props.candidates.length === 0 && !props.locked
                ? "生成 3 張候選圖"
                : props.locked && props.isCharacter
                  ? "保留身份重生候選圖"
                  : "重新生成候選圖"
            }
            onClick={() =>
              run(() =>
                api.post(
                  `${props.lockPath}/${props.id}/regenerate`,
                  props.locked && props.isCharacter ? { keepIdentity: true } : {},
                ),
              )
            }
          >
            <RefreshCw /> {props.candidates.length === 0 && !props.locked ? "生成" : "重生"}
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
      {/* disabled gates on busy only, NOT inFlight: a running generation task
          already read the old row, so swapping the reference face mid-flight is
          safe and only affects the next generation. Gating on inFlight made the
          slot go dead for the whole auto face-close-up run right after locking. */}
      {props.isCharacter && (
        <RefFaceSlot
          characterId={props.id}
          name={props.name}
          refFaceUrl={props.refFaceUrl ?? null}
          refFaceNote={props.refFaceNote ?? ""}
          imageRefSupported={props.imageRefSupported ?? true}
          episodeId={props.episodeId}
          disabled={busy}
          onLightbox={setLightbox}
        />
      )}
      {editing && (
        <div className="space-y-1">
          <Textarea
            value={promptDraft}
            onChange={(e) => setPromptDraft(e.target.value)}
            onBlur={savePrompt}
            rows={3}
            placeholder="生成提示詞（外貌／環境描述）"
          />
          <div className="flex items-center gap-2">
            <p className="text-xs text-muted-foreground">離開輸入框自動儲存；儲存後撳「重生」先會用新提示詞出圖。</p>
            <SavedHint saved={saved} />
          </div>
        </div>
      )}

      {props.locked && props.lockedUrl ? (
        <div className="flex items-start gap-3">
          <button
            type="button"
            className="cursor-zoom-in"
            onClick={() => setLightbox({ src: props.lockedUrl as string, type: "image", title: props.name })}
          >
            <img
              src={props.lockedUrl}
              alt={props.name}
              className="max-w-[200px] rounded-md object-cover"
              style={{ aspectRatio: "3/4" }}
            />
          </button>
          {props.faceUrl ? (
            <button
              type="button"
              className="cursor-zoom-in"
              onClick={() => setLightbox({ src: props.faceUrl as string, type: "image", title: `${props.name} 近臉特寫` })}
            >
              <img
                src={props.faceUrl}
                alt={`${props.name} 近臉特寫`}
                title="近臉特寫 — 鏡頭圖同視頻嘅身份參照"
                className="max-w-24 rounded-md object-cover"
                style={{ aspectRatio: "1/1" }}
              />
            </button>
          ) : props.showFaceHint ? (
            <span className="mt-1 text-xs text-muted-foreground">未有近臉特寫 — 撳「近臉」可以生成，令鏡頭圖面容更一致（可選）</span>
          ) : null}
        </div>
      ) : props.candidates.length === 0 ? (
        <p className="text-sm text-muted-foreground">未有候選圖。撳上面「生成」生成 3 張候選，或喺「下一步」一次過生成全部資產圖。</p>
      ) : (
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
          {props.candidates.map((mediaId) => {
            const url = props.candidateUrlById[mediaId];
            const chosen = props.chosenId === mediaId;
            return (
              <div key={mediaId} className="group relative">
                <button
                  type="button"
                  disabled={busy}
                  aria-pressed={chosen}
                  onClick={() => run(() => api.post(`${props.lockPath}/${props.id}/lock`, { mediaId }))}
                  title={chosen ? "已揀呢張" : "揀呢張鎖定"}
                  aria-label={chosen ? `${props.name} 已揀呢張候選圖` : `揀 ${props.name} 呢張候選圖`}
                  className={cn(
                    "block w-full aspect-[3/4] overflow-hidden rounded-md border-2 transition-colors",
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
                  {/* Non-colour indicator too (WCAG 1.4.1): the ring alone is a
                      colour-only signal for which candidate is locked. */}
                  {chosen && (
                    <span className="absolute top-1 right-1 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                      <Check className="size-3" />
                    </span>
                  )}
                </button>
                {url && (
                  <button
                    type="button"
                    aria-label="放大檢視候選圖"
                    title="放大檢視候選圖"
                    onClick={() => setLightbox({ src: url, type: "image", title: `${props.name} 候選圖` })}
                    className="absolute bottom-1 right-1 z-10 flex size-6 items-center justify-center rounded-md bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                  >
                    <ZoomIn className="size-3.5" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
      {err && <p className="text-sm text-destructive">{err}</p>}
      <MediaLightbox open={!!lightbox} onOpenChange={(o) => !o && setLightbox(null)} media={lightbox} />
    </div>
  );
}

const REF_FACE_ACCEPTED = ["image/jpeg", "image/png", "image/webp"];
const REF_FACE_MAX_BYTES = 10 * 1024 * 1024;

// 墊臉 — upload a reference face used as a face-lock for candidate generation.
// Kept separate from AssetCard because it owns its own upload/note save state
// and client-side validation, independent of the prompt-editing state above it.
function RefFaceSlot({
  characterId,
  name,
  refFaceUrl,
  refFaceNote,
  imageRefSupported,
  episodeId,
  disabled,
  onLightbox,
}: {
  characterId: string;
  name: string;
  refFaceUrl: string | null;
  refFaceNote: string;
  imageRefSupported: boolean;
  episodeId: string;
  disabled: boolean;
  onLightbox: (media: MediaLightboxMedia) => void;
}) {
  const { busy, err, run, setErr } = useAction(qk.episode(episodeId));
  const { saved, flash } = useSavedFlash();
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [note, setNote] = useState(refFaceNote);
  const fileInputId = `ref-face-${characterId}`;
  useEffect(() => setNote(refFaceNote), [refFaceNote]);

  const busyAll = busy || uploading || disabled;

  async function doUpload(file: File) {
    if (!REF_FACE_ACCEPTED.includes(file.type)) {
      setErr("只支援 JPEG／PNG／WebP 格式");
      return;
    }
    if (file.size > REF_FACE_MAX_BYTES) {
      setErr("檔案超過 10MB 上限");
      return;
    }
    const form = new FormData();
    form.append("file", file);
    setUploading(true);
    try {
      await run(() => api.upload(`/api/characters/${characterId}/ref-face`, form));
    } finally {
      setUploading(false);
    }
  }

  async function saveNote() {
    if (note === refFaceNote) return;
    if (await run(() => api.patch(`/api/characters/${characterId}`, { refFaceNote: note }))) flash();
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-start gap-3">
        {refFaceUrl ? (
          <div className="group relative shrink-0">
            <button
              type="button"
              className="cursor-zoom-in"
              onClick={() => onLightbox({ src: refFaceUrl, type: "image", title: `${name} 參考臉` })}
            >
              <img
                src={refFaceUrl}
                alt={`${name} 參考臉`}
                className="size-24 rounded-md object-cover"
                style={{ aspectRatio: "1/1" }}
              />
            </button>
            <button
              type="button"
              aria-label="移除參考臉"
              title="移除參考臉"
              disabled={busyAll}
              onClick={() => run(() => api.del(`/api/characters/${characterId}/ref-face`))}
              className="absolute top-1 right-1 z-10 flex size-5 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
            >
              <X className="size-3" />
            </button>
          </div>
        ) : (
          <label
            htmlFor={fileInputId}
            className={cn(
              "flex size-24 shrink-0 cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed text-muted-foreground transition-colors",
              dragOver && "border-primary bg-primary/5",
              busyAll && "pointer-events-none opacity-60",
            )}
            style={{ aspectRatio: "1/1" }}
            title="上載一張參考臉相，生成出嚟嘅角色會用呢張臉"
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const file = e.dataTransfer.files?.[0];
              if (file) void doUpload(file);
            }}
          >
            {uploading ? <Loader2 className="size-5 animate-spin" aria-hidden /> : <Upload className="size-5" aria-hidden />}
            <span className="text-xs">{uploading ? "上載中…" : "墊臉"}</span>
            <input
              id={fileInputId}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              disabled={busyAll}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void doUpload(file);
              }}
            />
          </label>
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-1 pt-1">
          {refFaceUrl && (
            <span className="text-xs text-muted-foreground">已墊臉 — 撳「重生」先會用呢張臉出圖</span>
          )}
          {!imageRefSupported && (
            <span className="text-xs text-amber-600 dark:text-amber-500">
              目前圖像模型唔支援參考圖，墊臉唔會生效
            </span>
          )}
          {refFaceUrl && (
            <>
              <Input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                onBlur={saveNote}
                disabled={busyAll}
                placeholder="補充要求（可選）：例如淨係跟塊臉，髮型跟提示詞"
                className="h-8 text-xs"
              />
              <SavedHint saved={saved} />
            </>
          )}
        </div>
      </div>
      {err && <p className="text-xs text-destructive">{err}</p>}
    </div>
  );
}

const SCRIPT_FLAG_LABEL: Record<string, string> = {
  no_purpose: "冇戲劇目的",
  unnatural_dialogue: "對白唔似人話",
  pacing_drag: "節奏拖",
  weak_hook: "鉤子弱",
  telling_not_showing: "講而不演",
};
const LEVEL_EMOJI: Record<string, string> = { ok: "🟢", review: "🟡", problem: "🔴" };

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
  useEffect(() => {
    if (!dirty) setText(view.episode.scriptText);
  }, [view.episode.scriptText, dirty]);
  const epId = view.episode.id;
  const save = useAction(qk.episode(epId));
  const regen = useAction(qk.episode(epId));
  const checkup = useAction(qk.episode(epId));
  const review = view.episode.scriptReview;
  const hasReview = !!review && Array.isArray((review as { scenes?: unknown[] }).scenes);
  const anyBusy = save.busy || regen.busy || checkup.busy;
  const isEmpty = view.episode.scriptText.length === 0 && !dirty;

  return (
    <Station
      stage="script"
      progress={progress}
      episodeId={epId}
      promptIds={["rewrite_script", "script_review"]}
      action={
        isEmpty ? null : (
          <>
            <Button
              size="sm"
              disabled={anyBusy || !dirty}
              aria-busy={save.busy}
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
              disabled={anyBusy}
              aria-busy={regen.busy}
              onClick={() => regen.run(() => api.post(`/api/episodes/${epId}/rewrite-script`))}
            >
              {regen.busy ? <Loader2 className="animate-spin" /> : "重新生成"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={anyBusy || view.episode.scriptText.length === 0}
              aria-busy={checkup.busy}
              title="按檢查清單逐場標風險燈：戲劇目的/對白/節奏/鉤子/展示不明說"
              onClick={() => checkup.run(() => api.post(`/api/episodes/${epId}/script-review`))}
            >
              {checkup.busy ? <Loader2 className="animate-spin" /> : "🩺 劇本體檢"}
            </Button>
          </>
        )
      }
    >
      <div className="space-y-2">
        {isEmpty ? (
          <EmptyState view={view} stage="script">仲未有劇本。可以由原文改寫生成，生成之後隨時可以手動編輯。</EmptyState>
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

export function StoryboardPanel({ view, progress }: PanelProps) {
  const { shots } = view;
  const epId = view.episode.id;
  const confirm = useAction(qk.episode(epId));
  const regen = useAction(qk.episode(epId));
  const [regenConfirmOpen, setRegenConfirmOpen] = useState(false);
  const [confirmStoryboardOpen, setConfirmStoryboardOpen] = useState(false);
  const spentSoFar = view.cost?.projectSpendUsd;
  const downstream = view.cost?.downstream;
  const assistedAutoAdvance = view.episode.autoAdvance?.enabled && view.episode.autoAdvance.mode === "assisted";

  function runConfirmStoryboard() {
    confirm.run(() =>
      api.post(`/api/episodes/${epId}/storyboard/confirm`, assistedAutoAdvance ? { authorizeDownstream: true } : {}),
    );
  }
  return (
    <Station
      stage="storyboard"
      progress={progress}
      episodeId={epId}
      promptIds={["build_scenes", "storyboard_plan", "storyboard_photography", "storyboard_acting", "storyboard_detail"]}
      action={
        shots.length > 0 && (
          <>
            {}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" disabled={regen.busy || confirm.busy} aria-label="更多分鏡操作">
                  {regen.busy ? <Loader2 className="animate-spin" /> : <MoreHorizontal />}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem variant="destructive" onSelect={() => setRegenConfirmOpen(true)}>
                  <RefreshCw /> 重新生成分鏡（會清走現有鏡頭）
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <ConfirmDialog
              open={regenConfirmOpen}
              onOpenChange={setRegenConfirmOpen}
              title="重新生成分鏡？"
              description={
                <>
                  重新規劃分鏡會清走所有現有鏡頭（包括已生成嘅圖像／視頻），要重新生成。
                  <br />
                  已生成嘅圖像／視頻會被捨棄，已花費嘅成本唔會退返
                  {typeof spentSoFar === "number" && spentSoFar > 0
                    ? `（本專案已使 $${spentSoFar.toFixed(2)}）`
                    : ""}
                  。
                </>
              }
              destructive
              confirmLabel="確定重新生成"
              onConfirm={() => regen.run(() => api.post(`/api/episodes/${epId}/storyboard`))}
            />
            <Button
              size="sm"
              disabled={confirm.busy || regen.busy}
              aria-busy={confirm.busy}
              onClick={() => setConfirmStoryboardOpen(true)}
            >
              {confirm.busy ? <Loader2 className="animate-spin" /> : "確認分鏡"}
            </Button>
            <ConfirmDialog
              open={confirmStoryboardOpen}
              onOpenChange={setConfirmStoryboardOpen}
              title="確認分鏡，開始生成？"
              description={
                <>
                  {downstream && downstream.totalUsd > 0 ? (
                    <>
                      圖像 {downstream.pendingImages} 張 ≈ {formatUsdDisplay(downstream.estImageUsd)}、視頻{" "}
                      {downstream.pendingVideos} 鏡 ≈ {formatUsdDisplay(downstream.estVideoUsd)}、配音（上限）≈{" "}
                      {formatUsdDisplay(downstream.estVoiceUsd)}，總計 ≈{" "}
                      <b>{formatUsdDisplay(downstream.totalUsd)}</b>
                    </>
                  ) : (
                    "確認後會開始生成後續步驟。"
                  )}
                  {assistedAutoAdvance && (
                    <p className="mt-2">
                      確認即係授權自動行到成片 — 圖像、視頻、配音會自動接力生成，唔會逐站再問。想逐站控制，可以先較熄「自動行進」。
                    </p>
                  )}
                </>
              }
              confirmLabel="確認分鏡並開始"
              onConfirm={runConfirmStoryboard}
            />
          </>
        )
      }
    >
      {shots.length === 0 ? (
        <EmptyState view={view} stage="storyboard">仲未有分鏡。導演組會分四階段規劃鏡頭：規劃 → 攝影 → 表演 → 細節。</EmptyState>
      ) : (
        <>
          {}
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
                  <TableHead className="w-11" />
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
                    <TableCell>
                      <DeleteShotButton shot={sh} episodeId={epId} />
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

// Delete a single shot (火豹 #19「鏡頭唔支援刪除」). The server closes the index
// gap so the remaining shots stay 1..N — no manual renumbering.
function DeleteShotButton({ shot, episodeId }: { shot: ShotView; episodeId: string }) {
  const { busy, run } = useAction(qk.episode(episodeId));
  const [open, setOpen] = useState(false);
  const hasMedia = Boolean(shot.imageMediaId || shot.videoMediaId);
  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        disabled={busy}
        aria-busy={busy}
        aria-label={`刪除鏡 ${shot.shotIndex}`}
        title="刪除呢個鏡頭"
        onClick={() => setOpen(true)}
      >
        {busy ? <Loader2 className="animate-spin" /> : <Trash2 />}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={`刪除鏡 ${shot.shotIndex}？`}
        description={
          hasMedia
            ? "呢個鏡頭已生成嘅圖像／視頻會一併刪走，之後嘅鏡頭會自動重新編號。已花費嘅成本唔會退返。"
            : "之後嘅鏡頭會自動重新編號。"
        }
        destructive
        confirmLabel="確定刪除"
        onConfirm={() => run(() => api.del(`/api/shots/${shot.id}`))}
      />
    </>
  );
}

function ShotPromptCell({ shot, episodeId }: { shot: ShotView; episodeId: string }) {
  const { busy, run } = useAction(qk.episode(episodeId));
  // Each field gets its own autosave state (independent dirty ref), so saving the
  // image prompt can't wipe the video prompt's in-progress edit. refetch:false —
  // useAutosaveField advances its baseline on save so the field never reverts.
  const image = useAutosaveField(shot.imagePrompt, (v) =>
    run(() => api.patch(`/api/shots/${shot.id}`, { imagePrompt: v }), { refetch: false }),
  );
  const video = useAutosaveField(shot.videoPrompt, (v) =>
    run(() => api.patch(`/api/shots/${shot.id}`, { videoPrompt: v }), { refetch: false }),
  );
  return (
    <div className="flex flex-col gap-1">
      <Textarea
        value={image.text}
        disabled={busy}
        onChange={(e) => image.onChange(e.target.value)}
        onBlur={image.onBlur}
        placeholder="圖像 prompt…"
        className="min-h-16"
      />
      <Textarea
        value={video.text}
        disabled={busy}
        onChange={(e) => video.onChange(e.target.value)}
        onBlur={video.onBlur}
        placeholder="視頻 prompt（動作/運鏡；留空則用分鏡自動生成嗰版）…"
        title="重生視頻前可以喺度改動作與運鏡描述"
        className="min-h-16"
      />
      <SavedHint saved={image.saved || video.saved} />
    </div>
  );
}

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
        <EmptyState view={view} stage="images">先完成分鏡站，確認分鏡表之後先可以逐鏡出圖。</EmptyState>
      ) : (
        <ShotWorkbench view={view} media="image" live={live} unitUsd={view.cost?.activeModels?.image.unitUsd} />
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
        <EmptyState view={view} stage="videos">先完成分鏡站；每個鏡頭要有圖先可以生成視頻。</EmptyState>
      ) : (
        <ShotWorkbench view={view} media="video" live={live} unitUsd={view.cost?.activeModels?.video.unitUsd} />
      )}
    </Station>
  );
}

export function VoicePanel({ view, progress, live }: PanelProps) {
  const { voiceLines, characters } = view;
  return (
    <Station stage="voice" progress={progress} episodeId={view.episode.id} promptIds={["voice_analyze"]}>
      {voiceLines.length === 0 ? (
        <EmptyState view={view} stage="voice">仲未有台詞。系統會由劇本分出對白同旁白，再逐句配音。</EmptyState>
      ) : (
        <div className="flex flex-col gap-3">
          {voiceLines.map((v) => (
            <VoiceLineRow
              key={v.id}
              line={v}
              episodeId={view.episode.id}
              characterNames={characters.map((c) => c.name)}
              liveState={live?.[`TTS_LINE:${v.id}`] ?? v.activeTask ?? null}
            />
          ))}
        </div>
      )}
    </Station>
  );
}

// One editable dialogue line. Speaker is a dropdown of the project's characters
// (plus 旁白) so a mis-attributed line can be re-pointed at the right voice —
// the server re-binds characterId by name. Content autosaves on blur; 重配
// re-synthesizes just this line.
function VoiceLineRow({
  line,
  episodeId,
  characterNames,
  liveState,
}: {
  line: VoiceLineView;
  episodeId: string;
  characterNames: string[];
  liveState: { progress?: number } | null;
}) {
  const edit = useAction(qk.episode(episodeId));
  const regen = useAction(qk.episode(episodeId));
  const { flash } = useSavedFlash();
  const content = useAutosaveField(line.content, (v) =>
    edit.run(() => api.patch(`/api/voice-lines/${line.id}`, { content: v }), { refetch: false }),
  );

  const inFlight = liveState !== null;
  const pct = liveState?.progress;
  // 旁白 is always available; include the current speaker even if it is not a
  // known character so switching away and back does not lose it.
  const speakerOptions = [...new Set(["旁白", ...characterNames, line.speaker].filter(Boolean))];

  async function changeSpeaker(speaker: string) {
    if (speaker === line.speaker) return;
    if (await edit.run(() => api.patch(`/api/voice-lines/${line.id}`, { speaker }))) flash();
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={line.speaker || "旁白"} onValueChange={changeSpeaker} disabled={edit.busy}>
          <SelectTrigger size="sm" className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {speakerOptions.map((name) => (
              <SelectItem key={name} value={name}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {line.lineType === "vo" && (
          <Badge variant="secondary" className="text-violet-400" title="Voice Over：旁白/內心獨白，場內人聽不到">
            VO
          </Badge>
        )}
        {line.lineType === "os" && (
          <Badge variant="secondary" className="text-sky-400" title="Off-Screen：人在場景內但不在畫面">
            OS
          </Badge>
        )}
        {line.emotion && (
          <span className="text-xs text-muted-foreground">
            情緒：{line.emotion}（{line.emotionStrength.toFixed(2)}）
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <SavedHint saved={content.saved} />
          {line.audioUrl && !inFlight ? (
            <audio src={line.audioUrl} controls preload="none" className="h-8" />
          ) : inFlight ? (
            <span className="inline-flex items-center gap-1 text-xs text-primary">
              <Loader2 className="size-3 animate-spin" /> 配音中{typeof pct === "number" ? ` ${pct}%` : "…"}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">待配音</span>
          )}
          <Button
            variant="ghost"
            size="sm"
            disabled={regen.busy || inFlight}
            aria-busy={regen.busy || inFlight}
            title={line.audioUrl ? "改完內容後重新配音（會取代舊音檔）" : "生成呢句配音"}
            onClick={() => regen.run(() => api.post(`/api/voice-lines/${line.id}/regenerate`))}
          >
            <RefreshCw /> {line.audioUrl ? "重配" : "配音"}
          </Button>
        </div>
      </div>
      {line.cue ? <p className="text-xs text-muted-foreground">（{line.cue}）</p> : null}
      <Textarea
        value={content.text}
        disabled={edit.busy}
        onChange={(e) => content.onChange(e.target.value)}
        onBlur={content.onBlur}
        rows={2}
        className="text-sm"
      />
      {(edit.err || regen.err) && <p className="text-sm text-destructive">{edit.err ?? regen.err}</p>}
    </div>
  );
}

export function ExportPanel({ view, progress }: PanelProps) {
  const url = view.episode.exportUrl;
  const [lightbox, setLightbox] = useState<MediaLightboxMedia | null>(null);
  return (
    <Station stage="export" progress={progress}>
      {url ? (
        <div className="space-y-4 text-center">
          <div className="relative mx-auto w-full max-w-90">
            <video src={url} controls className="w-full rounded-lg bg-black" />
            <button
              type="button"
              aria-label="全螢幕檢視"
              title="全螢幕檢視"
              onClick={() => setLightbox({ src: url, type: "video", title: "成片" })}
              className="absolute top-1 right-1 z-10 flex size-6 items-center justify-center rounded-md bg-black/60 text-white"
            >
              <Maximize2 className="size-3.5" />
            </button>
          </div>
          <Button asChild>
            <a href={url} download>
              下載成片 MP4
            </a>
          </Button>
          <MediaLightbox open={!!lightbox} onOpenChange={(o) => !o && setLightbox(null)} media={lightbox} />
        </div>
      ) : (
        <EmptyState view={view} stage="export">仲未合成。完成前面各站之後，會把鏡頭、配音同字幕拼成一條 MP4。</EmptyState>
      )}
    </Station>
  );
}

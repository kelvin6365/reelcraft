"use client";
import { useEffect, useState, type ReactNode } from "react";
import { api, ApiClientError } from "@/ui/api";
import type { EpisodeView, LiveTaskMap, StageKey, ShotView, ScriptReviewView } from "@/ui/types";
import { STATION_BY_KEY } from "./stations";
import { shortModelName, isFakeModel } from "@/ui/model-format";

interface PanelProps {
  view: EpisodeView;
  progress: Partial<Record<StageKey, number>>;
  refetch: () => Promise<void>;
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
    <section id={meta.dom} className="panel">
      <div className="panel-head">
        <h2>
          第 {meta.index} 站 · {meta.name}
        </h2>
        {typeof pct === "number" && <span className="progress-inline">生成中 {pct}%</span>}
        <div style={{ marginLeft: "auto" }}>{action}</div>
      </div>
      {children}
    </section>
  );
}

// Small hook: run a POST/PATCH with local busy + error state, then refetch.
function useAction(refetch: () => Promise<void>) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function run(fn: () => Promise<unknown>, opts: { refetch?: boolean } = { refetch: true }) {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      if (opts.refetch !== false) await refetch();
    } catch (e) {
      setErr((e as ApiClientError).message);
    } finally {
      setBusy(false);
    }
  }
  return { busy, err, run };
}

// ---------- ① 原文 ----------
export function InputPanel({ view }: PanelProps) {
  return (
    <Station stage="input">
      <div className="card">
        <textarea readOnly value={view.episode.rawText} rows={8} style={{ background: "var(--bg-elev-2)" }} />
        <p className="faint" style={{ fontSize: 12, marginBottom: 0 }}>
          原文唯讀。想改內容請喺專案頁重新建立一集。
        </p>
      </div>
    </Station>
  );
}

// ---------- ② 資產站 ----------
export function AssetsPanel({ view, progress, refetch }: PanelProps) {
  const { characters, locations, candidateUrlById } = view;
  const empty = characters.length === 0 && locations.length === 0;
  return (
    <Station stage="assets" progress={progress}>
      {empty ? (
        <div className="empty">仲未抽到角色／場景。用右下角「下一步」抽取資產。</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {characters.map((c) => (
            <AssetCard
              key={c.id}
              id={c.id}
              kind="角色"
              name={c.name}
              desc={c.profile || c.appearancePrompt}
              candidates={c.candidates}
              chosenId={c.lockedImageMediaId}
              lockedUrl={c.lockedImageUrl}
              faceUrl={c.faceImageUrl ?? null}
              showFaceHint
              locked={c.locked}
              lockPath="/api/characters"
              candidateUrlById={candidateUrlById}
              refetch={refetch}
            />
          ))}
          {locations.map((l) => (
            <AssetCard
              key={l.id}
              id={l.id}
              kind="場景"
              name={l.name}
              desc={l.summary || l.prompt}
              candidates={l.candidates}
              chosenId={l.lockedImageMediaId}
              lockedUrl={l.lockedImageUrl}
              locked={l.locked}
              lockPath="/api/locations"
              candidateUrlById={candidateUrlById}
              refetch={refetch}
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
  candidates: string[];
  chosenId: string | null;
  lockedUrl: string | null;
  faceUrl?: string | null;
  showFaceHint?: boolean;
  locked: boolean;
  lockPath: string;
  candidateUrlById: Record<string, string>;
  refetch: () => Promise<void>;
}) {
  const { busy, err, run } = useAction(props.refetch);
  return (
    <div className={`asset-card${props.locked ? " locked" : ""}`}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div className="row" style={{ gap: 8 }}>
          <span className="badge">{props.kind}</span>
          <strong>{props.name}</strong>
          {props.locked && <span className="check">✓ 已鎖定</span>}
        </div>
        {props.locked && (
          <button
            className="btn btn-ghost btn-sm"
            disabled={busy}
            onClick={() => run(() => api.post(`${props.lockPath}/${props.id}/lock`, { unlock: true }))}
          >
            重新揀圖
          </button>
        )}
      </div>
      {props.desc && (
        <p className="muted" style={{ fontSize: 13, marginBottom: 4 }}>
          {props.desc}
        </p>
      )}

      {props.locked && props.lockedUrl ? (
        <div className="row" style={{ gap: 10, alignItems: "flex-start", marginTop: 8 }}>
          <img
            className="thumb"
            src={props.lockedUrl}
            alt={props.name}
            style={{ maxWidth: 200, aspectRatio: "3/4", objectFit: "cover" }}
          />
          {props.faceUrl ? (
            <img
              className="thumb"
              src={props.faceUrl}
              alt={`${props.name} 近臉特寫`}
              title="近臉特寫 — 鏡頭圖同視頻嘅身份參照"
              style={{ maxWidth: 96, aspectRatio: "1/1", objectFit: "cover" }}
            />
          ) : props.showFaceHint ? (
            <span className="faint" style={{ fontSize: 12, marginTop: 4 }}>
              近臉特寫生成中…
            </span>
          ) : null}
        </div>
      ) : props.candidates.length === 0 ? (
        <p className="faint" style={{ fontSize: 13 }}>
          未有候選圖。用右下角「下一步」生成資產圖。
        </p>
      ) : (
        <div className="candidates">
          {props.candidates.map((mediaId) => {
            const url = props.candidateUrlById[mediaId];
            return (
              <button
                key={mediaId}
                className={`candidate${props.chosenId === mediaId ? " chosen" : ""}`}
                disabled={busy}
                onClick={() => run(() => api.post(`${props.lockPath}/${props.id}/lock`, { mediaId }))}
                title="揀呢張鎖定"
              >
                {url ? <img src={url} alt="候選" /> : <span className="faint">無圖</span>}
              </button>
            );
          })}
        </div>
      )}
      {err && <p className="error-text">{err}</p>}
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
    <div style={{ marginTop: 12 }}>
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <span className="badge">{LEVEL_EMOJI[review.overall.level]} 總評</span>
        <span style={{ fontSize: 14 }}>{review.overall.note}</span>
      </div>
      {flagged.map((s) => (
        <div key={s.index} className="row" style={{ gap: 8, marginTop: 8, flexWrap: "wrap", fontSize: 14 }}>
          <span>{LEVEL_EMOJI[s.risk.level]}</span>
          <span className="badge">{s.label || `第 ${s.index} 場`}</span>
          {s.risk.flags.map((f) => (
            <span key={f} className="badge" style={{ color: "#fbbf24" }}>
              {SCRIPT_FLAG_LABEL[f] ?? f}
            </span>
          ))}
          <span className="faint">{s.risk.note}</span>
        </div>
      ))}
      {okCount > 0 && (
        <p className="faint" style={{ fontSize: 12, marginTop: 8 }}>
          其餘 {okCount} 場 🟢 穩妥，唔使深審。改完劇本可再撳「劇本體檢」重驗。
        </p>
      )}
    </div>
  );
}

export function ScriptPanel({ view, progress, refetch }: PanelProps) {
  const [text, setText] = useState(view.episode.scriptText);
  const [dirty, setDirty] = useState(false);
  // REWRITE_SCRIPT finishing refetches the view — sync the textarea unless the
  // user has local edits (found in browser QA: script stayed blank until reload).
  useEffect(() => {
    if (!dirty) setText(view.episode.scriptText);
  }, [view.episode.scriptText, dirty]);
  const save = useAction(refetch);
  const regen = useAction(refetch);
  const checkup = useAction(refetch);
  const epId = view.episode.id;
  const review = view.episode.scriptReview;
  const hasReview = !!review && Array.isArray((review as { scenes?: unknown[] }).scenes);

  return (
    <Station
      stage="script"
      progress={progress}
      action={
        <div className="row" style={{ gap: 8 }}>
          <button
            className="btn btn-sm"
            disabled={save.busy || !dirty}
            onClick={() =>
              save.run(async () => {
                await api.patch(`/api/episodes/${epId}/script`, { scriptText: text });
                setDirty(false);
              })
            }
          >
            {save.busy ? <span className="spinner" /> : dirty ? "儲存" : "已儲存"}
          </button>
          <button
            className="btn btn-sm"
            disabled={regen.busy}
            onClick={() => regen.run(() => api.post(`/api/episodes/${epId}/rewrite-script`))}
          >
            {regen.busy ? <span className="spinner" /> : "重新生成"}
          </button>
          <button
            className="btn btn-sm"
            disabled={checkup.busy || view.episode.scriptText.length === 0}
            title="按檢查清單逐場標風險燈：戲劇目的/對白/節奏/鉤子/展示不明說"
            onClick={() => checkup.run(() => api.post(`/api/episodes/${epId}/script-review`))}
          >
            {checkup.busy ? <span className="spinner" /> : "🩺 劇本體檢"}
          </button>
        </div>
      }
    >
      <div className="card">
        {view.episode.scriptText.length === 0 && !dirty ? (
          <div className="empty">仲未有劇本。用右下角「下一步」或上面「重新生成」生成劇本。</div>
        ) : (
          <textarea
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setDirty(true);
            }}
            rows={14}
          />
        )}
        {(save.err || regen.err || checkup.err) && <p className="error-text">{save.err ?? regen.err ?? checkup.err}</p>}
        {hasReview && <ScriptReviewLights review={review as ScriptReviewView} />}
      </div>
    </Station>
  );
}

// ---------- ④ 分鏡站 ----------
export function StoryboardPanel({ view, progress, refetch }: PanelProps) {
  const { shots } = view;
  const confirm = useAction(refetch);
  const epId = view.episode.id;
  return (
    <Station
      stage="storyboard"
      progress={progress}
      action={
        shots.length > 0 && (
          <button
            className="btn btn-primary btn-sm"
            disabled={confirm.busy}
            onClick={() => confirm.run(() => api.post(`/api/episodes/${epId}/storyboard/confirm`))}
          >
            {confirm.busy ? <span className="spinner" /> : "確認分鏡"}
          </button>
        )
      }
    >
      {shots.length === 0 ? (
        <div className="empty">仲未有分鏡。用右下角「下一步」生成分鏡。</div>
      ) : (
        <>
          {/* 成本預覽（M3 預算護欄）：確認前俾用戶睇清楚下游會使幾多錢 */}
          {view.cost?.downstream && view.cost.downstream.totalUsd > 0 && (
            <div className="cost-preview">
              ⚠️ 確認後下游生成預估成本：<b>~US${view.cost.downstream.totalUsd.toFixed(2)}</b>
              {"　"}（{view.cost.downstream.pendingImages} 圖 ≈ ${view.cost.downstream.estImageUsd.toFixed(2)} ·{" "}
              {view.cost.downstream.pendingVideos} 視頻 ≈ ${view.cost.downstream.estVideoUsd.toFixed(2)}
              {view.cost.downstream.videoUnitUsd ? `，每鏡 $${view.cost.downstream.videoUnitUsd.toFixed(2)}` : ""}）
              {"　"}本專案已使 ${view.cost.projectSpendUsd.toFixed(2)}
            </div>
          )}
          <div className="tbl-wrap">
          <table className="sb">
            <thead>
              <tr>
                <th style={{ width: 44 }}>#</th>
                <th style={{ width: 90 }}>景別</th>
                <th style={{ width: 120 }}>運鏡</th>
                <th style={{ minWidth: 200 }}>原文片段</th>
                <th style={{ minWidth: 260 }}>圖像 Prompt</th>
              </tr>
            </thead>
            <tbody>
              {shots.map((sh) => (
                <tr key={sh.id}>
                  <td>{sh.shotIndex}</td>
                  <td>{sh.storyboardJson.detail?.shotSize ?? "—"}</td>
                  <td>{sh.storyboardJson.detail?.camera ?? "—"}</td>
                  <td className="muted">{sh.storyboardJson.plan?.source_text ?? "—"}</td>
                  <td>
                    <ShotPromptCell shot={sh} refetch={refetch} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </>
      )}
      {confirm.err && <p className="error-text">{confirm.err}</p>}
    </Station>
  );
}

function ShotPromptCell({ shot, refetch }: { shot: ShotView; refetch: () => Promise<void> }) {
  const [val, setVal] = useState(shot.imagePrompt);
  const { busy, run } = useAction(refetch);
  return (
    <textarea
      value={val}
      disabled={busy}
      onChange={(e) => setVal(e.target.value)}
      onBlur={() => {
        if (val !== shot.imagePrompt) run(() => api.patch(`/api/shots/${shot.id}`, { imagePrompt: val }), { refetch: false });
      }}
      placeholder="圖像 prompt…"
    />
  );
}

// ---------- ⑤ 圖像站 / ⑥ 視頻站 ----------
function ShotMediaGrid({
  shots,
  media,
  refetch,
  live,
}: {
  shots: ShotView[];
  media: "image" | "video";
  refetch: () => Promise<void>;
  live?: LiveTaskMap;
}) {
  return (
    <div className="shot-grid">
      {shots.map((sh) => (
        <ShotMediaCell key={sh.id} shot={sh} media={media} refetch={refetch} live={live} />
      ))}
    </div>
  );
}

function ShotMediaCell({
  shot,
  media,
  refetch,
  live,
}: {
  shot: ShotView;
  media: "image" | "video";
  refetch: () => Promise<void>;
  live?: LiveTaskMap;
}) {
  const { busy, err, run } = useAction(refetch);
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
    <div className="shot-cell">
      {url ? (
        media === "image" ? (
          <img className="media" src={url} alt={`鏡 ${shot.shotIndex}`} />
        ) : (
          <video className="media" src={url} controls preload="metadata" />
        )
      ) : (
        <div className="media" style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span className="faint">{inFlight ? <><span className="spinner" /> 生成中{pct ? ` ${pct}%` : "…"}</> : "未生成"}</span>
        </div>
      )}
      <div className="cell-body">
        <span className="faint" style={{ fontSize: 12 }}>
          鏡 {shot.shotIndex}
        </span>
        <button
          className="btn btn-sm"
          disabled={busy || inFlight}
          onClick={() => run(() => api.post(`/api/shots/${shot.id}/${endpoint}`))}
        >
          {busy || inFlight ? (
            <>
              <span className="spinner" /> {inFlight ? `生成中${pct ? ` ${pct}%` : ""}` : ""}
            </>
          ) : url ? (
            "重生"
          ) : (
            "生成"
          )}
        </button>
      </div>
      {err && <p className="error-text" style={{ padding: "0 10px 8px" }}>{err}</p>}
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
    <span className={`model-chip${fake ? " fake" : ""}`}>
      {icon} {shortModelName(model.modelKey)}
      {model.unitUsd !== null && ` · ~$${model.unitUsd.toFixed(2)}/${unit}`}
    </span>
  );
}

export function ImagesPanel({ view, progress, refetch, live }: PanelProps) {
  return (
    <Station
      stage="images"
      progress={progress}
      action={<ModelChip icon="🖼️" unit="張" model={view.cost?.activeModels?.image} />}
    >
      {view.shots.length === 0 ? (
        <div className="empty">先完成分鏡站。</div>
      ) : (
        <ShotMediaGrid shots={view.shots} media="image" refetch={refetch} live={live} />
      )}
    </Station>
  );
}

export function VideosPanel({ view, progress, refetch, live }: PanelProps) {
  return (
    <Station
      stage="videos"
      progress={progress}
      action={<ModelChip icon="🎬" unit="鏡" model={view.cost?.activeModels?.video} />}
    >
      {view.shots.length === 0 ? (
        <div className="empty">先完成分鏡站。</div>
      ) : (
        <ShotMediaGrid shots={view.shots} media="video" refetch={refetch} live={live} />
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
        <div className="empty">仲未有台詞。用右下角「下一步」分析台詞並配音。</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {voiceLines.map((v) => (
            <div key={v.id} className="voice-line">
              <span className="badge" style={{ flexShrink: 0 }}>
                {v.speaker || "旁白"}
              </span>
              {v.lineType === "vo" && (
                <span className="badge" style={{ flexShrink: 0, color: "#c4b5fd" }} title="Voice Over：旁白/內心獨白，場內人聽不到">
                  VO
                </span>
              )}
              {v.lineType === "os" && (
                <span className="badge" style={{ flexShrink: 0, color: "#93c5fd" }} title="Off-Screen：人在場景內但不在畫面">
                  OS
                </span>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div>
                  {v.cue ? <span className="faint">（{v.cue}）</span> : null}
                  {v.content}
                </div>
                {v.emotion && (
                  <div className="faint" style={{ fontSize: 12 }}>
                    情緒：{v.emotion}（{v.emotionStrength.toFixed(2)}）
                  </div>
                )}
              </div>
              {v.audioUrl ? (
                <audio src={v.audioUrl} controls preload="none" />
              ) : (
                <span className="faint" style={{ fontSize: 12, flexShrink: 0 }}>
                  待配音
                </span>
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
        <div className="card" style={{ textAlign: "center" }}>
          <video
            src={url}
            controls
            style={{ maxWidth: 360, width: "100%", borderRadius: "var(--radius-sm)", background: "#000" }}
          />
          <div style={{ marginTop: 14 }}>
            <a className="btn btn-primary" href={url} download>
              下載成片 MP4
            </a>
          </div>
        </div>
      ) : (
        <div className="empty">仲未合成。完成前面各站後，用右下角「下一步」合成整集並導出。</div>
      )}
    </Station>
  );
}

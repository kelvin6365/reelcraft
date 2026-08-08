"use client";
// 配音表 —— 呢一集有幾多把聲、每把用邊個音色。冇呢一步，TTS 會跌返 provider
// 預設聲，成集所有角色同一把（就係我哋之前嗰個 bug），所以未派晒之前配音站
// 唔會開始生成。
import { useRef, useState } from "react";
import { Loader2, Upload, UserRound, Volume2, Wand2 } from "lucide-react";
import { api } from "@/ui/api";
import { useAction } from "@/ui/planning/useAction";
import { qk } from "@/ui/query-keys";
import type { VoiceCastView, VoiceView } from "@/ui/types";
import { listVoicePresets, type VoicePreset } from "@/lib/voice/presets";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const NONE = "__none__";

// 下拉分組：性別 → 年齡段。派音最常問嘅兩條問題就係「男定女」「幾大」，
// 分組跟返呢個次序，用戶唔使喺 27 個名度大海撈針。
const GENDER_LABEL: Record<VoicePreset["gender"], string> = { male: "男聲", female: "女聲", neutral: "中性／特殊" };

function groupPresets(presets: VoicePreset[]) {
  const groups = new Map<string, VoicePreset[]>();
  for (const p of presets) {
    const key = p.gender === "neutral" ? GENDER_LABEL.neutral : `${GENDER_LABEL[p.gender]}・${p.age}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(p);
    else groups.set(key, [p]);
  }
  return [...groups.entries()];
}

export function VoiceCastPanel({
  cast,
  voices,
  episodeId,
  projectId,
  casting,
}: {
  cast: VoiceCastView[];
  voices: VoiceView[];
  episodeId: string;
  projectId: string;
  casting: boolean;
}) {
  const presets = listVoicePresets();
  const grouped = groupPresets(presets);
  const uncast = cast.filter((c) => !c.assigned).length;
  const autoCast = useAction(qk.episode(episodeId));
  // 同一個 session 試聽過嘅音色唔再重新合成 —— 撳一次收一次錢好核突
  const [previews, setPreviews] = useState<Record<string, string>>({});

  if (cast.length === 0) return null;

  return (
    <Card className="mb-4">
      <CardHeader className="pb-2">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <UserRound className="size-4" /> 角色音色
          {uncast > 0 ? (
            <Badge variant="destructive">仲有 {uncast} 把聲未派</Badge>
          ) : (
            <Badge variant="secondary" className="text-emerald-400">全部派晒</Badge>
          )}
          <Button
            size="sm"
            variant="outline"
            className="ml-auto"
            disabled={autoCast.busy || casting}
            aria-busy={autoCast.busy || casting}
            title="由 AI 睇角色小傳同戲份，喺音色庫幫每把聲揀一個音色（唔會生成音頻，可以逐個改）"
            onClick={() => autoCast.run(() => api.post(`/api/episodes/${episodeId}/voice-cast`))}
          >
            {autoCast.busy || casting ? <Loader2 className="animate-spin" /> : <Wand2 />} AI 派音
          </Button>
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          一個角色一把聲，由頭到尾唔會變。未派音嘅角色唔會開始配音 —— 唔派就一定係成集同一把預設聲。
        </p>
        {autoCast.err && <p className="text-sm text-destructive">{autoCast.err}</p>}
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {cast.map((row) => (
          <CastRow
            key={row.speaker}
            row={row}
            voices={voices}
            grouped={grouped}
            episodeId={episodeId}
            projectId={projectId}
            previews={previews}
            setPreviews={setPreviews}
          />
        ))}
        <UploadVoice projectId={projectId} episodeId={episodeId} />
      </CardContent>
    </Card>
  );
}

function CastRow({
  row,
  voices,
  grouped,
  episodeId,
  projectId,
  previews,
  setPreviews,
}: {
  row: VoiceCastView;
  voices: VoiceView[];
  grouped: [string, VoicePreset[]][];
  episodeId: string;
  projectId: string;
  previews: Record<string, string>;
  setPreviews: (fn: (prev: Record<string, string>) => Record<string, string>) => void;
}) {
  const save = useAction(qk.episode(episodeId));
  const preview = useAction(qk.episode(episodeId));
  const value = row.presetId ? `preset:${row.presetId}` : row.refId ? `ref:${row.refId}` : NONE;
  const refAudioUrl = row.refId ? (voices.find((v) => v.id === row.refId)?.audioUrl ?? null) : null;
  // 參考音本身就係音源，直接播；內置音色要合成一句短句先聽到
  const audioUrl = refAudioUrl ?? (row.presetId ? (previews[row.presetId] ?? null) : null);

  async function listen() {
    if (!row.presetId || previews[row.presetId]) return;
    const presetId = row.presetId;
    // useAction.run 只回成功與否，音檔 URL 喺 closure 度接住
    let url: string | null = null;
    await preview.run(
      async () => {
        const data = await api.post<{ audioUrl: string | null }>("/api/voices/preview", { projectId, presetId });
        url = data.audioUrl;
      },
      { refetch: false },
    );
    if (url) setPreviews((p) => ({ ...p, [presetId]: url as string }));
  }

  async function change(next: string) {
    const body =
      next === NONE
        ? {}
        : next.startsWith("preset:")
          ? { presetId: next.slice("preset:".length) }
          : { refId: next.slice("ref:".length) };
    // 角色綁定係 project 級（跨集一致）；旁白／機械音之類冇角色，綁喺呢一集。
    await save.run(() =>
      row.characterId
        ? api.put(`/api/characters/${row.characterId}/voice`, body)
        : api.put(`/api/episodes/${episodeId}/speaker-voices`, { speaker: row.speaker, ...body }),
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border p-2">
      <span className="min-w-20 text-sm font-medium">{row.speaker}</span>
      <Badge variant="secondary" className="text-xs">{row.lineCount} 句</Badge>
      {!row.characterId && (
        <Badge variant="outline" className="text-xs" title="呢個聲源冇對應角色，音色只綁呢一集">
          本集
        </Badge>
      )}
      <Select value={value} onValueChange={change} disabled={save.busy}>
        <SelectTrigger size="sm" className="w-56">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>— 未派音 —</SelectItem>
          {voices.length > 0 && (
            <SelectGroup>
              <SelectLabel>自訂參考音</SelectLabel>
              {voices.map((v) => (
                <SelectItem key={v.id} value={`ref:${v.id}`}>
                  {v.name}
                </SelectItem>
              ))}
            </SelectGroup>
          )}
          {grouped.map(([label, items]) => (
            <SelectGroup key={label}>
              <SelectLabel>{label}</SelectLabel>
              {items.map((p) => (
                <SelectItem key={p.id} value={`preset:${p.id}`}>
                  {p.name}（{p.traits.join("・")}）
                </SelectItem>
              ))}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>
      {save.busy && <Loader2 className="size-3 animate-spin text-primary" />}
      {audioUrl ? (
        <audio src={audioUrl} controls preload="none" className="h-8" />
      ) : row.presetId ? (
        <Button size="sm" variant="ghost" disabled={preview.busy} onClick={listen} title="合成一句短句試聽（幾毫仙）">
          {preview.busy ? <Loader2 className="animate-spin" /> : <Volume2 />} 試聽
        </Button>
      ) : null}
      {row.note && <span className="text-xs text-muted-foreground">{row.note}</span>}
      {(save.err || preview.err) && <span className="text-xs text-destructive">{save.err ?? preview.err}</span>}
    </div>
  );
}

// 上傳一段人聲做聲音克隆嘅參考。要留意：內置音色同參考音係兩種模式，
// 唔同 TTS 模型只食其中一種（見 standards/capabilities.json 嘅 voiceModes）。
function UploadVoice({ projectId, episodeId }: { projectId: string; episodeId: string }) {
  const upload = useAction(qk.episode(episodeId));
  const [name, setName] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  async function submit() {
    const file = fileRef.current?.files?.[0];
    if (!file || !name.trim()) return;
    const form = new FormData();
    form.set("projectId", projectId);
    form.set("name", name.trim());
    form.set("file", file);
    const okDone = await upload.run(() => api.upload("/api/voices", form));
    if (okDone) {
      setName("");
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed p-2">
      <Volume2 className="size-4 text-muted-foreground" />
      <span className="text-xs text-muted-foreground">加自訂音色（上傳一段乾淨人聲做克隆參考）</span>
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="音色名"
        className="h-8 w-32 text-sm"
      />
      <Input ref={fileRef} type="file" accept="audio/*" className="h-8 w-52 text-xs" />
      <Button size="sm" variant="ghost" disabled={upload.busy} onClick={submit}>
        <Upload /> 上傳
      </Button>
      {upload.err && <span className="text-xs text-destructive">{upload.err}</span>}
    </div>
  );
}

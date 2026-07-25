"use client";
// Guided project-creation wizard — 貼故事 → 揀畫風 → 揀出法 → 建立。 Draft state
// is mirrored to sessionStorage so a reload / back-nav doesn't lose a pasted
// novel. Kept as a single WizardDraft object (see src/ui/wizard/draft.ts) so
// persistence + validation stay in one testable place.
import { Fragment, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2 } from "lucide-react";
import { api, ApiClientError } from "@/ui/api";
import { useSession } from "@/ui/auth-client";
import { qk } from "@/ui/query-keys";
import { SAMPLE_NOVEL } from "@/lib/fixtures/sample-novel";
import { cn } from "@/lib/utils";
import { DRAFT_KEY, defaultDraft, defaultName, parseDraft, type WizardDraft } from "@/ui/wizard/draft";
import { StylePackCards } from "@/ui/wizard/StylePackCards";
import { AppShell } from "@/components/app-shell";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "@/components/confirm-dialog";

const LONG_NOVEL_CHARS = 30000;

const STEPS = [
  { key: 1 as const, label: "貼故事" },
  { key: 2 as const, label: "揀畫風" },
  { key: 3 as const, label: "揀出法" },
];

const RATIOS = [
  { id: "9:16" as const, label: "9:16 直片", subtitle: "抖音 / Reels / Shorts" },
  { id: "16:9" as const, label: "16:9 橫片", subtitle: "YouTube / 電視" },
];

const MODES = [
  { id: "single" as const, label: "單集直出", desc: "呢段文直接出一集，最快見到成品" },
  { id: "plan" as const, label: "整部規劃", desc: "AI 幫你切集，之後可以批量出全季" },
];

export default function NewProjectPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: session, isPending } = useSession();

  useEffect(() => {
    if (isPending) return;
    if (!session) router.replace("/signin");
  }, [isPending, session, router]);

  const [draft, setDraft] = useState<WizardDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [createdProjectId, setCreatedProjectId] = useState<string | null>(null);
  const [dupeConfirmOpen, setDupeConfirmOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // load once on mount, after hydration, to avoid an SSR/client mismatch
  useEffect(() => {
    setDraft(parseDraft(sessionStorage.getItem(DRAFT_KEY)) ?? defaultDraft());
  }, []);

  useEffect(() => {
    if (draft) sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  }, [draft]);

  function update(patch: Partial<WizardDraft>) {
    setDraft((d) => (d ? { ...d, ...patch } : d));
  }

  async function submitSingle(d: WizardDraft, force = false) {
    const text = d.text.trim();
    const name = d.name.trim() || defaultName(d.text);
    const project = await api.post<{ id: string }>("/api/projects", {
      name,
      stylePackId: d.stylePackId,
      videoRatio: d.videoRatio,
      inputType: d.inputType,
    });
    setCreatedProjectId(project.id);
    try {
      const episode = await api.post<{ id: string }>(`/api/projects/${project.id}/episodes`, {
        rawText: text,
        ...(force ? { force: true } : {}),
      });
      sessionStorage.removeItem(DRAFT_KEY);
      router.push(`/projects/${project.id}/episodes/${episode.id}`);
    } catch (err) {
      if (err instanceof ApiClientError && err.code === "DUPLICATE_EPISODE" && !force) {
        setDupeConfirmOpen(true);
        return;
      }
      throw err;
    }
  }

  async function submitPlan(d: WizardDraft) {
    const text = d.text.trim();
    const name = d.name.trim() || defaultName(d.text);
    const project = await api.post<{ id: string }>("/api/projects", {
      name,
      stylePackId: d.stylePackId,
      videoRatio: d.videoRatio,
      inputType: "novel",
    });
    setCreatedProjectId(project.id);
    await api.patch(`/api/projects/${project.id}`, { sourceText: text });
    const { anchor, seconds, count, hookStrength } = d.planConfig;
    await api.post(
      `/api/projects/${project.id}/plan`,
      anchor === "length" ? { anchor: "length", seconds, hookStrength } : { anchor: "count", count, hookStrength },
    );
    sessionStorage.removeItem(DRAFT_KEY);
    router.push(`/projects/${project.id}`);
  }

  const mutation = useMutation({
    mutationFn: async (force: boolean) => {
      if (!draft) return;
      if (draft.mode === "single") await submitSingle(draft, force);
      else await submitPlan(draft);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.projects });
    },
    onError: (err) => {
      setError(err instanceof ApiClientError ? err.message : "建立失敗，請再試一次。");
    },
  });

  if (isPending || !session || !draft) {
    return <div className="flex min-h-svh items-center justify-center text-muted-foreground">載入中…</div>;
  }

  const step = draft.step;
  const canGoStep2 = !!draft.text.trim();
  const canGoStep3 = canGoStep2;

  function goStep(target: 1 | 2 | 3) {
    if (target > step) {
      if (target >= 2 && !canGoStep2) return;
      if (target >= 3 && !canGoStep3) return;
    }
    setError(null);
    update({ step: target });
  }

  function handleSample() {
    update({ text: SAMPLE_NOVEL, inputType: "novel" });
  }

  async function handleSrtUpload(file: File) {
    const text = await file.text();
    update({ text, inputType: "srt", mode: "single" });
  }

  function clearSrt() {
    update({ inputType: "novel", text: "" });
  }

  const isLong = draft.text.length > LONG_NOVEL_CHARS;

  return (
    <AppShell active="projects" title="新專案">
      <div className="mx-auto max-w-2xl space-y-6 p-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">新專案</h1>
          <p className="mt-1 text-sm text-muted-foreground">三步搞掂：貼故事、揀畫風、揀出法。</p>
        </div>

        <StepIndicator current={step} onSelect={goStep} />

        {step === 1 && (
          <div className="space-y-3">
            <Textarea
              value={draft.text}
              onChange={(e) => update({ text: e.target.value })}
              rows={14}
              placeholder="喺呢度貼上小說原文，或者上載 SRT 字幕…"
            />
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{draft.text.length.toLocaleString()} 字</span>
              {draft.inputType === "srt" && (
                <Badge variant="secondary" className="gap-1">
                  已識別為 SRT 字幕
                  <button
                    type="button"
                    onClick={clearSrt}
                    aria-label="清除並改用小說原文"
                    className="ml-1 rounded-sm outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    ×
                  </button>
                </Badge>
              )}
            </div>
            {isLong && (
              <Alert>
                <AlertDescription>
                  原文較長（超過 {LONG_NOVEL_CHARS.toLocaleString()} 字）。v1 單次規劃上限約 25 集，長篇建議分批貼章節規劃。
                </AlertDescription>
              </Alert>
            )}
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" onClick={handleSample}>
                📄 用範例小說試下
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                上載 SRT 字幕
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".srt"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleSrtUpload(file);
                  e.target.value = "";
                }}
              />
            </div>
            <div className="flex justify-end">
              <Button onClick={() => goStep(2)} disabled={!draft.text.trim()}>
                下一步
              </Button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-6">
            <div className="space-y-2">
              <Label>畫風包</Label>
              <StylePackCards value={draft.stylePackId} onChange={(id) => update({ stylePackId: id })} />
            </div>
            <div className="space-y-2">
              <Label>影片比例</Label>
              <div className="grid grid-cols-2 gap-4">
                {RATIOS.map((r) => {
                  const selected = draft.videoRatio === r.id;
                  return (
                    <button
                      key={r.id}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => update({ videoRatio: r.id })}
                      className={cn(
                        "rounded-lg border-2 p-4 text-left transition-colors",
                        selected ? "border-primary ring-2 ring-primary" : "border-transparent bg-muted hover:border-border",
                      )}
                    >
                      <p className="text-sm font-medium">{r.label}</p>
                      <p className="text-xs text-muted-foreground">{r.subtitle}</p>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="flex justify-between">
              <Button variant="ghost" onClick={() => goStep(1)}>
                上一步
              </Button>
              <Button onClick={() => goStep(3)}>下一步</Button>
            </div>
          </div>
        )}

        {step === 3 && (
          <Step3
            draft={draft}
            update={update}
            onBack={() => goStep(2)}
            error={error}
            createdProjectId={createdProjectId}
            busy={mutation.isPending}
            onSubmit={() => {
              setError(null);
              mutation.mutate(false);
            }}
          />
        )}
      </div>

      <ConfirmDialog
        open={dupeConfirmOpen}
        onOpenChange={setDupeConfirmOpen}
        title="同一段原文啱啱先建立過一集"
        description="30 分鐘內用同一段原文建立過劇集。確定要再建一集？"
        confirmLabel="照樣建立"
        onConfirm={async () => {
          setError(null);
          await mutation.mutateAsync(true);
        }}
      />
    </AppShell>
  );
}

function StepIndicator({ current, onSelect }: { current: 1 | 2 | 3; onSelect: (step: 1 | 2 | 3) => void }) {
  return (
    <nav aria-label="建立步驟">
      <ol className="flex items-start">
        {STEPS.map((s, i) => {
          const done = s.key < current;
          const isCurrent = s.key === current;
          return (
            <Fragment key={s.key}>
              <li className="contents">
                <button
                  type="button"
                  onClick={() => onSelect(s.key)}
                  disabled={s.key > current}
                  aria-current={isCurrent ? "step" : undefined}
                  className="flex shrink-0 flex-col items-center gap-1.5 disabled:cursor-not-allowed"
                >
                  <span
                    className={cn(
                      "flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-medium transition-colors",
                      done && "bg-primary text-primary-foreground",
                      isCurrent && "bg-primary/15 text-primary ring-2 ring-primary",
                      !done && !isCurrent && "bg-muted text-muted-foreground",
                    )}
                  >
                    {done ? <Check className="size-4" /> : s.key}
                  </span>
                  <span className={cn("text-xs font-medium", isCurrent ? "text-foreground" : "text-muted-foreground")}>
                    {s.label}
                  </span>
                </button>
              </li>
              {i < STEPS.length - 1 && (
                <div className={cn("mt-4.5 h-px flex-1", done ? "bg-primary" : "bg-border")} />
              )}
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}

function Step3({
  draft,
  update,
  onBack,
  error,
  createdProjectId,
  busy,
  onSubmit,
}: {
  draft: WizardDraft;
  update: (patch: Partial<WizardDraft>) => void;
  onBack: () => void;
  error: string | null;
  createdProjectId: string | null;
  busy: boolean;
  onSubmit: () => void;
}) {
  const isSrt = draft.inputType === "srt";

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Label>出法</Label>
        {isSrt && <p className="text-xs text-muted-foreground">SRT 字幕行單集流程</p>}
        <div className={cn("grid gap-4", isSrt ? "grid-cols-1" : "grid-cols-2")}>
          {MODES.filter((m) => !isSrt || m.id === "single").map((m) => {
            const selected = draft.mode === m.id;
            return (
              <button
                key={m.id}
                type="button"
                aria-pressed={selected}
                onClick={() => update({ mode: m.id })}
                className={cn(
                  "rounded-lg border-2 p-4 text-left transition-colors",
                  selected ? "border-primary ring-2 ring-primary" : "border-transparent bg-muted hover:border-border",
                )}
              >
                <p className="text-sm font-medium">{m.label}</p>
                <p className="text-xs text-muted-foreground">{m.desc}</p>
              </button>
            );
          })}
        </div>
      </div>

      {draft.mode === "plan" && (
        <div className="space-y-4 rounded-lg border p-4">
          <RadioGroup
            value={draft.planConfig.anchor}
            onValueChange={(v) => update({ planConfig: { ...draft.planConfig, anchor: v as "length" | "count" } })}
          >
            <div className="flex items-center gap-3">
              <RadioGroupItem value="length" id="anchor-length" />
              <Label htmlFor="anchor-length" className="font-normal">每集約</Label>
              <Input
                type="number"
                className="h-8 w-20"
                value={draft.planConfig.seconds}
                min={15}
                onChange={(e) =>
                  update({ planConfig: { ...draft.planConfig, seconds: Math.max(1, Number(e.target.value) || 0) } })
                }
                disabled={draft.planConfig.anchor !== "length"}
              />
              <span className="text-sm text-muted-foreground">秒</span>
            </div>
            <div className="flex items-center gap-3">
              <RadioGroupItem value="count" id="anchor-count" />
              <Label htmlFor="anchor-count" className="font-normal">總共</Label>
              <Input
                type="number"
                className="h-8 w-20"
                value={draft.planConfig.count}
                min={1}
                onChange={(e) =>
                  update({ planConfig: { ...draft.planConfig, count: Math.max(1, Number(e.target.value) || 0) } })
                }
                disabled={draft.planConfig.anchor !== "count"}
              />
              <span className="text-sm text-muted-foreground">集</span>
            </div>
          </RadioGroup>

          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">鉤子強度</span>
              <Button
                type="button"
                size="sm"
                variant={draft.planConfig.hookStrength === "normal" ? "default" : "outline"}
                onClick={() => update({ planConfig: { ...draft.planConfig, hookStrength: "normal" } })}
                title="一般＝貼近原文節奏，鉤子按劇情自然強度"
              >
                一般
              </Button>
              <Button
                type="button"
                size="sm"
                variant={draft.planConfig.hookStrength === "strong" ? "default" : "outline"}
                onClick={() => update({ planConfig: { ...draft.planConfig, hookStrength: "strong" } })}
                title="強鉤子＝更多懸念同反轉，適合投流"
              >
                強鉤子
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {draft.planConfig.hookStrength === "strong"
                ? "強鉤子＝每集結尾加強懸念同反轉，適合投流搶留存。"
                : "一般＝貼近原文節奏，唔強行加戲。"}
            </p>
          </div>
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="project-name">專案名稱</Label>
        <Input
          id="project-name"
          value={draft.name}
          onChange={(e) => update({ name: e.target.value })}
          placeholder={defaultName(draft.text)}
        />
      </div>

      {error && (
        <div className="space-y-1">
          <p className="text-sm text-destructive">{error}</p>
          {createdProjectId && (
            <p className="text-sm">
              專案已建立，
              <a href={`/projects/${createdProjectId}`} className="underline underline-offset-2">
                去專案頁
              </a>
              繼續。
            </p>
          )}
        </div>
      )}

      <div className="space-y-3">
        <Button onClick={onSubmit} disabled={busy} className="w-full">
          {busy && <Loader2 className="animate-spin" />}
          {busy ? "建立中…" : "開始製作"}
        </Button>
        <div className="flex justify-start">
          <Button variant="ghost" onClick={onBack} disabled={busy}>
            上一步
          </Button>
        </div>
      </div>
    </div>
  );
}

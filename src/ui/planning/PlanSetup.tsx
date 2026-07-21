"use client";
// Pre-plan setup panel: paste the full novel (saved on blur), pick ONE target
// anchor (每集約 N 秒 / 總共 N 集) + hook strength, then trigger EPISODE_SPLIT.
// While planStatus==='planning' the parent polls; we just show a spinner here.
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { api } from "@/ui/api";
import { qk } from "@/ui/query-keys";
import { useAction } from "./useAction";
import type { PlanConfigView, PlanStatus } from "@/ui/types";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";

const LONG_NOVEL_CHARS = 30000;

export function PlanSetup({
  id,
  initialSourceText,
  initialTheme = "",
  initialConfig,
  planStatus,
}: {
  id: string;
  initialSourceText: string;
  initialTheme?: string;
  initialConfig: PlanConfigView | null;
  planStatus: PlanStatus;
}) {
  const [sourceText, setSourceText] = useState(initialSourceText);
  const [savedText, setSavedText] = useState(initialSourceText);
  const [theme, setTheme] = useState(initialTheme);
  const [savedTheme, setSavedTheme] = useState(initialTheme);
  const [anchor, setAnchor] = useState<"length" | "count">(initialConfig?.anchor ?? "length");
  const [seconds, setSeconds] = useState(initialConfig?.seconds ?? 90);
  const [count, setCount] = useState(initialConfig?.count ?? 12);
  const [hookStrength, setHookStrength] = useState<"normal" | "strong">(
    initialConfig?.hookStrength ?? "strong",
  );
  const { busy, err, run } = useAction(qk.project(id));

  const planning = planStatus === "planning";
  const isLong = sourceText.length > LONG_NOVEL_CHARS;

  async function saveSourceOnBlur() {
    const text = sourceText.trim();
    if (text === savedText) return;
    await run(async () => {
      await api.patch(`/api/projects/${id}`, { sourceText: text });
      setSavedText(text);
    }, { refetch: false });
  }

  async function saveThemeOnBlur() {
    const t = theme.trim();
    if (t === savedTheme) return;
    await run(async () => {
      await api.patch(`/api/projects/${id}`, { theme: t });
      setSavedTheme(t);
    }, { refetch: false });
  }

  async function startPlan() {
    if (!sourceText.trim()) return;
    // ensure the latest novel + theme are persisted before planning
    if (sourceText.trim() !== savedText) {
      await api.patch(`/api/projects/${id}`, { sourceText: sourceText.trim() });
      setSavedText(sourceText.trim());
    }
    if (theme.trim() !== savedTheme) {
      await api.patch(`/api/projects/${id}`, { theme: theme.trim() });
      setSavedTheme(theme.trim());
    }
    const body =
      anchor === "length"
        ? { anchor, seconds, hookStrength }
        : { anchor, count, hookStrength };
    await run(() => api.post(`/api/projects/${id}/plan`, body));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>劇集規劃</CardTitle>
        <CardDescription>
          貼上成本小說原文，設一個目標，AI 幫你切集並自評風險，你只需審核亮燈嗰幾集。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Textarea
            value={sourceText}
            onChange={(e) => setSourceText(e.target.value)}
            onBlur={saveSourceOnBlur}
            rows={10}
            placeholder="喺呢度貼上成本小說原文…"
            disabled={planning}
          />
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{sourceText.length.toLocaleString()} 字</span>
            {savedText && sourceText.trim() === savedText && <span>已儲存 ✓</span>}
          </div>
          {isLong && (
            <Alert>
              <AlertDescription>
                原文較長（超過 {LONG_NOVEL_CHARS.toLocaleString()} 字）。v1
                單次規劃上限約 25 集，長篇建議分批貼章節規劃。
              </AlertDescription>
            </Alert>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="plan-theme">中心思想（可留空）</Label>
          <Input
            id="plan-theme"
            value={theme}
            onChange={(e) => setTheme(e.target.value)}
            onBlur={saveThemeOnBlur}
            placeholder="中心思想一句話 — 例：愛要及時說出口。切集同劇本都會錨定唔偏題"
            disabled={planning}
          />
        </div>

        <div className="space-y-4 rounded-lg border p-4">
          <RadioGroup
            value={anchor}
            onValueChange={(v) => setAnchor(v as "length" | "count")}
            disabled={planning}
          >
            <div className="flex items-center gap-3">
              <RadioGroupItem value="length" id="anchor-length" />
              <Label htmlFor="anchor-length" className="font-normal">每集約</Label>
              <Input
                type="number"
                className="h-8 w-20"
                value={seconds}
                min={15}
                onChange={(e) => setSeconds(Math.max(1, Number(e.target.value) || 0))}
                disabled={planning || anchor !== "length"}
              />
              <span className="text-sm text-muted-foreground">秒</span>
            </div>
            <div className="flex items-center gap-3">
              <RadioGroupItem value="count" id="anchor-count" />
              <Label htmlFor="anchor-count" className="font-normal">總共</Label>
              <Input
                type="number"
                className="h-8 w-20"
                value={count}
                min={1}
                onChange={(e) => setCount(Math.max(1, Number(e.target.value) || 0))}
                disabled={planning || anchor !== "count"}
              />
              <span className="text-sm text-muted-foreground">集</span>
            </div>
          </RadioGroup>

          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">鉤子強度</span>
            <Button
              type="button"
              size="sm"
              variant={hookStrength === "normal" ? "default" : "outline"}
              onClick={() => setHookStrength("normal")}
              disabled={planning}
            >
              一般
            </Button>
            <Button
              type="button"
              size="sm"
              variant={hookStrength === "strong" ? "default" : "outline"}
              onClick={() => setHookStrength("strong")}
              disabled={planning}
            >
              強鉤子
            </Button>
          </div>
        </div>

        {err && <p className="text-sm text-destructive">{err}</p>}
      </CardContent>
      <CardFooter className="justify-end border-t">
        <Button onClick={startPlan} disabled={busy || planning || !sourceText.trim()}>
          {(planning || busy) && <Loader2 className="animate-spin" />}
          {planning ? "規劃中…" : "AI 規劃分集"}
        </Button>
      </CardFooter>
    </Card>
  );
}

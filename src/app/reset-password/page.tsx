"use client";
import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Clapperboard, Loader2 } from "lucide-react";
import { authClient } from "@/ui/auth-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function ResetPasswordPage() {
  // useSearchParams (in the inner component) requires a Suspense boundary at build time
  return (
    <Suspense
      fallback={
        <div className="flex min-h-svh items-center justify-center text-muted-foreground">載入中…</div>
      }
    >
      <ResetPasswordForm />
    </Suspense>
  );
}

function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? searchParams.get("error");
  const hasError = !searchParams.get("token") && !!searchParams.get("error");

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);

    if (!searchParams.get("token")) {
      setErr("連結無效或已過期，請重新申請重設密碼。");
      return;
    }
    if (password.length < 8) {
      setErr("密碼至少要 8 個字元。");
      return;
    }
    if (password !== confirmPassword) {
      setErr("兩次輸入嘅密碼唔一致。");
      return;
    }

    setBusy(true);
    const { error } = await authClient.resetPassword({
      newPassword: password,
      token: searchParams.get("token") ?? undefined,
    });
    setBusy(false);
    if (error) {
      setErr(error.message ?? "重設密碼失敗，請重新申請重設連結。");
      return;
    }
    setDone(true);
  }

  return (
    <div className="flex min-h-svh items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Clapperboard className="size-5" />
          </div>
          <CardTitle className="text-xl">重設密碼</CardTitle>
          <CardDescription>
            {done ? "密碼已更新" : "輸入你嘅新密碼。"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {done ? (
            <div className="space-y-4">
              <p className="text-center text-sm text-muted-foreground">
                你嘅密碼已經重設成功，可以用新密碼登入。
              </p>
              <Button asChild className="w-full">
                <Link href="/signin">前往登入</Link>
              </Button>
            </div>
          ) : hasError && !token ? (
            <div className="space-y-4">
              <p className="text-center text-sm text-destructive">連結無效或已過期。</p>
              <Button asChild className="w-full">
                <Link href="/forgot-password">重新申請重設連結</Link>
              </Button>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="password">新密碼</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                  autoComplete="new-password"
                  aria-invalid={err ? true : undefined}
                  aria-describedby="reset-password-hint reset-password-error"
                />
                <p id="reset-password-hint" className="text-sm text-muted-foreground">
                  至少 8 個字元。
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm-password">確認新密碼</Label>
                <Input
                  id="confirm-password"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  minLength={8}
                  autoComplete="new-password"
                  aria-invalid={err ? true : undefined}
                  aria-describedby={err ? "reset-password-error" : undefined}
                />
              </div>
              {err && (
                <p id="reset-password-error" className="text-sm text-destructive">
                  {err}
                </p>
              )}
              <Button type="submit" className="w-full" disabled={busy} aria-busy={busy}>
                {busy && <Loader2 className="animate-spin" />}
                {busy ? "更新中…" : "重設密碼"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

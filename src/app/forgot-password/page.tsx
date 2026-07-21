"use client";
import { useState } from "react";
import Link from "next/link";
import { Clapperboard, Loader2 } from "lucide-react";
import { authClient } from "@/ui/auth-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    const { error } = await authClient.requestPasswordReset({
      email,
      redirectTo: "/reset-password",
    });
    setBusy(false);
    // Always show the success state regardless of whether the email exists,
    // to avoid account enumeration.
    if (error) {
      setErr(error.message ?? "發送失敗，請稍後再試。");
      return;
    }
    setSent(true);
  }

  return (
    <div className="flex min-h-svh items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Clapperboard className="size-5" />
          </div>
          <CardTitle className="text-xl">忘記密碼</CardTitle>
          <CardDescription>
            {sent ? "請檢查你嘅電郵" : "輸入你嘅登入電郵，我哋會寄出重設密碼連結。"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {sent ? (
            <div className="space-y-4">
              <p className="text-center text-sm text-muted-foreground">
                如果呢個電郵有帳戶，我哋已寄出重設連結。
              </p>
              <Button asChild className="w-full">
                <Link href="/signin">返回登入</Link>
              </Button>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">電郵</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  aria-invalid={err ? true : undefined}
                  aria-describedby={err ? "forgot-password-error" : undefined}
                />
              </div>
              {err && (
                <p id="forgot-password-error" className="text-sm text-destructive">
                  {err}
                </p>
              )}
              <Button type="submit" className="w-full" disabled={busy} aria-busy={busy}>
                {busy && <Loader2 className="animate-spin" />}
                {busy ? "發送中…" : "寄出重設連結"}
              </Button>
              <p className="text-center text-sm text-muted-foreground">
                記得密碼？{" "}
                <Link href="/signin" className="text-primary hover:underline">
                  返回登入
                </Link>
              </p>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

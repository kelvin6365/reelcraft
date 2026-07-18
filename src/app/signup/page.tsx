"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { signUp } from "@/ui/auth-client";

export default function SignUpPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (password.length < 8) {
      setErr("密碼至少 8 個字元。");
      return;
    }
    setBusy(true);
    const { error } = await signUp.email({ email, password, name: name.trim() || email });
    setBusy(false);
    if (error) {
      setErr(error.message ?? "註冊失敗，請稍後再試。");
      return;
    }
    router.replace("/projects");
  }

  return (
    <div className="auth-wrap">
      <form className="card auth-card" onSubmit={onSubmit}>
        <h1>
          建立 <span style={{ color: "var(--accent)" }}>ReelCraft</span> 帳戶
        </h1>
        <div className="field">
          <label>名稱</label>
          <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
        </div>
        <div className="field">
          <label>電郵</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
        </div>
        <div className="field">
          <label>密碼（至少 8 字元）</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="new-password"
          />
        </div>
        {err && (
          <p className="error-text" style={{ marginTop: 12 }}>
            {err}
          </p>
        )}
        <button className="btn btn-primary" type="submit" disabled={busy} style={{ width: "100%", marginTop: 18 }}>
          {busy ? <span className="spinner" /> : "建立帳戶"}
        </button>
        <p className="muted" style={{ fontSize: 14, marginTop: 16, textAlign: "center" }}>
          已有帳戶？<Link href="/signin">登入</Link>
        </p>
      </form>
    </div>
  );
}

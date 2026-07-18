"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { signIn } from "@/ui/auth-client";

export default function SignInPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    const { error } = await signIn.email({ email, password });
    setBusy(false);
    if (error) {
      setErr(error.message ?? "登入失敗，請檢查電郵同密碼。");
      return;
    }
    router.replace("/projects");
  }

  return (
    <div className="auth-wrap">
      <form className="card auth-card" onSubmit={onSubmit}>
        <h1>
          登入 <span style={{ color: "var(--accent)" }}>ReelCraft</span>
        </h1>
        <p className="muted" style={{ fontSize: 14, marginTop: 0 }}>
          貼一段小說，出一集短劇。
        </p>
        <div className="field">
          <label>電郵</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
        </div>
        <div className="field">
          <label>密碼</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
          />
        </div>
        {err && (
          <p className="error-text" style={{ marginTop: 12 }}>
            {err}
          </p>
        )}
        <button className="btn btn-primary" type="submit" disabled={busy} style={{ width: "100%", marginTop: 18 }}>
          {busy ? <span className="spinner" /> : "登入"}
        </button>
        <p className="muted" style={{ fontSize: 14, marginTop: 16, textAlign: "center" }}>
          未有帳戶？<Link href="/signup">建立帳戶</Link>
        </p>
      </form>
    </div>
  );
}

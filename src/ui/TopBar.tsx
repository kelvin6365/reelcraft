"use client";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { ReactNode } from "react";
import { signOut } from "@/ui/auth-client";
import { BalanceChip } from "@/ui/BalanceChip";

export function TopBar({ children }: { children?: ReactNode }) {
  const router = useRouter();
  return (
    <div className="topbar">
      <div className="container topbar-inner">
        <div className="row" style={{ gap: 16, minWidth: 0 }}>
          <Link href="/projects" className="brand" style={{ textDecoration: "none" }}>
            Reel<span>Craft</span>
          </Link>
          <Link href="/usage" className="topbar-link">
            用量
          </Link>
          <Link href="/settings" className="topbar-link">
            設定
          </Link>
          {children}
        </div>
        <div className="row" style={{ gap: 12 }}>
          <BalanceChip />
          <button
          className="btn btn-ghost btn-sm"
          onClick={async () => {
            await signOut();
            router.replace("/signin");
          }}
        >
          登出
          </button>
        </div>
      </div>
    </div>
  );
}

"use client";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { ReactNode } from "react";
import { signOut } from "@/ui/auth-client";

export function TopBar({ children }: { children?: ReactNode }) {
  const router = useRouter();
  return (
    <div className="topbar">
      <div className="container topbar-inner">
        <div className="row" style={{ gap: 16, minWidth: 0 }}>
          <Link href="/projects" className="brand" style={{ textDecoration: "none" }}>
            Reel<span>Craft</span>
          </Link>
          {children}
        </div>
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
  );
}

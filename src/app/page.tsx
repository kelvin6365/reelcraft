"use client";
// Root: bounce to /projects when signed in, else /signin.
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/ui/auth-client";

export default function Home() {
  const router = useRouter();
  const { data: session, isPending } = useSession();

  useEffect(() => {
    if (isPending) return;
    router.replace(session ? "/projects" : "/signin");
  }, [isPending, session, router]);

  return <div className="center-screen">載入中…</div>;
}

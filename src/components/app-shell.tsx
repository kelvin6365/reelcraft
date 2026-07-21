"use client";
// App chrome per the Pencil ref (pencil-shadcn.pen): left sidebar navigation —
// ReelCraft / AI 短劇工坊 header, 製作平台 nav group, user footer — wrapping the
// page content in a SidebarInset. Replaces the old TopBar.
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Clapperboard, Gauge, LayoutDashboard, LogOut, Settings } from "lucide-react";
import type { ReactNode } from "react";
import { signOut, useSession } from "@/ui/auth-client";
import { BalanceChip } from "@/ui/BalanceChip";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";

const NAV_ITEMS = [
  { key: "projects", label: "專案總覽", href: "/projects", icon: LayoutDashboard },
  { key: "usage", label: "用量", href: "/usage", icon: Gauge },
  { key: "settings", label: "設定", href: "/settings", icon: Settings },
] as const;

export type NavKey = (typeof NAV_ITEMS)[number]["key"];

export function AppShell({
  active,
  title,
  actions,
  children,
}: {
  /** which nav item to highlight; inferred from pathname when omitted */
  active?: NavKey;
  /** optional page title rendered in the inset header bar */
  title?: ReactNode;
  /** optional right-aligned header actions */
  actions?: ReactNode;
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { data: session } = useSession();

  const activeKey: NavKey | undefined =
    active ??
    (pathname?.startsWith("/usage")
      ? "usage"
      : pathname?.startsWith("/settings")
        ? "settings"
        : pathname?.startsWith("/projects") || pathname?.startsWith("/episodes")
          ? "projects"
          : undefined);

  const user = session?.user;
  const initial = (user?.name ?? user?.email ?? "?").slice(0, 1).toUpperCase();

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton size="lg" asChild>
                <Link href="/projects">
                  <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                    <Clapperboard className="size-4" />
                  </div>
                  <div className="grid flex-1 text-left leading-tight">
                    <span className="truncate font-semibold">ReelCraft</span>
                    <span className="truncate text-xs text-sidebar-foreground/60">AI 短劇工坊</span>
                  </div>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>製作平台</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {NAV_ITEMS.map((item) => (
                  <SidebarMenuItem key={item.key}>
                    <SidebarMenuButton asChild isActive={item.key === activeKey}>
                      <Link href={item.href}>
                        <item.icon />
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <SidebarMenuButton size="lg">
                    <Avatar className="size-8 rounded-lg">
                      <AvatarFallback className="rounded-lg bg-sidebar-accent">{initial}</AvatarFallback>
                    </Avatar>
                    <div className="grid flex-1 text-left leading-tight">
                      <span className="truncate text-sm font-medium">{user?.name ?? "—"}</span>
                      <span className="truncate text-xs text-sidebar-foreground/60">{user?.email ?? ""}</span>
                    </div>
                  </SidebarMenuButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent side="top" align="start" className="w-56">
                  <DropdownMenuItem
                    onSelect={async () => {
                      await signOut();
                      router.replace("/signin");
                    }}
                  >
                    <LogOut />
                    登出
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset>
        <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-3 border-b bg-background px-6">
          <SidebarTrigger className="-ml-2" />
          {title ? <div className="min-w-0 flex-1 text-sm font-medium">{title}</div> : <div className="flex-1" />}
          <div className="flex items-center gap-3">
            <BalanceChip />
            {actions}
          </div>
        </header>
        {/* No overflow on <main>: scrolling happens at window level; an overflow-auto
            here would become the sticky containing scroller (which never scrolls)
            and silently break position:sticky in page content. */}
        <main className="flex-1">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}

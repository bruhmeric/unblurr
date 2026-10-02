"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  LayoutDashboard, Users, Activity, Settings, LogOut, Zap, ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { OverviewTab } from "@/components/admin/overview-tab";
import { UsersTab } from "@/components/admin/users-tab";
import { ActivityTab } from "@/components/admin/activity-tab";
import { SystemTab } from "@/components/admin/system-tab";

type Tab = "overview" | "users" | "activity" | "system";

const TABS: { id: Tab; label: string; icon: any }[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "users", label: "Users", icon: Users },
  { id: "activity", label: "Activity", icon: Activity },
  { id: "system", label: "System", icon: Settings },
];

export default function AdminDashboardPage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("overview");
  const [admin, setAdmin] = useState<{ email: string; name: string } | null>(null);
  const [mode, setMode] = useState<"mongodb" | "file" | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/auth/me", { cache: "no-store" });
        if (res.status === 401) {
          router.replace("/admin");
          return;
        }
        const data = await res.json();
        if (data.user?.role !== "admin") {
          router.replace("/admin");
          return;
        }
        setAdmin({ email: data.user.email, name: data.user.name });
        // stats fetch gives us the DB mode cheaply
        const statsRes = await fetch("/api/admin/stats", { cache: "no-store" });
        if (statsRes.ok) {
          const sd = await statsRes.json();
          setMode(sd.mode || null);
        }
      } catch {
        router.replace("/admin");
      } finally {
        setChecked(true);
      }
    })();
  }, [router]);

  const logout = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    router.replace("/admin");
  }, [router]);

  return (
    <div className="min-h-screen flex flex-col bg-[#060809] text-zinc-100 selection:bg-emerald-500/30">
      <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-40 left-1/2 -translate-x-1/2 h-96 w-[42rem] rounded-full bg-emerald-500/10 blur-[120px]" />
      </div>

      {/* header */}
      <header className="sticky top-0 z-40 border-b border-white/5 bg-[#060809]/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-3 px-4 sm:px-6">
          <div className="flex items-center gap-2.5 min-w-0">
            <img src="/logo.svg" alt="unblurr.site logo" className="h-9 w-9 rounded-xl" />
            <div className="leading-tight min-w-0">
              <div className="text-[15px] font-bold tracking-tight truncate">
                unblurr<span className="text-emerald-400">.site</span>
              </div>
              <div className="text-[11px] text-zinc-500">Admin console</div>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            <Button
              asChild
              variant="outline"
              size="sm"
              className="h-9 border-white/10 bg-white/5 text-zinc-200 hover:bg-white/10 hover:text-white"
            >
              <Link href="/">
                <ExternalLink className="mr-1.5 h-4 w-4" />
                <span className="hidden sm:inline">View site</span>
              </Link>
            </Button>
            {admin && (
              <div className="hidden md:flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] py-1 pl-1 pr-3">
                <Avatar className="h-7 w-7">
                  <AvatarFallback className="bg-gradient-to-br from-emerald-400/80 to-teal-600/80 text-[11px] font-bold text-[#060809]">
                    {admin.name[0]?.toUpperCase() || "A"}
                  </AvatarFallback>
                </Avatar>
                <span className="max-w-[160px] truncate text-xs font-medium text-zinc-300">{admin.email}</span>
              </div>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={logout}
              aria-label="Sign out"
              className="h-9 w-9 p-0 border-white/10 bg-white/5 text-zinc-400 hover:bg-red-500/10 hover:text-red-400"
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      {/* body */}
      <div className="relative z-10 mx-auto w-full max-w-7xl flex-1 px-4 sm:px-6 py-8">
        {!checked ? (
          <div className="space-y-4">
            <Skeleton className="h-10 w-64" />
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-6 lg:flex-row">
            {/* sidebar */}
            <nav className="lg:w-56 lg:shrink-0" aria-label="Admin sections">
              <div className="flex gap-2 overflow-x-auto lg:flex-col lg:gap-1.5">
                {TABS.map(({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    onClick={() => setTab(id)}
                    aria-current={tab === id ? "page" : undefined}
                    className={`flex shrink-0 items-center gap-2.5 rounded-xl px-4 py-2.5 text-sm font-medium transition-colors ${
                      tab === id
                        ? "bg-emerald-500/10 text-emerald-300 border border-emerald-500/30"
                        : "text-zinc-400 hover:bg-white/5 hover:text-zinc-200 border border-transparent"
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    {label}
                  </button>
                ))}
              </div>
              <div className="mt-6 hidden rounded-xl border border-white/10 bg-white/[0.02] p-4 lg:block">
                <div className="flex items-center gap-2 text-xs font-semibold text-zinc-300">
                  <Zap className="h-3.5 w-3.5 text-emerald-400" />
                  Admin tips
                </div>
                <ul className="mt-2.5 space-y-2 text-[11px] leading-relaxed text-zinc-500">
                  <li>Grant <span className="text-amber-400">premium</span> from the Users tab to give a member unlimited videos.</li>
                  <li>Use <span className="text-zinc-300">reset usage</span> if a member hits their daily limit early.</li>
                  <li>Quotas reset automatically at 00:00 UTC.</li>
                </ul>
              </div>
            </nav>

            {/* content */}
            <main className="min-w-0 flex-1">
              <h1 className="mb-5 text-2xl font-bold tracking-tight capitalize">
                {TABS.find((t) => t.id === tab)?.label}
              </h1>
              {tab === "overview" && <OverviewTab mode={mode} />}
              {tab === "users" && <UsersTab />}
              {tab === "activity" && <ActivityTab />}
              {tab === "system" && <SystemTab mode={mode} />}
            </main>
          </div>
        )}
      </div>

      <footer className="relative z-10 mt-auto border-t border-white/5 bg-[#060809]/90">
        <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6">
          <p className="text-xs text-zinc-600">
            unblurr.site admin console · authorized staff only
          </p>
        </div>
      </footer>
    </div>
  );
}

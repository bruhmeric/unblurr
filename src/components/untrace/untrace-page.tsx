'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Zap, Film, Crown, LogOut, Gauge, LayoutDashboard, Fingerprint, Infinity as InfinityIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Toaster } from '@/components/ui/sonner';

import { Hero } from '@/components/untrace/sections/hero';
import { HowItWorks } from '@/components/untrace/sections/how-it-works';
import { Coverage } from '@/components/untrace/sections/coverage';
import { Privacy } from '@/components/untrace/sections/privacy';
import { Comparison } from '@/components/untrace/sections/comparison';
import { Faq } from '@/components/untrace/sections/faq';
import { ToolSection } from '@/components/tool/tool-section';

/* ------------------------------------------------------------------ types */

interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'user';
  plan: 'free' | 'premium';
}

interface Quota {
  plan: 'free' | 'premium';
  role: 'admin' | 'user';
  limit: number; // -1 unlimited (video enhancer quota — Untrace is always unlimited)
  usedToday: number;
  remaining: number; // -1 unlimited
}

const SUB_NAV = [
  { href: '#tool', label: 'Cleaner' },
  { href: '#how', label: 'How it works' },
  { href: '#coverage', label: 'Coverage' },
  { href: '#faq', label: 'FAQ' },
];

/* ------------------------------------------------------------------ page */

export function UntracePage({ fontClass }: { fontClass: string }) {
  const router = useRouter();

  const [user, setUser] = useState<SessionUser | null>(null);
  const [quota, setQuota] = useState<Quota | null>(null);
  const [authChecked, setAuthChecked] = useState(false);

  /* ------------------------------------------------- scoped dark theme */

  /* Untrace uses its own dark cyber palette. It is applied via CSS custom
   * properties scoped to this page (see `.untrace-scope` / `body.untrace-theme`
   * in globals.css) so no other unblurr page is ever affected. The body class
   * also covers elements rendered in portals (dialogs, selects, toasts). */
  useEffect(() => {
    document.body.classList.add('untrace-theme');
    if (fontClass) document.body.classList.add(fontClass);
    return () => {
      document.body.classList.remove('untrace-theme');
      if (fontClass) document.body.classList.remove(fontClass);
    };
  }, [fontClass]);

  /* ------------------------------------------------------- load session */

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/auth/me', { cache: 'no-store' });
        if (res.status === 401) {
          router.replace('/login?next=/untrace');
          return;
        }
        const data = await res.json();
        if (!cancelled) {
          setUser(data.user);
          setQuota(data.quota);
        }
      } catch {
        router.replace('/login?next=/untrace');
      } finally {
        if (!cancelled) setAuthChecked(true);
      }
    })();
    return () => { cancelled = true; };
  }, [router]);

  const logout = useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    router.replace('/login');
  }, [router]);

  /* ---------------------------------------------------------------- view */

  const unlimited = quota?.limit === -1;
  const remaining =
    quota?.limit === -1
      ? 'Unlimited videos'
      : `${Math.max(0, quota?.remaining ?? 0)} videos left today`;

  return (
    <div
      className={`untrace-scope ${fontClass} relative min-h-screen flex flex-col bg-background text-foreground selection:bg-emerald-500/30`}
    >
      {/* ---------------------------------------------------------- header */}
      <header className="sticky top-0 z-40 border-b border-white/5 bg-[#04070c]/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5 min-w-0" title="Back to the video enhancer">
            <img src="/logo.svg" alt="unblurr.site logo" className="h-9 w-9 rounded-xl" />
            <div className="leading-tight min-w-0">
              <div className="text-[15px] font-bold tracking-tight truncate text-slate-100">
                unblurr<span className="text-emerald-400">.site</span>
                <span className="mx-1.5 text-slate-600">/</span>
                <span className="text-emerald-300">untrace</span>
              </div>
              <div className="text-[11px] text-slate-500 hidden sm:block">AI image footprint cleaner</div>
            </div>
          </Link>
          {authChecked && user && (
            <div className="flex items-center gap-2 sm:gap-3">
              <Button
                asChild
                variant="outline"
                size="sm"
                className="h-9 border-white/10 bg-white/[0.04] text-slate-200 hover:bg-white/10 hover:text-white"
              >
                <Link href="/" title="Back to the video enhancer">
                  <Film className="mr-1.5 h-4 w-4" />
                  <span className="hidden sm:inline">Video Enhancer</span>
                  <span className="sm:hidden">Videos</span>
                </Link>
              </Button>
              <Badge
                variant="outline"
                className="hidden sm:inline-flex border-cyan-400/30 bg-cyan-400/10 text-cyan-300 hover:bg-cyan-400/10"
              >
                <InfinityIcon className="mr-1 h-3 w-3" />
                Untrace — free &amp; unlimited
              </Badge>
              <Badge
                variant="outline"
                className={`hidden md:inline-flex border-white/10 bg-white/[0.04] text-slate-300 hover:bg-white/[0.04] ${
                  !unlimited && quota && quota.remaining <= 0
                    ? 'border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-500/10'
                    : ''
                }`}
                title="Your video enhancer quota — Untrace never uses it"
              >
                {unlimited
                  ? (user.role === 'admin' ? <Gauge className="mr-1 h-3 w-3" /> : <Crown className="mr-1 h-3 w-3" />)
                  : <Film className="mr-1 h-3 w-3" />}
                {remaining}
              </Badge>
              {user.role === 'admin' && (
                <Button
                  asChild
                  variant="outline"
                  size="sm"
                  className="h-9 hidden lg:inline-flex border-white/10 bg-white/5 text-slate-200 hover:bg-white/10 hover:text-white"
                >
                  <Link href="/admin/dashboard">
                    <LayoutDashboard className="mr-1.5 h-4 w-4" />
                    Admin
                  </Link>
                </Button>
              )}
              <div className="hidden md:flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] py-1 pl-1 pr-3">
                <Avatar className="h-7 w-7">
                  <AvatarFallback className="bg-gradient-to-br from-cyan-400/80 to-emerald-500/80 text-[11px] font-bold text-[#04070c]">
                    {(user.name || user.email)[0]?.toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <span className="max-w-[140px] truncate text-xs font-medium text-slate-300">{user.email}</span>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={logout}
                aria-label="Sign out"
                className="h-9 w-9 p-0 border-white/10 bg-white/5 text-slate-400 hover:bg-red-500/10 hover:text-red-400"
              >
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>

        {/* anchor sub-nav */}
        <nav className="border-t border-white/5 bg-black/20">
          <div className="mx-auto hidden max-w-6xl items-center gap-1 px-4 py-2 sm:flex sm:px-6">
            {SUB_NAV.map((l) => (
              <a
                key={l.href}
                href={l.href}
                className="rounded-md px-3 py-1.5 text-xs font-medium text-slate-400 transition-colors hover:bg-white/5 hover:text-emerald-300"
              >
                {l.label}
              </a>
            ))}
            <span className="ml-auto inline-flex items-center gap-1.5 text-[11px] text-slate-500">
              <Fingerprint className="h-3.5 w-3.5 text-emerald-300" />
              Included free with every account — unlimited cleaning, never counted against your video quota
            </span>
          </div>
        </nav>
      </header>

      {/* ------------------------------------------------------------ main */}
      <main className="relative z-10 flex-1">
        <Hero />
        <ToolSection />
        <HowItWorks />
        <Coverage />
        <Privacy />
        <Comparison />
        <Faq />
      </main>

      {/* ---------------------------------------------------------- footer */}
      <footer className="relative z-10 mt-auto border-t border-white/5 bg-black/20">
        <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
          <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Zap className="h-4 w-4 text-emerald-300" />
              <span className="font-medium text-slate-300">unblurr.site</span>
              <span>· Untrace — make AI images untraceable</span>
            </div>
            <div className="flex items-center gap-4 text-xs text-slate-600">
              <Link href="/" className="hover:text-slate-400">Video Enhancer</Link>
              <a
                href="mailto:unblurr@proton.me"
                className="inline-flex items-center gap-1.5 hover:text-slate-400"
                title="Contact us"
              >
                <Zap className="h-3.5 w-3.5 text-emerald-500" />
                unblurr@proton.me
              </a>
            </div>
          </div>
        </div>
      </footer>

      {/* toasts for the cleaner UI (scoped to this page) */}
      <Toaster position="bottom-right" richColors theme="dark" style={{ zIndex: 45 }} />
    </div>
  );
}
